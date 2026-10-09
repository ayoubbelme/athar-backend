import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApplicationStatus, Prisma, ProjectStatus, Role } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-response.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { buildPaginatedResult, toPrismaPagination } from '../../common/utils/pagination.util';
import { OrganizationsService } from '../../organizations/services/organizations.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ReplaceProjectSkillsDto,
  UpdateProjectDto,
} from '../dto/project.dto';
import { canTransition, isTerminal } from '../utils/project-status.util';
import { buildVisibilityFilter } from '../utils/project-visibility.util';
import { ProjectSkillsService } from './project-skills.service';

const PROJECT_INCLUDE = {
  organization: { select: { id: true, name: true, logo: true, location: true } },
  skills: {
    include: { skill: { select: { id: true, name: true } } },
    orderBy: { skill: { name: 'asc' } },
  },
  _count: { select: { applications: { where: { status: ApplicationStatus.ACCEPTED } } } },
} satisfies Prisma.ProjectInclude;

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;

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
  acceptedVolunteers: number;
  organization: ProjectRow['organization'];
  skills: Array<{ skill: { id: string; name: string }; requiredCount: number; importance: number }>;
  createdAt: Date;
  updatedAt: Date;
}

const toView = (row: ProjectRow): ProjectView => ({
  id: row.id,
  organizationId: row.organizationId,
  title: row.title,
  description: row.description,
  location: row.location,
  startDate: row.startDate,
  endDate: row.endDate,
  status: row.status,
  maxVolunteers: row.maxVolunteers,
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

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly projectSkills: ProjectSkillsService,
  ) {}

  // ───────────────────────── Create ─────────────────────────

  async create(user: AuthenticatedUser, dto: CreateProjectDto): Promise<ProjectView> {
    // The owning organization comes from the authenticated user, never from the request body.
    const organizationId = await this.organizations.findIdByUserId(user.id);
    if (!organizationId) throw new ForbiddenException('Organization profile not found');

    this.assertDateOrder(dto.startDate, dto.endDate);
    await this.projectSkills.assertSkillsExist(dto.skills);

    const row = await this.prisma.project.create({
      data: {
        organizationId,
        title: dto.title,
        description: dto.description,
        location: dto.location,
        startDate: dto.startDate,
        endDate: dto.endDate,
        maxVolunteers: dto.maxVolunteers,
        status: dto.status ?? ProjectStatus.DRAFT,
        ...(dto.skills?.length
          ? { skills: { create: this.projectSkills.toCreateData(dto.skills) } }
          : {}),
      },
      include: PROJECT_INCLUDE,
    });
    return toView(row);
  }

  // ───────────────────────── Read ─────────────────────────

  async list(
    user: AuthenticatedUser,
    query: ListProjectsQueryDto,
  ): Promise<PaginatedResult<ProjectView>> {
    const visibility = buildVisibilityFilter(user, await this.ownOrganizationId(user));
    const where: Prisma.ProjectWhereInput = { AND: [visibility, this.buildFilters(query)] };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: PROJECT_INCLUDE,
        orderBy: [this.buildOrderBy(query), { id: 'asc' }], // id = stable pagination on ties
        ...toPrismaPagination(query),
      }),
      this.prisma.project.count({ where }),
    ]);
    return buildPaginatedResult(rows.map(toView), total, query);
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<ProjectView> {
    const visibility = buildVisibilityFilter(user, await this.ownOrganizationId(user));
    const row = await this.prisma.project.findFirst({
      where: { AND: [{ id }, visibility] },
      include: PROJECT_INCLUDE,
    });
    // Same 404 for "does not exist" and "not allowed to see" (e.g. someone else's draft).
    if (!row) throw new NotFoundException('Project not found');
    return toView(row);
  }

  // ───────────────────────── Update ─────────────────────────

  async update(user: AuthenticatedUser, id: string, dto: UpdateProjectDto): Promise<ProjectView> {
    const current = await this.loadManageable(user, id);
    this.assertModifiable(current.status);

    if (
      dto.status !== undefined &&
      dto.status !== current.status &&
      !canTransition(current.status, dto.status)
    ) {
      throw new ConflictException(
        `Cannot change project status from ${current.status} to ${dto.status}`,
      );
    }

    this.assertDateOrder(
      dto.startDate !== undefined ? dto.startDate : current.startDate,
      dto.endDate !== undefined ? dto.endDate : current.endDate,
    );

    if (typeof dto.maxVolunteers === 'number') {
      const accepted = await this.prisma.application.count({
        where: { projectId: id, status: ApplicationStatus.ACCEPTED },
      });
      if (dto.maxVolunteers < accepted) {
        throw new ConflictException(
          `maxVolunteers cannot be lower than the ${accepted} volunteer(s) already accepted`,
        );
      }
    }

    const row = await this.prisma.project.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        location: dto.location,
        startDate: dto.startDate,
        endDate: dto.endDate,
        maxVolunteers: dto.maxVolunteers,
        status: dto.status,
      },
      include: PROJECT_INCLUDE,
    });
    return toView(row);
  }

  async replaceSkills(
    user: AuthenticatedUser,
    id: string,
    dto: ReplaceProjectSkillsDto,
  ): Promise<ProjectView> {
    const current = await this.loadManageable(user, id);
    this.assertModifiable(current.status);

    await this.projectSkills.assertSkillsExist(dto.skills);
    await this.projectSkills.replace(id, dto.skills);

    const row = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: PROJECT_INCLUDE,
    });
    return toView(row);
  }

  // ───────────────────────── Delete ─────────────────────────

  /**
   * Organizations may only delete drafts. Anything that has been public may have applications
   * and impact data, so it is cancelled instead. Admins can remove any project (moderation).
   */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const current = await this.loadManageable(user, id);
    if (user.role !== Role.ADMIN && current.status !== ProjectStatus.DRAFT) {
      throw new ConflictException(
        'Only draft projects can be deleted. Cancel the project instead.',
      );
    }
    await this.prisma.project.delete({ where: { id } });
  }

  // ───────────────────────── Internals ─────────────────────────

  private async ownOrganizationId(user: AuthenticatedUser): Promise<string | null> {
    return user.role === Role.ORGANIZATION ? this.organizations.findIdByUserId(user.id) : null;
  }

  /**
   * Loads a project the caller is allowed to modify: its owner, or an admin.
   * Someone else's draft is reported as 404 so its existence is not revealed.
   */
  private async loadManageable(user: AuthenticatedUser, id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    });
    if (!project) throw new NotFoundException('Project not found');

    if (user.role !== Role.ADMIN) {
      const ownOrgId = await this.ownOrganizationId(user);
      if (project.organizationId !== ownOrgId) {
        if (project.status === ProjectStatus.DRAFT)
          throw new NotFoundException('Project not found');
        throw new ForbiddenException('You can only manage your own projects');
      }
    }
    return project;
  }

  private assertModifiable(status: ProjectStatus): void {
    if (isTerminal(status)) {
      throw new ConflictException(`A ${status} project can no longer be modified`);
    }
  }

  private assertDateOrder(start: Date | null | undefined, end: Date | null | undefined): void {
    if (start && end && end.getTime() < start.getTime()) {
      throw new UnprocessableEntityException('endDate must not be before startDate');
    }
  }

  private buildFilters(query: ListProjectsQueryDto): Prisma.ProjectWhereInput {
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.location ? { location: { contains: query.location, mode: 'insensitive' } } : {}),
      ...(query.skillId ? { skills: { some: { skillId: query.skillId } } } : {}),
      ...(query.startDateFrom || query.startDateTo
        ? {
            startDate: {
              ...(query.startDateFrom ? { gte: query.startDateFrom } : {}),
              ...(query.startDateTo ? { lte: query.startDateTo } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private buildOrderBy(query: ListProjectsQueryDto): Prisma.ProjectOrderByWithRelationInput {
    // Projects without dates always sort last, whichever direction is requested.
    if (query.sortBy === 'startDate' || query.sortBy === 'endDate') {
      return { [query.sortBy]: { sort: query.order, nulls: 'last' } };
    }
    return { [query.sortBy]: query.order };
  }
}
