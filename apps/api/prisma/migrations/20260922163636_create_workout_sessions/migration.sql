-- CreateEnum
CREATE TYPE "workout_session_status" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "workout_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "source_template_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "status" "workout_session_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_session_exercises" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workout_session_id" UUID NOT NULL,
    "source_exercise_id" UUID,
    "position" INTEGER NOT NULL,
    "exercise_name" VARCHAR(120) NOT NULL,
    "exercise_slug" VARCHAR(140) NOT NULL,
    "primary_muscle" "muscle_group" NOT NULL,
    "secondary_muscles" "muscle_group"[] DEFAULT ARRAY[]::"muscle_group"[],
    "equipment" "equipment" NOT NULL,
    "movement_pattern" "movement_pattern" NOT NULL,
    "planned_sets" INTEGER NOT NULL,
    "planned_reps_min" INTEGER NOT NULL,
    "planned_reps_max" INTEGER NOT NULL,
    "planned_rest_seconds" INTEGER NOT NULL,
    "planned_notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workout_session_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workout_sessions_user_started_idx" ON "workout_sessions"("user_id", "started_at", "id");

-- CreateIndex
CREATE INDEX "workout_sessions_user_status_idx" ON "workout_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "workout_sessions_source_template_idx" ON "workout_sessions"("source_template_id");

-- CreateIndex
CREATE INDEX "workout_session_exercises_source_idx" ON "workout_session_exercises"("source_exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_session_exercises_position_key" ON "workout_session_exercises"("workout_session_id", "position");

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "workout_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_session_exercises" ADD CONSTRAINT "workout_session_exercises_workout_session_id_fkey" FOREIGN KEY ("workout_session_id") REFERENCES "workout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_session_exercises" ADD CONSTRAINT "workout_session_exercises_source_exercise_id_fkey" FOREIGN KEY ("source_exercise_id") REFERENCES "exercises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Snapshot invariants not expressible as Prisma schema checks.
ALTER TABLE "workout_session_exercises"
    ADD CONSTRAINT "workout_session_exercises_position_check" CHECK ("position" >= 1),
    ADD CONSTRAINT "workout_session_exercises_sets_check" CHECK ("planned_sets" >= 1),
    ADD CONSTRAINT "workout_session_exercises_reps_check" CHECK ("planned_reps_min" >= 1 AND "planned_reps_max" >= "planned_reps_min"),
    ADD CONSTRAINT "workout_session_exercises_rest_check" CHECK ("planned_rest_seconds" >= 0);

ALTER TABLE "workout_sessions"
    ADD CONSTRAINT "workout_sessions_ended_state_check" CHECK (
        ("status" = 'IN_PROGRESS' AND "ended_at" IS NULL) OR
        ("status" IN ('COMPLETED', 'CANCELLED') AND "ended_at" IS NOT NULL)
    );
