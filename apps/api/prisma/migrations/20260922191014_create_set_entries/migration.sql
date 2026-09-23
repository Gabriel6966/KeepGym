-- CreateTable
CREATE TABLE "set_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workout_session_exercise_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "load_kg" DECIMAL(8,2) NOT NULL,
    "reps" INTEGER NOT NULL,
    "rpe" DECIMAL(3,1),
    "rir" INTEGER,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "set_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "set_entries_exercise_position_key" ON "set_entries"("workout_session_exercise_id", "position");

-- AddForeignKey
ALTER TABLE "set_entries" ADD CONSTRAINT "set_entries_workout_session_exercise_id_fkey" FOREIGN KEY ("workout_session_exercise_id") REFERENCES "workout_session_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants for recorded performance, independent of HTTP validation.
ALTER TABLE "set_entries"
    ADD CONSTRAINT "set_entries_position_check" CHECK ("position" >= 1),
    ADD CONSTRAINT "set_entries_load_check" CHECK ("load_kg" >= 0 AND "load_kg" <= 10000),
    ADD CONSTRAINT "set_entries_reps_check" CHECK ("reps" >= 1 AND "reps" <= 1000),
    ADD CONSTRAINT "set_entries_rpe_check" CHECK ("rpe" IS NULL OR ("rpe" >= 1 AND "rpe" <= 10 AND mod("rpe", 0.5) = 0)),
    ADD CONSTRAINT "set_entries_rir_check" CHECK ("rir" IS NULL OR ("rir" >= 0 AND "rir" <= 10));
