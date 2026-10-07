export interface TrainingCalendarInput {
  fromDate: string;
  toDate: string;
  timezone: string;
}
export interface TrainingCalendarQuery extends TrainingCalendarInput {
  totalDays: number;
}
export interface DailyActivityRecord {
  date: string;
  completedWorkouts: string;
  completedSets: string;
  totalReps: string;
  totalVolumeKg: string;
  totalDurationSeconds: string | null;
  invalidDurationCount: string;
}
export interface PublicActivityDay {
  date: string;
  completedWorkouts: number;
  completedSets: number;
  totalReps: number;
  totalVolumeKg: number;
  totalDurationSeconds: number;
}
export interface PublicTrainingCalendar extends TrainingCalendarInput {
  days: PublicActivityDay[];
}
