-- CreateTable
CREATE TABLE "body_measurements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "measured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weight_kg" DECIMAL(6,2),
    "body_fat_percent" DECIMAL(5,2),
    "waist_cm" DECIMAL(6,2),
    "chest_cm" DECIMAL(6,2),
    "hips_cm" DECIMAL(6,2),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "body_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "body_measurements_user_measured_idx" ON "body_measurements"("user_id", "measured_at", "id");

-- AddForeignKey
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Canonical units and nonempty observations, independent of HTTP validation.
ALTER TABLE "body_measurements"
    ADD CONSTRAINT "body_measurements_weight_check" CHECK ("weight_kg" IS NULL OR ("weight_kg" > 0 AND "weight_kg" <= 1000)),
    ADD CONSTRAINT "body_measurements_body_fat_check" CHECK ("body_fat_percent" IS NULL OR ("body_fat_percent" > 0 AND "body_fat_percent" <= 100)),
    ADD CONSTRAINT "body_measurements_waist_check" CHECK ("waist_cm" IS NULL OR ("waist_cm" > 0 AND "waist_cm" <= 500)),
    ADD CONSTRAINT "body_measurements_chest_check" CHECK ("chest_cm" IS NULL OR ("chest_cm" > 0 AND "chest_cm" <= 500)),
    ADD CONSTRAINT "body_measurements_hips_check" CHECK ("hips_cm" IS NULL OR ("hips_cm" > 0 AND "hips_cm" <= 500)),
    ADD CONSTRAINT "body_measurements_metric_check" CHECK (
        "weight_kg" IS NOT NULL OR "body_fat_percent" IS NOT NULL OR
        "waist_cm" IS NOT NULL OR "chest_cm" IS NOT NULL OR "hips_cm" IS NOT NULL
    );
