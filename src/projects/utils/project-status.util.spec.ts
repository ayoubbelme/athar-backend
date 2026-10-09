import { ProjectStatus as S } from '@prisma/client';
import { canTransition, isTerminal } from './project-status.util';

describe('project status machine', () => {
  it.each([
    [S.DRAFT, S.PUBLISHED],
    [S.DRAFT, S.CANCELLED],
    [S.PUBLISHED, S.IN_PROGRESS],
    [S.PUBLISHED, S.CANCELLED],
    [S.IN_PROGRESS, S.COMPLETED],
    [S.IN_PROGRESS, S.CANCELLED],
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    [S.DRAFT, S.IN_PROGRESS],
    [S.DRAFT, S.COMPLETED],
    [S.PUBLISHED, S.DRAFT], // no un-publishing
    [S.PUBLISHED, S.COMPLETED], // must go through IN_PROGRESS
    [S.IN_PROGRESS, S.PUBLISHED],
    [S.COMPLETED, S.CANCELLED],
    [S.COMPLETED, S.IN_PROGRESS],
    [S.CANCELLED, S.DRAFT],
    [S.CANCELLED, S.PUBLISHED],
  ])('forbids %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('treats COMPLETED and CANCELLED as terminal only', () => {
    expect(isTerminal(S.COMPLETED)).toBe(true);
    expect(isTerminal(S.CANCELLED)).toBe(true);
    expect([S.DRAFT, S.PUBLISHED, S.IN_PROGRESS].some(isTerminal)).toBe(false);
  });
});
