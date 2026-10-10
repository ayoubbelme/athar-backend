/**
 * Development seed. Idempotent: safe to run multiple times.
 * All data is fictional. Demo credentials are documented in README.md.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ApplicationStatus,
  Availability,
  PrismaClient,
  ProficiencyLevel,
  ProjectCategory,
  ProjectStatus,
  Role,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { RuleBasedMatchStrategy } from '../src/matching/strategies/rule-based-match.strategy';

const DEMO_PASSWORDS = {
  admin: 'Admin#Demo2026',
  volunteer: 'Volunteer#Demo2026',
  organization: 'Org#Demo2026!',
} as const;

const SKILLS = [
  { name: 'First Aid', description: 'Emergency and basic medical response' },
  { name: 'Teaching', description: 'Tutoring and classroom support' },
  { name: 'Graphic Design', description: 'Visual identity, posters, social media assets' },
  { name: 'Event Organization', description: 'Planning and running community events' },
  { name: 'Photography', description: 'Event and documentary photography' },
  { name: 'Arabic–English Translation', description: 'Written and spoken translation' },
  { name: 'Social Media', description: 'Content creation and community management' },
  { name: 'Logistics', description: 'Transport, distribution and supply coordination' },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    throw new Error(
      'Refusing to seed demo data in production (set ALLOW_PRODUCTION_SEED=true to override).',
    );
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    // ── Skills ──
    const skills = new Map<string, string>();
    for (const s of SKILLS) {
      const skill = await prisma.skill.upsert({ where: { name: s.name }, update: {}, create: s });
      skills.set(s.name, skill.id);
    }
    const skillId = (name: string): string => skills.get(name) as string;

    // ── Users ──
    const admin = await prisma.user.upsert({
      where: { email: 'admin@athar.dev' },
      update: {},
      create: {
        name: 'ATHAR Admin',
        email: 'admin@athar.dev',
        passwordHash: await argon2.hash(DEMO_PASSWORDS.admin),
        role: Role.ADMIN,
      },
    });

    const volunteer = await prisma.user.upsert({
      where: { email: 'volunteer@athar.dev' },
      update: {},
      create: {
        name: 'Demo Volunteer',
        email: 'volunteer@athar.dev',
        passwordHash: await argon2.hash(DEMO_PASSWORDS.volunteer),
        role: Role.VOLUNTEER,
        location: 'Algiers',
        availability: [Availability.WEEKENDS, Availability.EVENINGS],
        volunteerProfile: {
          create: {
            bio: 'Student who enjoys community work.',
            location: 'Algiers',
            availability: [Availability.WEEKENDS, Availability.EVENINGS],
            interests: [ProjectCategory.HEALTH, ProjectCategory.COMMUNITY],
            experience: 'Helped organize two neighbourhood clean-up days.',
          },
        },
      },
    });

    // Backfill fields introduced after the first seed (idempotent).
    await prisma.volunteerProfile.update({
      where: { userId: volunteer.id },
      data: {
        availability: [Availability.WEEKENDS, Availability.EVENINGS],
        interests: [ProjectCategory.HEALTH, ProjectCategory.COMMUNITY],
      },
    });
    await prisma.user.update({
      where: { id: volunteer.id },
      data: { availability: [Availability.WEEKENDS, Availability.EVENINGS] },
    });

    const orgUser = await prisma.user.upsert({
      where: { email: 'org@athar.dev' },
      update: {},
      create: {
        name: 'Demo Organization',
        email: 'org@athar.dev',
        passwordHash: await argon2.hash(DEMO_PASSWORDS.organization),
        role: Role.ORGANIZATION,
        location: 'Algiers',
        organizationProfile: {
          create: {
            name: 'Green Hands Association',
            description: 'Fictional community association used for demo data.',
            location: 'Algiers',
            website: 'https://example.org',
            contactEmail: 'contact@example.org',
          },
        },
      },
      include: { organizationProfile: true },
    });
    const organization = orgUser.organizationProfile;
    if (!organization) throw new Error('Demo organization profile missing');

    // ── Volunteer skills ──
    const volunteerSkills: Array<[string, ProficiencyLevel]> = [
      ['First Aid', ProficiencyLevel.INTERMEDIATE],
      ['Event Organization', ProficiencyLevel.BEGINNER],
      ['Photography', ProficiencyLevel.ADVANCED],
    ];
    for (const [name, proficiency] of volunteerSkills) {
      await prisma.userSkill.upsert({
        where: { userId_skillId: { userId: volunteer.id, skillId: skillId(name) } },
        update: {},
        create: { userId: volunteer.id, skillId: skillId(name), proficiency },
      });
    }

    // ── Projects (looked up by title to stay idempotent) ──
    const upsertProject = async (
      data: {
        title: string;
        description: string;
        status: ProjectStatus;
        maxVolunteers: number;
        category: ProjectCategory;
        availability: Availability[];
        startDate: Date;
        endDate: Date;
      },
      requirements: Array<{ skill: string; requiredCount: number; importance: number }>,
    ) => {
      const existing = await prisma.project.findFirst({
        where: { organizationId: organization.id, title: data.title },
      });
      const project = existing
        ? // Re-running the seed also backfills fields added by later migrations (category, availability).
          await prisma.project.update({
            where: { id: existing.id },
            data: { category: data.category, availability: data.availability },
          })
        : await prisma.project.create({
            data: { ...data, organizationId: organization.id, location: 'Algiers' },
          });
      for (const r of requirements) {
        await prisma.projectSkill.upsert({
          where: { projectId_skillId: { projectId: project.id, skillId: skillId(r.skill) } },
          update: {},
          create: {
            projectId: project.id,
            skillId: skillId(r.skill),
            requiredCount: r.requiredCount,
            importance: r.importance,
          },
        });
      }
      return project;
    };

    const openProject = await upsertProject(
      {
        title: 'Community Health Awareness Day',
        description:
          'A one-day neighbourhood event with free health information and first-aid demos.',
        status: ProjectStatus.PUBLISHED,
        maxVolunteers: 15,
        category: ProjectCategory.HEALTH,
        availability: [Availability.WEEKENDS],
        startDate: new Date('2026-11-14T09:00:00Z'),
        endDate: new Date('2026-11-14T17:00:00Z'),
      },
      [
        { skill: 'First Aid', requiredCount: 3, importance: 5 },
        { skill: 'Event Organization', requiredCount: 2, importance: 3 },
        { skill: 'Photography', requiredCount: 1, importance: 2 },
      ],
    );

    const completedProject = await upsertProject(
      {
        title: 'Neighbourhood Clean-up Weekend',
        description: 'Two-day clean-up of public spaces and a small recycling workshop.',
        status: ProjectStatus.COMPLETED,
        maxVolunteers: 30,
        category: ProjectCategory.ENVIRONMENT,
        availability: [Availability.WEEKENDS],
        startDate: new Date('2026-05-02T08:00:00Z'),
        endDate: new Date('2026-05-03T16:00:00Z'),
      },
      [
        { skill: 'Logistics', requiredCount: 2, importance: 4 },
        { skill: 'Event Organization', requiredCount: 1, importance: 3 },
      ],
    );

    // ── Applications ──
    // Scores come from the real matching strategy so the demo data always agrees with the algorithm.
    const matcher = new RuleBasedMatchStrategy();
    const scoreFor = async (projectId: string): Promise<number> => {
      const [profile, held, project] = await Promise.all([
        prisma.volunteerProfile.findUniqueOrThrow({ where: { userId: volunteer.id } }),
        prisma.userSkill.findMany({
          where: { userId: volunteer.id },
          include: { skill: { select: { name: true } } },
        }),
        prisma.project.findUniqueOrThrow({
          where: { id: projectId },
          include: { skills: { include: { skill: { select: { name: true } } } } },
        }),
      ]);
      const { score } = matcher.compute({
        volunteer: {
          skills: held.map((h) => ({
            skillId: h.skillId,
            name: h.skill.name,
            proficiency: h.proficiency,
          })),
          location: profile.location,
          interests: profile.interests,
          availability: profile.availability,
        },
        project: {
          skills: project.skills.map((ps) => ({
            skillId: ps.skillId,
            name: ps.skill.name,
            importance: ps.importance,
            requiredCount: ps.requiredCount,
          })),
          location: project.location,
          category: project.category,
          availability: project.availability,
        },
      });
      return score;
    };

    const openScore = await scoreFor(openProject.id);
    await prisma.application.upsert({
      where: { projectId_volunteerId: { projectId: openProject.id, volunteerId: volunteer.id } },
      update: { matchScore: openScore },
      create: {
        projectId: openProject.id,
        volunteerId: volunteer.id,
        status: ApplicationStatus.PENDING,
        matchScore: openScore,
        message: 'I would love to help with the first-aid stand.',
      },
    });
    const completedScore = await scoreFor(completedProject.id);
    await prisma.application.upsert({
      where: {
        projectId_volunteerId: { projectId: completedProject.id, volunteerId: volunteer.id },
      },
      update: { matchScore: completedScore },
      create: {
        projectId: completedProject.id,
        volunteerId: volunteer.id,
        status: ApplicationStatus.ACCEPTED,
        matchScore: completedScore,
      },
    });

    // ── Impact ──
    await prisma.impact.upsert({
      where: { projectId: completedProject.id },
      update: {},
      create: {
        projectId: completedProject.id,
        volunteersCount: 24,
        hours: 192,
        activitiesCount: 6,
        beneficiariesCount: 350,
        resources: 'Gloves, bags, recycling bins',
        description: 'Cleaned 4 public spaces and ran a recycling workshop for local families.',
      },
    });

    console.log(`Seed complete (admin id: ${admin.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
