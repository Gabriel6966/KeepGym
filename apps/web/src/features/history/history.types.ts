import type { ResourcePage, WorkoutSession } from '../workout/workout.types';

export const historyStatuses = ['COMPLETED', 'CANCELLED'] as const;
export type HistoryStatus = (typeof historyStatuses)[number];
export interface WorkoutHistoryQuery {
  page?: number;
  limit?: number;
  status?: HistoryStatus;
  q?: string;
  from?: string;
  to?: string;
}
export interface WorkoutHistorySummary {
  id: string;
  name: string;
  status: HistoryStatus;
  startedAt: string;
  endedAt: string | null;
  exerciseCount: number;
  setCount: number;
}
// The dedicated History detail shares the historical session representation,
// not its mutation API. It has neither source template metadata nor aggregates.
export interface WorkoutHistoryDetail extends Omit<WorkoutSession, 'status'> {
  status: HistoryStatus;
}
export type WorkoutHistoryPage = ResourcePage<WorkoutHistorySummary>;
