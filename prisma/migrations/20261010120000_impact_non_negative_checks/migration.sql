-- Defense in depth: impact figures can never be negative, regardless of which code writes them.
-- (Prisma does not model CHECK constraints; they are ignored by its schema diffing, so no drift.)
ALTER TABLE "impacts"
  ADD CONSTRAINT "impacts_volunteersCount_non_negative" CHECK ("volunteersCount" >= 0),
  ADD CONSTRAINT "impacts_hours_non_negative" CHECK ("hours" >= 0),
  ADD CONSTRAINT "impacts_activitiesCount_non_negative" CHECK ("activitiesCount" >= 0),
  ADD CONSTRAINT "impacts_beneficiariesCount_non_negative" CHECK ("beneficiariesCount" >= 0);
