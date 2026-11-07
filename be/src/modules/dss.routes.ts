import { Router } from 'express';
import {
  dssConfigController,
  sellerScorecardController,
} from '../controller/dss.controller.js';

export const dssRouter = Router();

dssRouter.get('/seller-scorecard', sellerScorecardController);
dssRouter.get('/config', dssConfigController);
