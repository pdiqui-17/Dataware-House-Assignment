import { Router } from 'express';

import {
  deliveryAnalysisController,
  deliveryDistributionController,
} from '../controller/delivery.controller.js';

export const deliveryRouter = Router();

deliveryRouter.get('/analysis', deliveryAnalysisController);
deliveryRouter.get('/distribution', deliveryDistributionController);
