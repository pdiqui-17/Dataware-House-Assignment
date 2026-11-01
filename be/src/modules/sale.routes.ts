import { Router } from "express";
import { rollUpController } from "../controller/sale.controller.js";
export const saleRouter = Router();

saleRouter.get('/analysis', rollUpController);