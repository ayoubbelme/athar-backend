import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApplicationStatus, ProjectStatus } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-response.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { buildPaginatedResult, toPrismaPagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PROJECT_INCLUDE,
  ProjectRow,
  ProjectView,
  toProjectView,
} from '../../projects/project.mapper';
import { buildVisibilityFilter } from '../../projects/utils/project-visibility.util';
import {
  MATCH_STRATEGY,
  MatchResult,
  MatchStrategy,
  ProjectMatchRequirements,
  VolunteerMatchProfile,
} from '../interfaces/match.interfaces';
import { RecommendationsQueryDto } from '../dto/matching.dto';
import { MAX_RECOMMENDATION_CANDIDATES } from '../matching.constants';

export interface RecommendedProject {
  project: ProjectView;
  match: MatchResult;
}

export interface ProjectMatch {
  project: { id: string; title: string; status: ProjectStatus };
  match: MatchResult;
}

/**
 * Loads the data and delegates the actual scoring to the injected MatchStrategy,
 * so the algorithm can be replaced without touching projects, applications or controllers.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MATCH_STRATEGY) private readonly strategy: MatchStrategy,
  ) {}

  /** GET /matching/projects/:id — how well the caller fits one project, with the explanation. */
  async matchWithProject(volunteer: AuthenticatedUser, projectId: string): Promise<ProjectMatch> {
    const row = await this.prisma.project.findFirst({
      where: { AND: [{ id: projectId }, buildVisibilityFilter(volunteer, null)] },
      include: PROJECT_INCLUDE,
    });
    if (!row) throw new NotFoundException('Project not found');

    const profile = await this.loadVolunteerProfile(volunteer.id);
    const match = await this.strategy.score({ volunteer: profile, project: toRequirements(row) });
    return { project: { id: row.id, title: row.title, status: row.status }, match };
  }

  /**
   * GET /matching/projects — open projects ranked for the caller.
   * Excluded: projects not open (not PUBLISHED, already ended, full), projects the caller has
   * already applied to (unless withdrawn) and anything not visible to volunteers.
   */
  async recommend(
    volunteer: AuthenticatedUser,
    query: RecommendationsQueryDto,
  ): Promise<PaginatedResult<RecommendedProject>> {
    const profile = await this.loadVolunteerProfile(volunteer.id);

    const rows = await this.prisma.project.findMany({
      where: {
        AND: [
          buildVisibilityFilter(volunteer, null),
          { status: ProjectStatus.PUBLISHED },
          { OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
          {
            applications: {
              none: { volunteerId: volunteer.id, status: { not: ApplicationStatus.WITHDRAWN } },
            },
          },
        ],
      },
      include: PROJECT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: MAX_RECOMMENDATION_CANDIDATES,
    });

    const withSpots = rows.filter(
      (row) => row.maxVolunteers === null || row._count.applications < row.maxVolunteers,
    );
    const scored = await Promise.all(
      withSpots.map(async (row) => ({
        row,
        match: await this.strategy.score({ volunteer: profile, project: toRequirements(row) }),
      })),
    );

    const ranked = scored
      .filter(({ match }) => match.score >= query.minScore)
      .sort(
        (a, b) =>
          b.match.score - a.match.score ||
          b.row.createdAt.getTime() - a.row.createdAt.getTime() ||
          a.row.id.localeCompare(b.row.id),
      );

    const { skip, take } = toPrismaPagination(query);
    const data = ranked
      .slice(skip, skip + take)
      .map(({ row, match }) => ({ project: toProjectView(row), match }));
    return buildPaginatedResult(data, ranked.length, query);
  }

  /**
   * Score stored on an application when the volunteer applies.
   * Matching must never block applying: on any failure the score is simply left empty.
   */
  async scoreForApplication(volunteerId: string, projectId: string): Promise<number | null> {
    try {
      const row = await this.prisma.project.findUnique({
        where: { id: projectId },
        include: PROJECT_INCLUDE,
      });
      if (!row) return null;
      const profile = await this.loadVolunteerProfile(volunteerId);
      const { score } = await this.strategy.score({
        volunteer: profile,
        project: toRequirements(row),
      });
      return score;
    } catch (error) {
      this.logger.warn(`Could not compute match score: ${(error as Error).message}`);
      return null;
    }
  }

  private async loadVolunteerProfile(userId: string): Promise<VolunteerMatchProfile> {
    const [profile, skills] = await Promise.all([
      this.prisma.volunteerProfile.findUnique({
        where: { userId },
        select: { location: true, availability: true, interests: true },
      }),
      this.prisma.userSkill.findMany({
        where: { userId },
        select: { skillId: true, proficiency: true, skill: { select: { name: true } } },
      }),
    ]);

    return {
      skills: skills.map((s) => ({
        skillId: s.skillId,
        name: s.skill.name,
        proficiency: s.proficiency,
      })),
      location: profile?.location ?? null,
      interests: profile?.interests ?? [],
      availability: profile?.availability ?? [],
    };
  }
}

function toRequirements(row: ProjectRow): ProjectMatchRequirements {
  return {
    skills: row.skills.map((s) => ({
      skillId: s.skill.id,
      name: s.skill.name,
      importance: s.importance,
      requiredCount: s.requiredCount,
    })),
    location: row.location,
    category: row.category,
    availability: row.availability,
  };
}
