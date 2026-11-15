import type { RequestHandler } from 'express';

import { getPivotMetadata, type PivotCubeName } from '../model/pivot.model.js';
import { parsePivotQuery, pivotService, PivotValidationError } from '../service/pivot.service.js';

function createPivotController(cube: PivotCubeName): RequestHandler {
  return async (req, res, next) => {
    try {
      const params = parsePivotQuery(req.query, cube);
      res.json(await pivotService(params));
    } catch (error) {
      if (error instanceof PivotValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }

      next(error);
    }
  };
}

export const salesPivotController = createPivotController('sales');
export const deliveryPivotController = createPivotController('delivery');

export const pivotMetadataController: RequestHandler = (_req, res) => {
  res.json({ data: getPivotMetadata() });
};
