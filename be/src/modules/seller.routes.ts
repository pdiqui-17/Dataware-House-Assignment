import { Router } from 'express';

import {
  sellerDetailController,
  sellerListController,
} from '../controller/seller.controller.js';

export const sellerRouter = Router();

sellerRouter.get('/', sellerListController);
sellerRouter.get('/:id', sellerDetailController);
