import { AccountStatus, Prisma, ProjectStatus, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

/**
 * Which projects a user may see (used by both list and detail so they can never disagree):
 *  - ADMIN: everything
 *  - ORGANIZATION: its own projects (including drafts) + every public project
 *  - VOLUNTEER: public projects only
 * "Public" = not a draft and the owning organization is not suspended.
 */
export function buildVisibilityFilter(
  user: Pick<AuthenticatedUser, 'role'>,
  ownOrganizationId: string | null,
): Prisma.ProjectWhereInput {
  if (user.role === Role.ADMIN) return {};

  const publicProjects: Prisma.ProjectWhereInput = {
    status: { not: ProjectStatus.DRAFT },
    organization: { user: { status: AccountStatus.ACTIVE } },
  };

  if (user.role === Role.ORGANIZATION && ownOrganizationId) {
    return { OR: [{ organizationId: ownOrganizationId }, publicProjects] };
  }
  return publicProjects;
}
