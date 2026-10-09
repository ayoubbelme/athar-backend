import { ProjectStatus } from '@prisma/client';

/**
 * Allowed project lifecycle transitions.
 *
 *   DRAFT ──► PUBLISHED ──► IN_PROGRESS ──► COMPLETED
 *     │            │              │
 *     └────────────┴──────────────┴──────► CANCELLED
 *
 * COMPLETED and CANCELLED are terminal. Un-publishing is deliberately not allowed:
 * volunteers may already have applied.
 */
export const PROJECT_STATUS_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> =
  {
    [ProjectStatus.DRAFT]: [ProjectStatus.PUBLISHED, ProjectStatus.CANCELLED],
    [ProjectStatus.PUBLISHED]: [ProjectStatus.IN_PROGRESS, ProjectStatus.CANCELLED],
    [ProjectStatus.IN_PROGRESS]: [ProjectStatus.COMPLETED, ProjectStatus.CANCELLED],
    [ProjectStatus.COMPLETED]: [],
    [ProjectStatus.CANCELLED]: [],
  };

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_STATUS_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ProjectStatus): boolean {
  return PROJECT_STATUS_TRANSITIONS[status].length === 0;
}
