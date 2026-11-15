import { Router } from 'express';

import { filterDropDownController } from '../controller/meta.controller.js';
import { pivotMetadataController } from '../controller/pivot.controller.js';

export const metaRouter = Router();

metaRouter.get('/dimensions', filterDropDownController);
metaRouter.get('/pivot', pivotMetadataController);
