import type { RequestHandler } from 'express';

import { filterService } from '../service/meta.service.js';

export const filterDropDownController: RequestHandler = async (_req, res, next) => {
  try {
    const dimensions = await filterService();
    res.json({ data: dimensions });
  } catch (error) {
    next(error);
  }
};
