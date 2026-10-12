import type {
  WorkoutHistoryDetail,
  WorkoutHistoryPage,
  WorkoutHistorySummary,
} from '../../src/features/history/history.types';
import { sessionFixture, setFixture } from './workout-fixture';

export function historyDetail(): WorkoutHistoryDetail {
  return {
    ...sessionFixture(),
    name: 'Push Original',
    status: 'COMPLETED',
    endedAt: '2026-10-12T10:00:00.500Z',
    notes: 'Historical workout notes',
  };
}
export function historySummary(): WorkoutHistorySummary {
  const detail = historyDetail();
  return {
    id: detail.id,
    name: detail.name,
    status: detail.status,
    startedAt: detail.startedAt,
    endedAt: detail.endedAt,
    exerciseCount: 1,
    setCount: 1,
  };
}
export function historyPage(): WorkoutHistoryPage {
  return {
    items: [historySummary()],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  };
}
export function cancelledHistory(): WorkoutHistoryDetail {
  const detail = historyDetail();
  return {
    ...detail,
    status: 'CANCELLED',
    exercises: detail.exercises.map((entry) => ({
      ...entry,
      exercise: { ...entry.exercise, sourceExerciseId: null },
      sets: [
        setFixture({ loadKg: 0, reps: 10, rpe: null, rir: null }),
        setFixture({ id: 'later-set', position: 2 }),
      ],
    })),
  };
}
