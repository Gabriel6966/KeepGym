export interface CalendarQuery {
  fromDate: string;
  toDate: string;
  timezone: string;
}
export interface CalendarDay {
  date: string;
  completedWorkouts: number;
  completedSets: number;
  totalReps: number;
  totalVolumeKg: number;
  totalDurationSeconds: number;
}
export interface TrainingCalendar extends CalendarQuery {
  days: CalendarDay[];
}
