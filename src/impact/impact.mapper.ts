import { Impact } from '@prisma/client';

export interface ImpactView {
  id: string;
  projectId: string;
  volunteersCount: number;
  acceptedVolunteers: number;
  hours: number;
  activitiesCount: number;
  beneficiariesCount: number;
  resources: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `hours` is stored as DECIMAL(10,2) (exact); clients get a plain number.
 * Values stay far below 2^53, so the conversion is lossless.
 * The internal `metrics` extension column is intentionally not exposed yet.
 */
export const toImpactView = (row: Impact, acceptedVolunteers: number): ImpactView => ({
  id: row.id,
  projectId: row.projectId,
  volunteersCount: row.volunteersCount,
  acceptedVolunteers,
  hours: row.hours.toNumber(),
  activitiesCount: row.activitiesCount,
  beneficiariesCount: row.beneficiariesCount,
  resources: row.resources,
  description: row.description,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
