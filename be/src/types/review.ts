export enum ReviewGroup {
  BUCKET = 'bucket',
  FLAG = 'flag',
}

export interface ReviewByDelayParams {
  from?: string;
  to?: string;
  state?: string;
  group?: ReviewGroup;
}

export interface ReviewByDelayQuery {
  from?: string;
  to?: string;
  state?: string;
  group?: string;
}
