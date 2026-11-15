import { Router } from 'express';

import {
  deliveryAnalysisController,
  deliveryDistributionController,
} from '../controller/delivery.controller.js';
import { deliveryPivotController } from '../controller/pivot.controller.js';

export const deliveryRouter = Router();

deliveryRouter.get('/analysis', deliveryAnalysisController);
deliveryRouter.get('/distribution', deliveryDistributionController);
deliveryRouter.get('/pivot', deliveryPivotController);
