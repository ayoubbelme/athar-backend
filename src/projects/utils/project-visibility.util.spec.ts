import { Role } from '@prisma/client';
import { buildVisibilityFilter } from './project-visibility.util';

const PUBLIC = {
  status: { not: 'DRAFT' },
  organization: { user: { status: 'ACTIVE' } },
};

describe('buildVisibilityFilter', () => {
  it('lets ADMIN see everything', () => {
    expect(buildVisibilityFilter({ role: Role.ADMIN }, null)).toEqual({});
  });

  it('shows volunteers public projects only (no drafts, no suspended organizations)', () => {
    expect(buildVisibilityFilter({ role: Role.VOLUNTEER }, null)).toEqual(PUBLIC);
  });

  it('shows organizations their own projects plus public ones', () => {
    expect(buildVisibilityFilter({ role: Role.ORGANIZATION }, 'org-1')).toEqual({
      OR: [{ organizationId: 'org-1' }, PUBLIC],
    });
  });

  it('falls back to public-only for an organization user without a profile', () => {
    expect(buildVisibilityFilter({ role: Role.ORGANIZATION }, null)).toEqual(PUBLIC);
  });
});
