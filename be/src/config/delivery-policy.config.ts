export interface DeliveryPolicyConfig {
  segmentDim: 'customer_state';
  targetLateRate: number;
  safetyMargin: number;
  kMin: number;
  kMax: number;
  trainStartDate: string | null;
  splitDate: string | null;
  testEndDate: string | null;
  minSegmentNTrain: number;
  minSegmentNTest: number;
  maxReviewDrop: number | null;
  reviewBucketEdges: number[];
  minBucketN: number;
}

export const defaultConfig: DeliveryPolicyConfig = {
  segmentDim: 'customer_state',
  targetLateRate: 0.05,
  safetyMargin: 0,
  kMin: -30,
  kMax: 30,
  trainStartDate: '2017-01-01',
  splitDate: null,
  testEndDate: null,
  minSegmentNTrain: 300,
  minSegmentNTest: 300,
  maxReviewDrop: null,
  reviewBucketEdges: [-15, -8, -1, 0, 3, 7],
  minBucketN: 100,
};
