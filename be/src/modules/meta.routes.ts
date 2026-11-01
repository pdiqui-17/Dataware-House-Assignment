import { Router } from 'express';

import { filterDropDownController } from '../controller/meta.controller.js';

export const metaRouter = Router();

metaRouter.get('/dimensions', filterDropDownController);
