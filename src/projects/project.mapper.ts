import {
  ApplicationStatus,
  Availability,
  Prisma,
  ProjectCategory,
  ProjectStatus,
} from '@prisma/client';

/** Relations loaded whenever a project is returned to a client (or used for matching). */
export const PROJECT_INCLUDE = {
  organization: { select: { id: true, name: true, logo: true, location: true } },
  skills: {
    include: { skill: { select: { id: true, name: true } } },
    orderBy: { skill: { name: 'asc' } },
  },
  _count: { select: { applications: { where: { status: ApplicationStatus.ACCEPTED } } } },
} satisfies Prisma.ProjectInclude;

export type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;

export interface ProjectView {
  id: string;
  organizationId: string;
  title: string;
  description: string;
  location: string | null;
  startDate: Date | null;
  endDate: Date | null;
  status: ProjectStatus;
  maxVolunteers: number | null;
  category: ProjectCategory | null;
  availability: Availability[];
  acceptedVolunteers: number;
  organization: ProjectRow['organization'];
  skills: Array<{ skill: { id: string; name: string }; requiredCount: number; importance: number }>;
  createdAt: Date;
  updatedAt: Date;
}

export const toProjectView = (row: ProjectRow): ProjectView => ({
  id: row.id,
  organizationId: row.organizationId,
  title: row.title,
  description: row.description,
  location: row.location,
  startDate: row.startDate,
  endDate: row.endDate,
  status: row.status,
  maxVolunteers: row.maxVolunteers,
  category: row.category,
  availability: row.availability,
  acceptedVolunteers: row._count.applications,
  organization: row.organization,
  skills: row.skills.map((s) => ({
    skill: s.skill,
    requiredCount: s.requiredCount,
    importance: s.importance,
  })),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
