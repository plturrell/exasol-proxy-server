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

// Health check (no auth required)
app.get('/health', async (req, res) => {
  const health = await pool.getHealth();
  res.status(health.healthy ? 200 : 503).json(health);
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