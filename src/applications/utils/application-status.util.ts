import { ApplicationStatus, ProjectStatus } from '@prisma/client';

/**
 * Allowed application transitions.
 *
 *   PENDING ──► ACCEPTED ──► REJECTED        (organization decisions)
 *      │            │
 *      ├──► REJECTED (final)
 *      └──► WITHDRAWN ◄──────┘               (volunteer, via DELETE)
 *
 *   WITHDRAWN ──► PENDING                    (volunteer re-applies; never via PATCH)
 *
 * REJECTED is final.
 */
export const APPLICATION_TRANSITIONS: Readonly<
  Record<ApplicationStatus, readonly ApplicationStatus[]>
> = {
  [ApplicationStatus.PENDING]: [
    ApplicationStatus.ACCEPTED,
    ApplicationStatus.REJECTED,
    ApplicationStatus.WITHDRAWN,
  ],
  [ApplicationStatus.ACCEPTED]: [ApplicationStatus.REJECTED, ApplicationStatus.WITHDRAWN],
  [ApplicationStatus.REJECTED]: [],
  [ApplicationStatus.WITHDRAWN]: [ApplicationStatus.PENDING],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

/** Statuses an organization may set through PATCH /applications/:id/status. */
export const REVIEW_DECISIONS = [ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED] as const;

/** Volunteers can only apply while the project is published. */
export function isOpenForApplications(status: ProjectStatus): boolean {
  return status === ProjectStatus.PUBLISHED;
}

/** Organizations can review (and volunteers can withdraw) while the project is still running. */
export function isOpenForReview(status: ProjectStatus): boolean {
  return status === ProjectStatus.PUBLISHED || status === ProjectStatus.IN_PROGRESS;
}
