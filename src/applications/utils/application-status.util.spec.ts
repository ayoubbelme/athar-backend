import { ApplicationStatus as A, ProjectStatus as P } from '@prisma/client';
import { canTransition, isOpenForApplications, isOpenForReview } from './application-status.util';

describe('application status machine', () => {
  it.each([
    [A.PENDING, A.ACCEPTED],
    [A.PENDING, A.REJECTED],
    [A.PENDING, A.WITHDRAWN],
    [A.ACCEPTED, A.REJECTED],
    [A.ACCEPTED, A.WITHDRAWN],
    [A.WITHDRAWN, A.PENDING], // re-apply
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    [A.PENDING, A.PENDING],
    [A.ACCEPTED, A.ACCEPTED],
    [A.ACCEPTED, A.PENDING],
    [A.REJECTED, A.ACCEPTED], // rejection is final
    [A.REJECTED, A.PENDING],
    [A.REJECTED, A.WITHDRAWN],
    [A.WITHDRAWN, A.ACCEPTED], // must re-apply first
    [A.WITHDRAWN, A.REJECTED],
  ])('forbids %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('only PUBLISHED projects accept applications', () => {
    expect(isOpenForApplications(P.PUBLISHED)).toBe(true);
    for (const s of [P.DRAFT, P.IN_PROGRESS, P.COMPLETED, P.CANCELLED]) {
      expect(isOpenForApplications(s)).toBe(false);
    }
  });

  it('applications can be reviewed while the project is PUBLISHED or IN_PROGRESS', () => {
    expect(isOpenForReview(P.PUBLISHED)).toBe(true);
    expect(isOpenForReview(P.IN_PROGRESS)).toBe(true);
    for (const s of [P.DRAFT, P.COMPLETED, P.CANCELLED]) expect(isOpenForReview(s)).toBe(false);
  });
});
