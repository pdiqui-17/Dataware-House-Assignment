import type { RequestHandler } from 'express';

import { reviewByDelayService } from '../service/review.service.js';
import { ReviewGroup, type ReviewByDelayQuery } from '../types/review.js';

const queryString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const isReviewGroup = (value: string): value is ReviewGroup =>
  value === ReviewGroup.BUCKET || value === ReviewGroup.FLAG;

const isDate = (value: string | undefined): boolean =>
  value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value);

export const reviewByDelayController: RequestHandler<
  Record<string, never>,
  unknown,
  unknown,
  ReviewByDelayQuery
> = async (req, res, next) => {
  try {
    const from = queryString(req.query.from);
    const to = queryString(req.query.to);
    const groupValue = queryString(req.query.group) ?? ReviewGroup.BUCKET;

    if (!isReviewGroup(groupValue)) {
      res.status(400).json({ error: 'group phải là bucket hoặc flag' });
      return;
    }
    if (!isDate(from) || !isDate(to)) {
      res.status(400).json({ error: 'from/to phải có dạng YYYY-MM-DD' });
      return;
    }

    res.json(
      await reviewByDelayService({
        from,
        to,
        state: queryString(req.query.state),
        group: groupValue,
      }),
    );
  } catch (error) {
    next(error);
  }
};
