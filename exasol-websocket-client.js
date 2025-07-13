/**
 * Exasol WebSocket Client - Optimized Implementation
 * Based on official Exasol WebSocket JSON Protocol v3
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class ExasolWebSocketClient extends EventEmitter {
    constructor(config) {
        super();
        this.config = {
            host: config.host || '6c2pxsycfjdudh5tsy6bb4cqzy.clusters.exasol.com',
            port: config.port || 8563,
            user: config.username || config.user || 'admin',
            password: config.password || process.env.EXASOL_PAT,
            schema: config.schema || 'app_data',
            encryption: config.encryption !== false,
            autocommit: config.autocommit !== false,
            fetchSize: config.fetchSize || 100000,
            queryTimeout: config.queryTimeout || 0,
            resultSetMaxRows: config.resultSetMaxRows || 0,
            useCompression: config.useCompression || false
        };
        
        this.ws = null;
        this.sessionId = null;
        this.publicKey = null;
        this.connected = false;
        this.commandId = 0;
        this.pendingCommands = new Map();
        this.statementHandles = new Map();
        this.protocolVersion = 3;
        
        // Performance metrics
        this.metrics = {
            queries: 0,
            totalTime: 0,
            errors: 0,
            slowQueries: []
        };
    }

    async connect() {
        return new Promise((resolve, reject) => {
            try {
                // Always use secure WebSocket for Exasol SaaS
                const url = `wss://${this.config.host}:${this.config.port}`;
                console.log('Connecting to Exasol:', url);
                
                console.log(`Connecting to Exasol: ${url}`);
                
                this.ws = new WebSocket(url, {
                    rejectUnauthorized: false // For self-signed certificates
                });
                
                this.ws.on('open', () => {
                    console.log('WebSocket connected');
                    this.emit('connected');
                });
                
                this.ws.on('message', async (data) => {
                    try {
                        let response;
                        
                        // Handle binary/compressed data
                        if (data instanceof Buffer) {
                            if (this.config.useCompression) {
                                const zlib = require('zlib');
                                data = zlib.inflateSync(data);
                            }
                            response = JSON.parse(data.toString());
                        } else {
                            response = JSON.parse(data.toString());
                        }
                        
                        // Debug logging
                        console.log('Received message:', response);
                        if (process.env.NODE_ENV === 'development') {
                            console.log('<<< RECV:', JSON.stringify(response, null, 2));
                        }
                        
                        // Initial connection - server sends public key
                        if (!this.sessionId && response.responseData?.publicKeyPem) {
                            this.publicKey = response.responseData.publicKeyPem;
                            console.log('Received public key from server');
                            
                            try {
                                await this.login();
                                resolve();
                            } catch (err) {
                                reject(err);
                            }
                        } else {
                            this.handleResponse(response);
                        }
                        
                    } catch (parseError) {
                        console.error('Failed to parse WebSocket message:', parseError);
                        this.emit('error', parseError);
                    }
                });
                
                this.ws.on('error', (error) => {
                    console.error('WebSocket error:', error);
                    this.connected = false;
                    this.emit('error', error);
                    reject(error);
                });
                
                this.ws.on('close', (code, reason) => {
                    console.log(`WebSocket closed: ${code} ${reason}`);
                    this.connected = false;
                    this.sessionId = null;
                    this.emit('disconnected', { code, reason });
                });
                
                this.ws.on('pong', () => {
                    // Handle heartbeat pong frames
                    this.emit('heartbeat');
                });
                
            } catch (error) {
                console.error('Failed to create WebSocket connection:', error);
                reject(error);
            }
        });
    }

    async login() {
        const encryptedPassword = this.encryptPassword(this.config.password);
        
        const loginCommand = {
            command: 'login',
            protocolVersion: this.protocolVersion,
            attributes: {
                username: this.config.user,
                password: encryptedPassword,
                driverName: 'Node.js WebSocket Client',
                clientName: 'FinSight-Exasol-Client',
                clientVersion: '1.0.0',
                clientOs: process.platform,
                clientOsUsername: process.env.USER || 'app_user',
                clientLanguage: 'en_US',
                clientRuntime: `Node.js ${process.version}`,
                useCompression: this.config.useCompression,
                attributes: {
                    currentSchema: this.config.schema,
                    autocommit: this.config.autocommit,
                    queryTimeout: this.config.queryTimeout,
                    timezone: 'UTC',
                    dateFormat: 'YYYY-MM-DD',
                    dateLanguage: 'ENG',
                    datetimeFormat: 'YYYY-MM-DD HH24:MI:SS.FF6',
                    fetchSize: this.config.fetchSize,
                    resultSetMaxRows: this.config.resultSetMaxRows
                }
            }
        };

        console.log('Sending login command...');
        return this.sendCommand(loginCommand);
    }

    encryptPassword(password) {
        const encrypted = crypto.publicEncrypt(
            {
                key: this.publicKey,
                padding: crypto.constants.RSA_PKCS1_PADDING
            },
            Buffer.from(password, 'utf8')
        );
        return encrypted.toString('base64');
    }

    sendCommand(command) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not connected'));
                return;
            }

            const commandId = this.commandId++;
            command.commandId = commandId;
            
            this.pendingCommands.set(commandId, { 
                resolve, 
                reject, 
                timestamp: Date.now(),
                command: command.command 
            });
            
            // Debug logging
            if (process.env.NODE_ENV === 'development') {
                console.log('>>> SEND:', JSON.stringify(command, null, 2));
            }
            
            try {
                let message = JSON.stringify(command);
                
                // Handle compression if enabled
                if (this.config.useCompression && this.sessionId) {
                    const zlib = require('zlib');
                    message = zlib.deflateSync(Buffer.from(message));
                    this.ws.send(message);
                } else {
                    this.ws.send(message);
                }
                
            } catch (sendError) {
                this.pendingCommands.delete(commandId);
                reject(sendError);
                return;
            }
            
            // Set timeout for command (configurable)
            const timeout = command.command === 'login' ? 10000 : 60000; // 10s for login, 60s for queries
            setTimeout(() => {
                if (this.pendingCommands.has(commandId)) {
                    this.pendingCommands.delete(commandId);
                    reject(new Error(`Command timeout after ${timeout}ms: ${command.command}`));
                }
            }, timeout);
        });
    }

    handleResponse(response) {
        // Check if this is a login response
        if (response.attributes?.sessionId) {
            this.sessionId = response.attributes.sessionId;
            this.connected = true;
            console.log('Login successful, session:', this.sessionId);
            console.log('Protocol version:', response.attributes.protocolVersion);
            console.log('Database:', response.attributes.databaseName);
            this.emit('login', response.attributes);
        }
        
        // Handle pending command responses
        const commandId = response.commandId;
        if (this.pendingCommands.has(commandId)) {
            const { resolve, reject, timestamp, command } = this.pendingCommands.get(commandId);
            this.pendingCommands.delete(commandId);
            
            const duration = Date.now() - timestamp;
            
            if (response.status === 'ok') {
                // Update metrics for successful queries
                if (command === 'execute') {
                    this.metrics.queries++;
                    this.metrics.totalTime += duration;
                    
                    if (duration > 1000) { // Slow query threshold
                        this.metrics.slowQueries.push({
                            duration,
                            timestamp: new Date(),
                            commandId
                        });
                    }
                }
                
                this.emit('response', { command, duration, success: true });
                resolve(response);
            } else {
                // Update error metrics
                if (command === 'execute') {
                    this.metrics.errors++;
                }
                
                const error = new Error(response.exception?.text || 'Command failed');
                error.sqlCode = response.exception?.sqlCode;
                error.commandId = commandId;
                error.duration = duration;
                
                this.emit('response', { command, duration, success: false, error });
                this.emit('error', error);
                reject(error);
            }
        }
    }

    async execute(sql, parameters = []) {
        const command = {
            command: 'execute',
            attributes: {
                sqlText: sql,
                parameters: parameters || [],
                resultSetMaxRows: this.config.resultSetMaxRows
            }
        };
        
        const response = await this.sendCommand(command);
        
        // Handle result set
        if (response.attributes?.resultSet) {
            const resultSet = response.attributes.resultSet;
            const result = {
                columns: resultSet.columns || [],
                rows: resultSet.data || [],
                numRows: resultSet.numRows || 0,
                numRowsInMessage: resultSet.numRowsInMessage || 0,
                statementHandle: response.attributes.statementHandle,
                hasMore: resultSet.numRows > resultSet.numRowsInMessage
            };
            
            // Store statement handle for potential fetch operations
            if (result.hasMore && result.statementHandle) {
                this.statementHandles.set(result.statementHandle, result);
            }
            
            return result;
        }
        
        // Handle DML results (INSERT, UPDATE, DELETE)
        return {
            rowCount: response.attributes?.numRowsAffected || 0,
            statementHandle: response.attributes?.statementHandle
        };
    }

    async executeSQL(sql, parameters = []) {
        return this.execute(sql, parameters);
    }

    // Prepared statements
    async prepare(sql) {
        const command = {
            command: 'createPreparedStatement',
            attributes: {
                sqlText: sql
            }
        };
        
        const response = await this.sendCommand(command);
        return response.attributes.statementHandle;
    }

    async executePrepared(statementHandle, parameters = []) {
        const command = {
            command: 'executePreparedStatement',
            attributes: {
                statementHandle: statementHandle,
                parameters: parameters
            }
        };
        
        const response = await this.sendCommand(command);
        
        if (response.attributes?.resultSet) {
            return {
                columns: response.attributes.resultSet.columns || [],
                rows: response.attributes.resultSet.data || [],
                numRows: response.attributes.resultSet.numRows || 0
            };
        }
        
        return {
            rowCount: response.attributes?.numRowsAffected || 0
        };
    }

    async closePreparedStatement(statementHandle) {
        const command = {
            command: 'closePreparedStatement',
            attributes: {
                statementHandle: statementHandle
            }
        };
        
        return this.sendCommand(command);
    }

    // Batch operations
    async executeBatch(sql, parametersBatch) {
        const command = {
            command: 'executeBatch',
            attributes: {
                sqlText: sql,
                parametersBatch: parametersBatch
            }
        };
        
        return this.sendCommand(command);
    }

    // Fetch more results for large result sets
    async fetchMore(statementHandle, startPosition = 0, numBytes = 16777216) {
        const command = {
            command: 'fetch',
            attributes: {
                statementHandle: statementHandle,
                startPosition: startPosition,
                numBytes: numBytes
            }
        };
        
        const response = await this.sendCommand(command);
        return response.attributes.resultSet;
    }

    async executeUDF(functionName, parameters = []) {
        const schema = this.config.schema;
        const paramPlaceholders = parameters.map((_, index) => `?`).join(', ');
        const sql = `SELECT ${schema}.${functionName}(${paramPlaceholders}) as result`;
        
        return this.execute(sql, parameters);
    }

    // Session management
    async getAttributes() {
        const command = { command: 'getAttributes' };
        const response = await this.sendCommand(command);
        return response.attributes;
    }

    async setAttributes(attributes) {
        const command = {
            command: 'setAttributes',
            attributes: attributes
        };
        
        return this.sendCommand(command);
    }

    // Transaction control
    async commit() {
        const command = { command: 'commit' };
        return this.sendCommand(command);
    }

    async rollback() {
        const command = { command: 'rollback' };
        return this.sendCommand(command);
    }

    // Connection management
    async disconnect() {
        try {
            if (this.connected && this.ws) {
                const command = { command: 'disconnect' };
                await this.sendCommand(command);
            }
        } catch (error) {
            console.warn('Error during disconnect:', error.message);
        } finally {
            if (this.ws) {
                this.ws.close();
            }
            this.connected = false;
            this.sessionId = null;
            this.pendingCommands.clear();
            this.statementHandles.clear();
            this.emit('disconnected');
        }
    }

    isConnected() {
        return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId;
    }

    // Performance and monitoring
    getMetrics() {
        return {
            ...this.metrics,
            avgQueryTime: this.metrics.queries > 0 ? this.metrics.totalTime / this.metrics.queries : 0,
            connected: this.isConnected(),
            sessionId: this.sessionId,
            pendingCommands: this.pendingCommands.size,
            activeStatements: this.statementHandles.size
        };
    }

    // Heartbeat for connection keepalive
    startHeartbeat(interval = 30000) {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected()) {
                // Send ping frame
                this.ws.ping();
            }
        }, interval);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    // Helper for retry logic
    async executeWithRetry(sql, parameters = [], maxRetries = 3) {
        let lastError;
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await this.execute(sql, parameters);
            } catch (error) {
                lastError = error;
                
                // Check if error is retryable
                if (error.sqlCode === '08003' || error.sqlCode === '08001') {
                    // Connection error - try to reconnect
                    try {
                        await this.connect();
                    } catch (reconnectError) {
                        console.warn('Reconnection failed:', reconnectError.message);
                    }
                } else if (error.sqlCode === '23000') {
                    // Constraint violation - don't retry
                    throw error;
                }
                
                // Exponential backoff
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
                }
            }
        }
        
        throw lastError;
    }
}

module.exports = ExasolWebSocketClient;