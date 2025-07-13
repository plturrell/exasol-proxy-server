import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { ExasolConnectionPool } from './exasol-pool.js';
import { logger } from './logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { authenticate } from './middleware/auth.js';
import routes from './routes/index.js';

const app = express();
const pool = new ExasolConnectionPool(config.exasol);

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: config.cors.origins,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: config.rateLimit.maxRequests,
  message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// Test connection endpoint
app.get('/test-connection', async (req, res) => {
  const testConfig = {
    host: config.exasol.host,
    port: config.exasol.port,
    hasCredentials: !!config.exasol.password,
    encryption: config.exasol.encryption,
    url: `${config.exasol.encryption ? 'wss' : 'ws'}://${config.exasol.host}:${config.exasol.port}`
  };
  
  try {
    // Try to create a test WebSocket connection
    const WebSocket = (await import('ws')).default;
    const ws = new WebSocket(testConfig.url, {
      rejectUnauthorized: false,
      handshakeTimeout: 10000
    });
    
    const timeout = setTimeout(() => {
      ws.close();
      res.status(503).json({
        success: false,
        error: 'Connection timeout after 10 seconds',
        config: testConfig
      });
    }, 10000);
    
    ws.on('open', () => {
      clearTimeout(timeout);
      ws.close();
      res.json({
        success: true,
        message: 'WebSocket connection successful',
        config: testConfig
      });
    });
    
    ws.on('error', (error) => {
      clearTimeout(timeout);
      res.status(503).json({
        success: false,
        error: error.message,
        config: testConfig
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      config: testConfig
    });
  }
});

// Health check (no auth required)
app.get('/health', async (req, res) => {
  const missingVars = [];
  
  // Check required environment variables
  if (!process.env.EXASOL_PAT && !process.env.EXASOL_PASSWORD) {
    missingVars.push('EXASOL_PAT');
  }
  if (!process.env.EXASOL_HOST) {
    missingVars.push('EXASOL_HOST');
  }
  if (!process.env.EXASOL_USER) {
    missingVars.push('EXASOL_USER');
  }
  
  // If critical environment variables are missing, return unhealthy
  if (missingVars.length > 0) {
    return res.status(503).json({
      healthy: false,
      status: 'not_configured',
      message: 'Missing required environment variables',
      missing: missingVars,
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    const health = await pool.getHealth();
    res.status(health.healthy ? 200 : 503).json(health);
  } catch (error) {
    res.status(503).json({
      healthy: false,
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API routes
app.use('/api', authenticate, routes(pool));

// Error handling
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Shutting down gracefully...');
  await pool.close();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
app.listen(config.port, () => {
  logger.info(`Exasol proxy server running on port ${config.port}`);
  logger.info(`Environment: ${config.env}`);
  logger.info(`CORS origins: ${config.cors.origins.join(', ')}`);
});