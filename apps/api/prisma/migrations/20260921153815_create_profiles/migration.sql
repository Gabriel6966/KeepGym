-- CreateEnum
CREATE TYPE "experience_level" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "training_goal" AS ENUM ('GENERAL_FITNESS', 'MUSCLE_GAIN', 'STRENGTH', 'ENDURANCE');

-- CreateEnum
CREATE TYPE "unit_system" AS ENUM ('METRIC', 'IMPERIAL');

-- CreateTable
CREATE TABLE "profiles" (
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "birth_date" DATE,
    "height_cm" INTEGER,
    "experience_level" "experience_level",
    "training_goal" "training_goal",
    "unit_system" "unit_system" NOT NULL DEFAULT 'METRIC',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
