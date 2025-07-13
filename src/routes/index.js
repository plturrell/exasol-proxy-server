import express from 'express';

export default (pool) => {
  const router = express.Router();

  // Execute query
  router.post('/query', async (req, res, next) => {
    try {
      const { sql, parameters = [] } = req.body;
      
      if (!sql) {
        return res.status(400).json({ error: 'Missing SQL query' });
      }
      
      const result = await pool.execute(sql, parameters);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Execute UDF
  router.post('/executeUDF', async (req, res, next) => {
    try {
      const { functionName, parameters = [] } = req.body;
      
      if (!functionName) {
        return res.status(400).json({ error: 'Missing function name' });
      }
      
      const result = await pool.executeUDF(functionName, parameters);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Execute multiple queries in transaction
  router.post('/transaction', async (req, res, next) => {
    try {
      const { queries } = req.body;
      
      if (!Array.isArray(queries) || queries.length === 0) {
        return res.status(400).json({ error: 'Missing queries array' });
      }
      
      const conn = await pool.acquire();
      
      try {
        // Disable autocommit
        await conn.execute('SET AUTOCOMMIT OFF');
        
        const results = [];
        for (const { sql, parameters = [] } of queries) {
          const result = await conn.execute(sql, parameters);
          results.push(result);
        }
        
        // Commit transaction
        await conn.execute('COMMIT');
        
        res.json({ success: true, results });
      } catch (err) {
        // Rollback on error
        await conn.execute('ROLLBACK');
        throw err;
      } finally {
        await conn.execute('SET AUTOCOMMIT ON');
        pool.release(conn);
      }
    } catch (err) {
      next(err);
    }
  });

  // Get connection pool stats
  router.get('/stats', async (req, res) => {
    const health = await pool.getHealth();
    res.json(health);
  });

  return router;
};