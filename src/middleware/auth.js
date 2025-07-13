import { config } from '../config.js';

export const authenticate = (req, res, next) => {
  // Skip auth in development
  if (config.env === 'development' && !config.auth.apiKeys.length) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key' });
  }
  
  if (!config.auth.apiKeys.includes(apiKey)) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  
  next();
};