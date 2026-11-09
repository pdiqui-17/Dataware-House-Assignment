import { Router } from 'express';
import { rollUpController } from '../controller/sale.controller.js';
import { salesPivotController } from '../controller/pivot.controller.js';
export const saleRouter = Router();

saleRouter.get('/pivot', salesPivotController);
saleRouter.get('/analysis', rollUpController);
