import { Router } from 'express';

import { reviewByDelayController } from '../controller/review.controller.js';

export const reviewRouter = Router();

reviewRouter.get('/by-delay', reviewByDelayController);
