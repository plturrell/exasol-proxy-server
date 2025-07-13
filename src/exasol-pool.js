import WebSocket from 'ws';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

class ExasolConnection {
  constructor(config, id) {
    this.config = config;
    this.id = id;
    this.ws = null;
    this.connected = false;
    this.sessionId = null;
    this.publicKey = null;
    this.commandId = 0;
    this.pendingCommands = new Map();
    this.lastUsed = Date.now();
    this.created = Date.now();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const protocol = this.config.encryption ? 'wss' : 'ws';
      const url = `${protocol}://${this.config.host}:${this.config.port}`;
      
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.config.pool.connectionTimeout);

      this.ws = new WebSocket(url, {
        rejectUnauthorized: false
      });

      this.ws.on('open', () => {
        logger.debug(`Connection ${this.id} opened`);
        // Send initial login command to trigger public key response
        const initCommand = {
          command: 'login',
          protocolVersion: 3
        };
        this.ws.send(JSON.stringify(initCommand));
      });

      this.ws.on('message', async (data) => {
        try {
          const response = JSON.parse(data.toString());
          
          if (!this.sessionId && response.responseData?.publicKeyPem) {
            this.publicKey = response.responseData.publicKeyPem;
            clearTimeout(timeout);
            
            try {
              await this.login();
              this.connected = true;
              resolve();
            } catch (err) {
              reject(err);
            }
          } else {
            this.handleResponse(response);
          }
        } catch (err) {
          logger.error(`Error parsing message: ${err.message}`);
        }
      });

      this.ws.on('error', (error) => {
        logger.error(`Connection ${this.id} error: ${error.message}`);
        this.connected = false;
        clearTimeout(timeout);
        reject(error);
      });

      this.ws.on('close', () => {
        logger.debug(`Connection ${this.id} closed`);
        this.connected = false;
        this.sessionId = null;
      });
    });
  }

  async login() {
    const encryptedPassword = this.encryptPassword(this.config.password);
    
    const loginCommand = {
      command: 'login',
      protocolVersion: 3,
      attributes: {
        username: this.config.user,
        password: encryptedPassword,
        driverName: 'Exasol Proxy Service',
        clientName: 'exasol-proxy',
        clientVersion: '1.0.0',
        clientOs: process.platform,
        clientOsUsername: 'proxy',
        clientLanguage: 'en_US',
        clientRuntime: `Node.js ${process.version}`,
        useCompression: false,
        attributes: {
          currentSchema: this.config.schema,
          autocommit: true,
          queryTimeout: 0,
          timezone: 'UTC',
          dateFormat: 'YYYY-MM-DD',
          dateLanguage: 'ENG',
          datetimeFormat: 'YYYY-MM-DD HH24:MI:SS.FF6',
          fetchSize: 100000,
          resultSetMaxRows: 0
        }
      }
    };
    
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
      const commandId = this.commandId++;
      command.commandId = commandId;
      
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(new Error('Command timeout'));
      }, 30000);
      
      this.pendingCommands.set(commandId, { resolve, reject, timeout });
      this.ws.send(JSON.stringify(command));
    });
  }

  handleResponse(response) {
    if (response.attributes?.sessionId) {
      this.sessionId = response.attributes.sessionId;
      logger.info(`Connection ${this.id} logged in, session: ${this.sessionId}`);
    }
    
    const commandId = response.commandId;
    if (this.pendingCommands.has(commandId)) {
      const { resolve, reject, timeout } = this.pendingCommands.get(commandId);
      clearTimeout(timeout);
      this.pendingCommands.delete(commandId);
      
      if (response.status === 'ok') {
        resolve(response);
      } else {
        const error = new Error(response.exception?.text || 'Command failed');
        error.sqlCode = response.exception?.sqlCode;
        reject(error);
      }
    }
  }

  async execute(sql, parameters = []) {
    if (!this.connected) {
      throw new Error('Connection not established');
    }

    this.lastUsed = Date.now();

    const command = {
      command: 'execute',
      attributes: {
        sqlText: sql,
        parameters: parameters
      }
    };
    
    const response = await this.sendCommand(command);
    
    if (response.attributes?.resultSet) {
      return {
        type: 'resultSet',
        columns: response.attributes.resultSet.columns,
        rows: response.attributes.resultSet.data,
        numRows: response.attributes.resultSet.numRows,
        hasMore: response.attributes.resultSet.numRows > response.attributes.resultSet.numRowsInMessage,
        statementHandle: response.attributes.statementHandle
      };
    }
    
    return {
      type: 'rowCount',
      rowCount: response.attributes.numRowsAffected || 0
    };
  }

  async executeUDF(functionName, parameters = []) {
    const schema = this.config.schema;
    const paramPlaceholders = parameters.map(() => '?').join(', ');
    const sql = `SELECT ${schema}.${functionName}(${paramPlaceholders}) as result`;
    
    return this.execute(sql, parameters);
  }

  async close() {
    if (this.ws) {
      this.ws.close();
    }
    this.connected = false;
  }

  isHealthy() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

export class ExasolConnectionPool {
  constructor(config) {
    this.config = config;
    this.connections = [];
    this.waitingQueue = [];
    this.stats = {
      created: 0,
      destroyed: 0,
      activeQueries: 0,
      totalQueries: 0,
      errors: 0
    };
    
    this.initialize();
  }

  async initialize() {
    // Skip initialization if credentials are missing
    if (!this.config.password) {
      logger.warn('Exasol credentials not configured - skipping pool initialization');
      return;
    }
    
    // Create initial connections
    const promises = [];
    for (let i = 0; i < this.config.pool.min; i++) {
      promises.push(this.createConnection());
    }
    
    try {
      await Promise.all(promises);
      logger.info(`Connection pool initialized with ${this.connections.length} connections`);
    } catch (err) {
      logger.error(`Failed to initialize connection pool: ${err.message}`);
    }
    
    // Start health check interval
    setInterval(() => this.healthCheck(), this.config.pool.healthCheckInterval);
  }

  async createConnection() {
    const id = uuidv4();
    const connection = new ExasolConnection(this.config, id);
    
    try {
      await connection.connect();
      this.connections.push(connection);
      this.stats.created++;
      logger.info(`Created connection ${id}`);
      return connection;
    } catch (err) {
      logger.error(`Failed to create connection ${id}: ${err.message}`);
      throw err;
    }
  }

  async acquire() {
    // Find available connection
    const available = this.connections.find(conn => 
      conn.isHealthy() && !conn.inUse
    );
    
    if (available) {
      available.inUse = true;
      return available;
    }
    
    // Create new connection if under limit
    if (this.connections.length < this.config.pool.max) {
      try {
        const conn = await this.createConnection();
        conn.inUse = true;
        return conn;
      } catch (err) {
        logger.error(`Failed to create new connection: ${err.message}`);
      }
    }
    
    // Wait for available connection
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitingQueue.indexOf(entry);
        if (index > -1) {
          this.waitingQueue.splice(index, 1);
        }
        reject(new Error('Connection acquire timeout'));
      }, this.config.pool.acquireTimeout);
      
      const entry = { resolve, reject, timeout };
      this.waitingQueue.push(entry);
    });
  }

  release(connection) {
    connection.inUse = false;
    
    // Give connection to waiting request
    if (this.waitingQueue.length > 0) {
      const { resolve, timeout } = this.waitingQueue.shift();
      clearTimeout(timeout);
      connection.inUse = true;
      resolve(connection);
    }
  }

  async destroy(connection) {
    const index = this.connections.indexOf(connection);
    if (index > -1) {
      this.connections.splice(index, 1);
      await connection.close();
      this.stats.destroyed++;
      logger.info(`Destroyed connection ${connection.id}`);
    }
  }

  async healthCheck() {
    const now = Date.now();
    
    // Check each connection
    for (const conn of [...this.connections]) {
      // Remove unhealthy connections
      if (!conn.isHealthy()) {
        logger.warn(`Connection ${conn.id} is unhealthy, removing`);
        await this.destroy(conn);
        continue;
      }
      
      // Remove idle connections over limit
      if (!conn.inUse && 
          this.connections.length > this.config.pool.min &&
          now - conn.lastUsed > this.config.pool.idleTimeout) {
        logger.info(`Connection ${conn.id} idle timeout, removing`);
        await this.destroy(conn);
      }
    }
    
    // Ensure minimum connections
    while (this.connections.length < this.config.pool.min) {
      try {
        await this.createConnection();
      } catch (err) {
        logger.error(`Health check failed to create connection: ${err.message}`);
        break;
      }
    }
  }

  async execute(sql, parameters = []) {
    const conn = await this.acquire();
    this.stats.activeQueries++;
    this.stats.totalQueries++;
    
    try {
      const result = await conn.execute(sql, parameters);
      return result;
    } catch (err) {
      this.stats.errors++;
      throw err;
    } finally {
      this.stats.activeQueries--;
      this.release(conn);
    }
  }

  async executeUDF(functionName, parameters = []) {
    const conn = await this.acquire();
    this.stats.activeQueries++;
    this.stats.totalQueries++;
    
    try {
      const result = await conn.executeUDF(functionName, parameters);
      return result;
    } catch (err) {
      this.stats.errors++;
      throw err;
    } finally {
      this.stats.activeQueries--;
      this.release(conn);
    }
  }

  async getHealth() {
    const healthyConnections = this.connections.filter(c => c.isHealthy()).length;
    const totalConnections = this.connections.length;
    
    return {
      healthy: healthyConnections > 0,
      connections: {
        healthy: healthyConnections,
        total: totalConnections,
        inUse: this.connections.filter(c => c.inUse).length,
        waiting: this.waitingQueue.length
      },
      stats: this.stats,
      uptime: process.uptime()
    };
  }

  async close() {
    // Reject waiting requests
    for (const { reject, timeout } of this.waitingQueue) {
      clearTimeout(timeout);
      reject(new Error('Pool is closing'));
    }
    this.waitingQueue = [];
    
    // Close all connections
    await Promise.all(
      this.connections.map(conn => conn.close())
    );
    this.connections = [];
    
    logger.info('Connection pool closed');
  }
}