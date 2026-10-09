import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationStatus, Prisma, Role } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-response.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { buildPaginatedResult, toPrismaPagination } from '../../common/utils/pagination.util';
import { OrganizationsService } from '../../organizations/services/organizations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../../projects/services/projects.service';
import {
  REVIEW_APPLICATION_INCLUDE,
  ReviewApplicationView,
  toReviewApplicationView,
} from '../application.mapper';
import { ListProjectApplicationsQueryDto } from '../dto/application.dto';
import { canTransition, isOpenForReview } from '../utils/application-status.util';

/** The organization's side: reviewing applicants of its own projects. */
@Injectable()
export class ApplicationReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly organizations: OrganizationsService,
  ) {}

  async listForProject(
    user: AuthenticatedUser,
    projectId: string,
    query: ListProjectApplicationsQueryDto,
  ): Promise<PaginatedResult<ReviewApplicationView>> {
    await this.projects.getManageableProject(user, projectId); // owner or admin, else 403/404

    const where: Prisma.ApplicationWhereInput = {
      projectId,
      ...(query.status ? { status: query.status } : {}),
    };
    // Applications without a score always sort last.
    const primary: Prisma.ApplicationOrderByWithRelationInput =
      query.sortBy === 'matchScore'
        ? { matchScore: { sort: query.order, nulls: 'last' } }
        : { createdAt: query.order };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        include: REVIEW_APPLICATION_INCLUDE,
        orderBy: [primary, { id: 'asc' }],
        ...toPrismaPagination(query),
      }),
      this.prisma.application.count({ where }),
    ]);
    return buildPaginatedResult(
      rows.map((row) => toReviewApplicationView(row, user.role)),
      total,
      query,
    );
  }

  async updateStatus(
    user: AuthenticatedUser,
    applicationId: string,
    status: ApplicationStatus,
  ): Promise<ReviewApplicationView> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, projectId: true, project: { select: { organizationId: true } } },
    });
    if (!application) throw new NotFoundException('Application not found');

    if (user.role !== Role.ADMIN) {
      const ownOrganizationId = await this.organizations.findIdByUserId(user.id);
      // Applications are private: another organization's looks exactly like a missing one.
      if (application.project.organizationId !== ownOrganizationId) {
        throw new NotFoundException('Application not found');
      }
    }

    await this.changeStatus(application.projectId, applicationId, status);

    const row = await this.prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: REVIEW_APPLICATION_INCLUDE,
    });
    return toReviewApplicationView(row, user.role);
  }

  /**
   * Re-reads everything under a row lock on the project, so that two organization members /
   * browser tabs accepting at the same moment cannot exceed `maxVolunteers`.
   */
  private async changeStatus(
    projectId: string,
    applicationId: string,
    status: ApplicationStatus,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;

      const current = await tx.application.findUniqueOrThrow({
        where: { id: applicationId },
        select: { status: true, project: { select: { status: true, maxVolunteers: true } } },
      });

      if (!isOpenForReview(current.project.status)) {
        throw new ConflictException(
          'This project is closed; its applications can no longer be reviewed',
        );
      }
      if (!canTransition(current.status, status)) {
        throw new ConflictException(
          `Cannot change application status from ${current.status} to ${status}`,
        );
      }
      if (status === ApplicationStatus.ACCEPTED && current.project.maxVolunteers !== null) {
        const accepted = await tx.application.count({
          where: { projectId, status: ApplicationStatus.ACCEPTED },
        });
        if (accepted >= current.project.maxVolunteers) {
          throw new ConflictException('The project has reached its maximum number of volunteers');
        }
      }

      await tx.application.update({ where: { id: applicationId }, data: { status } });
    });
  }
}
