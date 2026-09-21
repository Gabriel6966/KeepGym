-- CreateEnum
CREATE TYPE "muscle_group" AS ENUM ('CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'FOREARMS', 'QUADRICEPS', 'HAMSTRINGS', 'GLUTES', 'CALVES', 'CORE');

-- CreateEnum
CREATE TYPE "equipment" AS ENUM ('BARBELL', 'DUMBBELL', 'MACHINE', 'CABLE', 'BODYWEIGHT', 'KETTLEBELL', 'SMITH_MACHINE', 'EZ_BAR', 'RESISTANCE_BAND', 'OTHER');

-- CreateEnum
CREATE TYPE "movement_pattern" AS ENUM ('HORIZONTAL_PUSH', 'VERTICAL_PUSH', 'HORIZONTAL_PULL', 'VERTICAL_PULL', 'SQUAT', 'HINGE', 'LUNGE', 'ISOLATION', 'CARRY', 'OTHER');

-- CreateTable
CREATE TABLE "exercises" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" TEXT,
    "instructions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primary_muscle" "muscle_group" NOT NULL,
    "secondary_muscles" "muscle_group"[] DEFAULT ARRAY[]::"muscle_group"[],
    "equipment" "equipment" NOT NULL,
    "movement_pattern" "movement_pattern" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exercises_slug_key" ON "exercises"("slug");

-- CreateIndex
CREATE INDEX "exercises_active_name_id_idx" ON "exercises"("is_active", "name", "id");

-- CreateIndex
CREATE INDEX "exercises_muscle_active_idx" ON "exercises"("primary_muscle", "is_active");

-- CreateIndex
CREATE INDEX "exercises_equipment_active_idx" ON "exercises"("equipment", "is_active");

-- CreateIndex
CREATE INDEX "exercises_movement_active_idx" ON "exercises"("movement_pattern", "is_active");
