// Don't load .env in production - Railway injects env vars directly
if (process.env.NODE_ENV !== 'production') {
  const dotenv = await import('dotenv');
  dotenv.config();
}

// Debug: Log environment variables (redacted)
console.log('Environment variables loaded:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('EXASOL_HOST:', process.env.EXASOL_HOST);
console.log('EXASOL_USER:', process.env.EXASOL_USER);
console.log('EXASOL_PAT:', process.env.EXASOL_PAT ? '[REDACTED]' : undefined);
console.log('EXASOL_PASSWORD:', process.env.EXASOL_PASSWORD ? '[REDACTED]' : undefined);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000'),
  
  exasol: {
    host: process.env.EXASOL_HOST || '6c2pxsycfjdudh5tsy6bb4cqzy.clusters.exasol.com',
    port: parseInt(process.env.EXASOL_PORT || '8563'),
    user: process.env.EXASOL_USER || 'admin',
    password: process.env.EXASOL_PASSWORD || process.env.EXASOL_PAT,
    schema: process.env.EXASOL_SCHEMA || 'app_data',
    encryption: process.env.EXASOL_ENCRYPTION !== 'false',
    
    pool: {
      min: parseInt(process.env.POOL_MIN || '2'),
      max: parseInt(process.env.POOL_MAX || '10'),
      idleTimeout: parseInt(process.env.POOL_IDLE_TIMEOUT || '300000'), // 5 minutes
      acquireTimeout: parseInt(process.env.POOL_ACQUIRE_TIMEOUT || '30000'), // 30 seconds
      connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT || '10000'), // 10 seconds
      healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000') // 1 minute
    }
  },
  
  auth: {
    apiKeys: (process.env.API_KEYS || '').split(',').filter(Boolean),
    jwtSecret: process.env.JWT_SECRET
  },
  
  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000,https://hana-proxy-vercel.vercel.app').split(',')
  },
  
  rateLimit: {
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100')
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};

// Validate required config - but don't crash on startup
const required = ['EXASOL_HOST', 'EXASOL_USER', 'EXASOL_PASSWORD'];
const missing = [];
for (const key of required) {
  if (!process.env[key] && key === 'EXASOL_PASSWORD' && !process.env.EXASOL_PAT) {
    missing.push(`${key} or EXASOL_PAT`);
  } else if (!process.env[key] && key !== 'EXASOL_PASSWORD') {
    missing.push(key);
  }
}

if (missing.length > 0) {
  console.warn(`⚠️  Missing environment variables: ${missing.join(', ')}`);
  console.warn('The service will start but database operations will fail.');
}