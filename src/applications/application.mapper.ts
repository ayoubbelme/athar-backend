import { ApplicationStatus, Prisma, ProficiencyLevel, ProjectStatus, Role } from '@prisma/client';

/** Volunteer's own view: the project they applied to. */
export const MY_APPLICATION_INCLUDE = {
  project: {
    select: {
      id: true,
      title: true,
      status: true,
      location: true,
      startDate: true,
      endDate: true,
      organization: { select: { id: true, name: true, logo: true } },
    },
  },
} satisfies Prisma.ApplicationInclude;

/** Organization's view: the applicant's profile and skills. */
export const REVIEW_APPLICATION_INCLUDE = {
  volunteer: {
    select: {
      id: true,
      name: true,
      email: true,
      location: true,
      availability: true,
      volunteerProfile: { select: { bio: true, phone: true, experience: true } },
      skills: {
        include: { skill: { select: { id: true, name: true } } },
        orderBy: { skill: { name: 'asc' } },
      },
    },
  },
} satisfies Prisma.ApplicationInclude;

type MyRow = Prisma.ApplicationGetPayload<{ include: typeof MY_APPLICATION_INCLUDE }>;
type ReviewRow = Prisma.ApplicationGetPayload<{ include: typeof REVIEW_APPLICATION_INCLUDE }>;

export interface MyApplicationView {
  id: string;
  status: ApplicationStatus;
  matchScore: number | null;
  message: string | null;
  project: {
    id: string;
    title: string;
    status: ProjectStatus;
    location: string | null;
    startDate: Date | null;
    endDate: Date | null;
    organization: { id: string; name: string; logo: string | null };
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewApplicationView {
  id: string;
  projectId: string;
  status: ApplicationStatus;
  matchScore: number | null;
  message: string | null;
  volunteer: {
    id: string;
    name: string;
    location: string | null;
    availability: string | null;
    bio: string | null;
    experience: string | null;
    skills: Array<{ id: string; name: string; proficiency: ProficiencyLevel }>;
    contact: { email: string; phone: string | null } | null;
  };
  createdAt: Date;
  updatedAt: Date;
}

export const toMyApplicationView = (row: MyRow): MyApplicationView => ({
  id: row.id,
  status: row.status,
  matchScore: row.matchScore,
  message: row.message,
  project: row.project,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Privacy rule: contact details (email, phone) of an applicant are only revealed to the
 * organization once the application is ACCEPTED. Admins always see them.
 */
export const toReviewApplicationView = (
  row: ReviewRow,
  viewerRole: Role,
): ReviewApplicationView => {
  const { volunteer } = row;
  const revealContact = viewerRole === Role.ADMIN || row.status === ApplicationStatus.ACCEPTED;
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    matchScore: row.matchScore,
    message: row.message,
    volunteer: {
      id: volunteer.id,
      name: volunteer.name,
      location: volunteer.location,
      availability: volunteer.availability,
      bio: volunteer.volunteerProfile?.bio ?? null,
      experience: volunteer.volunteerProfile?.experience ?? null,
      skills: volunteer.skills.map((s) => ({
        id: s.skill.id,
        name: s.skill.name,
        proficiency: s.proficiency,
      })),
      contact: revealContact
        ? { email: volunteer.email, phone: volunteer.volunteerProfile?.phone ?? null }
        : null,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};
