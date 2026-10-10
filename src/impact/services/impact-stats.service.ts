import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountStatus, Prisma, ProjectCategory, ProjectStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ImpactTotals {
  projectsWithImpact: number;
  volunteersCount: number;
  hours: number;
  activitiesCount: number;
  beneficiariesCount: number;
}

export interface CategoryImpact extends ImpactTotals {
  category: ProjectCategory | null;
}

export interface ProjectCounts {
  total: number;
  draft: number;
  published: number;
  inProgress: number;
  completed: number;
  cancelled: number;
}

export interface OrganizationImpactStats {
  organizationId: string;
  projects: ProjectCounts;
  impact: ImpactTotals;
  uniqueVolunteers: number;
  byCategory: CategoryImpact[];
}

export interface PlatformImpactStats {
  organizations: number;
  volunteers: number;
  projects: ProjectCounts;
  impact: ImpactTotals;
  uniqueVolunteers: number;
  byCategory: CategoryImpact[];
}

interface CategoryRow {
  category: ProjectCategory | null;
  projects: number;
  volunteers: number;
  hours: number;
  activities: number;
  beneficiaries: number;
}

/**
 * Aggregations are computed by the database (SUM/COUNT), never by loading rows into memory.
 * Cancelled projects are excluded from impact figures: their reports are not meaningful results.
 * Pass an organizationId to scope everything to that organization; omit it for the whole platform.
 */
@Injectable()
export class ImpactStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async forOrganization(organizationId: string): Promise<OrganizationImpactStats> {
    const exists = await this.prisma.organizationProfile.count({ where: { id: organizationId } });
    if (!exists) throw new NotFoundException('Organization not found');

    const [projects, impact, uniqueVolunteers, byCategory] = await Promise.all([
      this.projectCounts(organizationId),
      this.totals(organizationId),
      this.uniqueVolunteers(organizationId),
      this.byCategory(organizationId),
    ]);
    return { organizationId, projects, impact, uniqueVolunteers, byCategory };
  }

  async forPlatform(): Promise<PlatformImpactStats> {
    const [organizations, volunteers, projects, impact, uniqueVolunteers, byCategory] =
      await Promise.all([
        this.prisma.organizationProfile.count({
          where: { user: { status: AccountStatus.ACTIVE } },
        }),
        this.prisma.user.count({ where: { role: Role.VOLUNTEER, status: AccountStatus.ACTIVE } }),
        this.projectCounts(),
        this.totals(),
        this.uniqueVolunteers(),
        this.byCategory(),
      ]);
    return { organizations, volunteers, projects, impact, uniqueVolunteers, byCategory };
  }

  // ───────────────────────── Queries ─────────────────────────

  private async projectCounts(organizationId?: string): Promise<ProjectCounts> {
    const groups = await this.prisma.project.groupBy({
      by: ['status'],
      where: organizationId ? { organizationId } : {},
      _count: { _all: true },
    });
    const countOf = (status: ProjectStatus): number =>
      groups.find((g) => g.status === status)?._count._all ?? 0;

    return {
      total: groups.reduce((sum, g) => sum + g._count._all, 0),
      draft: countOf(ProjectStatus.DRAFT),
      published: countOf(ProjectStatus.PUBLISHED),
      inProgress: countOf(ProjectStatus.IN_PROGRESS),
      completed: countOf(ProjectStatus.COMPLETED),
      cancelled: countOf(ProjectStatus.CANCELLED),
    };
  }

  private async totals(organizationId?: string): Promise<ImpactTotals> {
    const result = await this.prisma.impact.aggregate({
      where: {
        project: {
          status: { not: ProjectStatus.CANCELLED },
          ...(organizationId ? { organizationId } : {}),
        },
      },
      _count: { _all: true },
      _sum: { volunteersCount: true, hours: true, activitiesCount: true, beneficiariesCount: true },
    });
    return {
      projectsWithImpact: result._count._all,
      volunteersCount: result._sum.volunteersCount ?? 0,
      hours: result._sum.hours?.toNumber() ?? 0,
      activitiesCount: result._sum.activitiesCount ?? 0,
      beneficiariesCount: result._sum.beneficiariesCount ?? 0,
    };
  }

  private async uniqueVolunteers(organizationId?: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT a."volunteerId")::int AS count
      FROM applications a
      JOIN projects p ON p.id = a."projectId"
      WHERE a.status = 'ACCEPTED'
        AND p.status <> 'CANCELLED'
        ${this.organizationFilter(organizationId)}`;
    return rows[0]?.count ?? 0;
  }

  private async byCategory(organizationId?: string): Promise<CategoryImpact[]> {
    const rows = await this.prisma.$queryRaw<CategoryRow[]>`
      SELECT p.category::text                                AS category,
             COUNT(*)::int                                   AS projects,
             COALESCE(SUM(i."volunteersCount"), 0)::float8   AS volunteers,
             COALESCE(SUM(i.hours), 0)::float8               AS hours,
             COALESCE(SUM(i."activitiesCount"), 0)::float8   AS activities,
             COALESCE(SUM(i."beneficiariesCount"), 0)::float8 AS beneficiaries
      FROM impacts i
      JOIN projects p ON p.id = i."projectId"
      WHERE p.status <> 'CANCELLED'
        ${this.organizationFilter(organizationId)}
      GROUP BY p.category
      ORDER BY projects DESC, p.category NULLS LAST`;

    return rows.map((r) => ({
      category: r.category,
      projectsWithImpact: r.projects,
      volunteersCount: r.volunteers,
      hours: r.hours,
      activitiesCount: r.activities,
      beneficiariesCount: r.beneficiaries,
    }));
  }

  /** The organization id is always bound as a parameter, never concatenated into SQL. */
  private organizationFilter(organizationId?: string): Prisma.Sql {
    return organizationId
      ? Prisma.sql`AND p."organizationId" = ${organizationId}::uuid`
      : Prisma.empty;
  }
}
