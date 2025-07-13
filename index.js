const express = require('express');
const cors = require('cors');
import crypto from 'crypto';
// Copy the WebSocket client to this directory for Railway deployment
const ExasolWebSocketClient = require('./exasol-websocket-client.js');

const app = express();
app.use(express.json());
app.use(cors());

// Connection pool management
const connections = new Map();
const MAX_IDLE_TIME = 5 * 60 * 1000; // 5 minutes
const MAX_CONNECTIONS = 50; // Limit concurrent connections

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    connections: connections.size,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Cleanup idle connections periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, conn] of connections.entries()) {
    if (now - conn.lastUsed > MAX_IDLE_TIME) {
      console.log(`Closing idle connection: ${id}`);
      conn.client.disconnect().catch(console.error);
      connections.delete(id);
    }
  }
}, 60000); // Check every minute

// Get or create connection
async function getConnection(sessionId, config) {
  let conn = connections.get(sessionId);
  
  if (!conn) {
    // Check connection limit
    if (connections.size >= MAX_CONNECTIONS) {
      // Find and close the oldest connection
      let oldestId = null;
      let oldestTime = Date.now();
      
      for (const [id, c] of connections.entries()) {
        if (c.lastUsed < oldestTime) {
          oldestTime = c.lastUsed;
          oldestId = id;
        }
      }
      
      if (oldestId) {
        const oldConn = connections.get(oldestId);
        await oldConn.client.disconnect().catch(console.error);
        connections.delete(oldestId);
      }
    }
    
    console.log(`Creating new connection for session: ${sessionId}`);
    const client = new ExasolWebSocketClient(config);
    
    try {
      await client.connect();
      conn = {
        client,
        lastUsed: Date.now(),
        config: config
      };
      connections.set(sessionId, conn);
    } catch (error) {
      console.error('Failed to create connection:', error);
      throw new Error(`Connection failed: ${error.message}`);
    }
  }
  
  // Check if connection is still alive
  if (!conn.client.isConnected()) {
    console.log(`Reconnecting session: ${sessionId}`);
    try {
      await conn.client.connect();
    } catch (error) {
      // Remove dead connection
      connections.delete(sessionId);
      throw new Error(`Reconnection failed: ${error.message}`);
    }
  }
  
  conn.lastUsed = Date.now();
  return conn.client;
}

// Generate session ID if not provided
function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

// Execute SQL query endpoint
app.post('/api/execute', async (req, res) => {
  try {
    const { sessionId = generateSessionId(), sql, parameters = [], config } = req.body;
    
    if (!sql) {
      return res.status(400).json({ error: 'SQL query is required' });
    }
    
    if (!config || !config.host || !config.user || !config.password) {
      return res.status(400).json({ error: 'Database configuration is required' });
    }
    
    console.log(`Executing query for session ${sessionId}: ${sql.substring(0, 100)}...`);
    
    const startTime = Date.now();
    const client = await getConnection(sessionId, config);
    const result = await client.execute(sql, parameters);
    const duration = Date.now() - startTime;
    
    console.log(`Query executed in ${duration}ms`);
    
    res.json({
      success: true,
      sessionId,
      result,
      executionTime: duration
    });
  } catch (error) {
    console.error('Execute error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.stack
    });
  }
});

// Execute UDF endpoint
app.post('/api/executeUDF', async (req, res) => {
  try {
    const { sessionId = generateSessionId(), functionName, parameters = [], config } = req.body;
    
    if (!functionName) {
      return res.status(400).json({ error: 'Function name is required' });
    }
    
    if (!config || !config.host || !config.user || !config.password) {
      return res.status(400).json({ error: 'Database configuration is required' });
    }
    
    console.log(`Executing UDF ${functionName} for session ${sessionId}`);
    
    const startTime = Date.now();
    const client = await getConnection(sessionId, config);
    const result = await client.executeUDF(functionName, parameters);
    const duration = Date.now() - startTime;
    
    console.log(`UDF executed in ${duration}ms`);
    
    res.json({
      success: true,
      sessionId,
      result,
      executionTime: duration
    });
  } catch (error) {
    console.error('UDF execution error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.stack
    });
  }
});

// Execute batch operations
app.post('/api/executeBatch', async (req, res) => {
  try {
    const { sessionId = generateSessionId(), operations, config } = req.body;
    
    if (!operations || !Array.isArray(operations)) {
      return res.status(400).json({ error: 'Operations array is required' });
    }
    
    const client = await getConnection(sessionId, config);
    const results = [];
    
    // Start transaction
    await client.execute('START TRANSACTION');
    
    try {
      for (const op of operations) {
        const result = await client.execute(op.sql, op.parameters || []);
        results.push({
          operation: op.name || 'unnamed',
          success: true,
          result
        });
      }
      
      // Commit transaction
      await client.commit();
      
      res.json({
        success: true,
        sessionId,
        results,
        totalOperations: operations.length
      });
      
    } catch (batchError) {
      // Rollback on error
      await client.rollback().catch(console.error);
      throw batchError;
    }
    
  } catch (error) {
    console.error('Batch execution error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Close connection endpoint
app.post('/api/close', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    const conn = connections.get(sessionId);
    if (conn) {
      await conn.client.disconnect();
      connections.delete(sessionId);
      console.log(`Closed connection for session: ${sessionId}`);
    }
    
    res.json({ 
      success: true,
      message: 'Connection closed'
    });
  } catch (error) {
    console.error('Close connection error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get connection status
app.get('/api/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const conn = connections.get(sessionId);
  
  if (!conn) {
    return res.json({
      exists: false,
      connected: false
    });
  }
  
  res.json({
    exists: true,
    connected: conn.client.isConnected(),
    lastUsed: conn.lastUsed,
    idleTime: Date.now() - conn.lastUsed
  });
});

// List all active connections (for monitoring)
app.get('/api/connections', (req, res) => {
  const connectionList = [];
  
  for (const [id, conn] of connections.entries()) {
    connectionList.push({
      sessionId: id,
      connected: conn.client.isConnected(),
      lastUsed: conn.lastUsed,
      idleTime: Date.now() - conn.lastUsed,
      host: conn.config.host
    });
  }
  
  res.json({
    total: connectionList.length,
    connections: connectionList
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Exasol proxy server running on port ${PORT}`);
  console.log(`📊 Max connections: ${MAX_CONNECTIONS}`);
  console.log(`⏰ Idle timeout: ${MAX_IDLE_TIME / 1000}s`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌍 Railway Project: ${process.env.RAILWAY_PROJECT_ID || 'local'}`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing connections...');
  
  for (const [id, conn] of connections.entries()) {
    try {
      await conn.client.disconnect();
    } catch (error) {
      console.error(`Error closing connection ${id}:`, error);
    }
  }
  
  process.exit(0);
});