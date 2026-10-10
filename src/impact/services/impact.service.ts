import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationStatus, Prisma, ProjectStatus, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { OrganizationsService } from '../../organizations/services/organizations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../../projects/services/projects.service';
import { buildVisibilityFilter } from '../../projects/utils/project-visibility.util';
import { CreateImpactDto, UpdateImpactDto } from '../dto/impact.dto';
import { ImpactView, toImpactView } from '../impact.mapper';

/** Impact happens while a project runs or after it finished. */
const RECORDABLE_STATUSES: readonly ProjectStatus[] = [
  ProjectStatus.IN_PROGRESS,
  ProjectStatus.COMPLETED,
];

const NO_IMPACT_MESSAGE = 'No impact has been recorded for this project yet';

@Injectable()
export class ImpactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly organizations: OrganizationsService,
  ) {}

  /** POST /projects/:id/impact — owner or admin; one record per project. */
  async create(
    user: AuthenticatedUser,
    projectId: string,
    dto: CreateImpactDto,
  ): Promise<ImpactView> {
    const project = await this.projects.getManageableProject(user, projectId);
    this.assertRecordable(project.status);

    const accepted = await this.countAccepted(projectId);
    try {
      const row = await this.prisma.impact.create({
        data: {
          projectId,
          // Defaults to what the application data says; the organization may override it.
          volunteersCount: dto.volunteersCount ?? accepted,
          hours: dto.hours,
          activitiesCount: dto.activitiesCount,
          beneficiariesCount: dto.beneficiariesCount,
          resources: dto.resources,
          description: dto.description,
        },
      });
      return toImpactView(row, accepted);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'Impact has already been recorded for this project; update it instead',
        );
      }
      throw error;
    }
  }

  /** GET /projects/:id/impact — readable by anyone who can see the project. */
  async findForProject(user: AuthenticatedUser, projectId: string): Promise<ImpactView> {
    const ownOrganizationId =
      user.role === Role.ORGANIZATION ? await this.organizations.findIdByUserId(user.id) : null;

    const project = await this.prisma.project.findFirst({
      where: { AND: [{ id: projectId }, buildVisibilityFilter(user, ownOrganizationId)] },
      select: {
        impact: true,
        _count: { select: { applications: { where: { status: ApplicationStatus.ACCEPTED } } } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.impact) throw new NotFoundException(NO_IMPACT_MESSAGE);
    return toImpactView(project.impact, project._count.applications);
  }

  /**
   * PATCH /projects/:id/impact — owner or admin. Allowed even once the project is COMPLETED
   * (the project itself is frozen, its impact report can still be corrected).
   */
  async update(
    user: AuthenticatedUser,
    projectId: string,
    dto: UpdateImpactDto,
  ): Promise<ImpactView> {
    const project = await this.projects.getManageableProject(user, projectId);
    this.assertRecordable(project.status);

    const existing = await this.prisma.impact.findUnique({
      where: { projectId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(NO_IMPACT_MESSAGE);

    const row = await this.prisma.impact.update({
      where: { projectId },
      data: {
        volunteersCount: dto.volunteersCount,
        hours: dto.hours,
        activitiesCount: dto.activitiesCount,
        beneficiariesCount: dto.beneficiariesCount,
        resources: dto.resources,
        description: dto.description,
      },
    });
    return toImpactView(row, await this.countAccepted(projectId));
  }

  private assertRecordable(status: ProjectStatus): void {
    if (!RECORDABLE_STATUSES.includes(status)) {
      throw new ConflictException(
        `Impact can only be recorded for projects that are in progress or completed (this one is ${status})`,
      );
    }
  }

  private countAccepted(projectId: string): Promise<number> {
    return this.prisma.application.count({
      where: { projectId, status: ApplicationStatus.ACCEPTED },
    });
  }
}
