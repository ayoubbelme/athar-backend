-- Phase 6 (matching): availability becomes a fixed set, interests/category are introduced.
-- Existing free-text availability is converted on a best-effort basis instead of being dropped.

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('WEEKDAYS', 'WEEKENDS', 'EVENINGS', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "ProjectCategory" AS ENUM ('EDUCATION', 'HEALTH', 'ENVIRONMENT', 'COMMUNITY', 'HUMANITARIAN', 'ARTS_CULTURE', 'SPORTS', 'TECHNOLOGY', 'ANIMAL_WELFARE');

-- Keep the old text columns until the data has been converted.
ALTER TABLE "users" RENAME COLUMN "availability" TO "availability_old";
ALTER TABLE "volunteer_profiles" RENAME COLUMN "availability" TO "availability_old";

-- AlterTable
ALTER TABLE "users" ADD COLUMN "availability" "Availability"[] DEFAULT ARRAY[]::"Availability"[];

-- AlterTable
ALTER TABLE "volunteer_profiles" ADD COLUMN "availability" "Availability"[] DEFAULT ARRAY[]::"Availability"[],
ADD COLUMN "interests" "ProjectCategory"[] DEFAULT ARRAY[]::"ProjectCategory"[];

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "availability" "Availability"[] DEFAULT ARRAY[]::"Availability"[],
ADD COLUMN "category" "ProjectCategory";

-- Best-effort conversion of free text such as "Weekends and evenings" to enum values.
UPDATE "users" SET "availability" = ARRAY_REMOVE(ARRAY[
  CASE WHEN "availability_old" ~* 'weekday' THEN 'WEEKDAYS' END,
  CASE WHEN "availability_old" ~* 'weekend' THEN 'WEEKENDS' END,
  CASE WHEN "availability_old" ~* 'evening' THEN 'EVENINGS' END,
  CASE WHEN "availability_old" ~* '(flexible|any ?time)' THEN 'FLEXIBLE' END
], NULL)::TEXT[]::"Availability"[]
WHERE "availability_old" IS NOT NULL;

UPDATE "volunteer_profiles" SET "availability" = ARRAY_REMOVE(ARRAY[
  CASE WHEN "availability_old" ~* 'weekday' THEN 'WEEKDAYS' END,
  CASE WHEN "availability_old" ~* 'weekend' THEN 'WEEKENDS' END,
  CASE WHEN "availability_old" ~* 'evening' THEN 'EVENINGS' END,
  CASE WHEN "availability_old" ~* '(flexible|any ?time)' THEN 'FLEXIBLE' END
], NULL)::TEXT[]::"Availability"[]
WHERE "availability_old" IS NOT NULL;

-- Drop the old columns.
ALTER TABLE "users" DROP COLUMN "availability_old";
ALTER TABLE "volunteer_profiles" DROP COLUMN "availability_old";

-- CreateIndex
CREATE INDEX "projects_category_idx" ON "projects"("category");
