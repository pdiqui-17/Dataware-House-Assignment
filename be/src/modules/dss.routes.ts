import { Router } from 'express';
import {
  dssConfigController,
  deliveryBufferController,
  deliveryBufferTradeoffController,
  sellerScorecardController,
} from '../controller/dss.controller.js';

export const dssRouter = Router();

dssRouter.get('/seller-scorecard', sellerScorecardController);
dssRouter.get('/config', dssConfigController);
dssRouter.get('/delivery-buffer', deliveryBufferController);
dssRouter.get('/delivery-buffer/tradeoff', deliveryBufferTradeoffController);
