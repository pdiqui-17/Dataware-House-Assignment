import { Router } from 'express';

import { pool } from '../../config/db.config.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.status(200).json({
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    },
  });
});

export const dbRouter = Router();

dbRouter.get('/', async (_req, res, next) => {

  try{
    const result = await pool.query(
      'SELECT NOW() AS database_time', 
    );
    res.json({
      status: 'ok',
      database: 'connected',
      time: result.rows[0].database_time,
    });
  }
  catch(error)
  {
    next(error);
  }


})