import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationStatus, Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-response.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { buildPaginatedResult, toPrismaPagination } from '../../common/utils/pagination.util';
import { MatchingService } from '../../matching/services/matching.service';
import { PrismaService } from '../../prisma/prisma.service';
import { buildVisibilityFilter } from '../../projects/utils/project-visibility.util';
import {
  MY_APPLICATION_INCLUDE,
  MyApplicationView,
  toMyApplicationView,
} from '../application.mapper';
import { CreateApplicationDto, ListMyApplicationsQueryDto } from '../dto/application.dto';
import {
  canTransition,
  isOpenForApplications,
  isOpenForReview,
} from '../utils/application-status.util';

/** The volunteer's side of applications. Every query is scoped to the caller. */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
  ) {}

  async apply(
    volunteer: AuthenticatedUser,
    projectId: string,
    dto: CreateApplicationDto,
  ): Promise<MyApplicationView> {
    // Same visibility rule as browsing: drafts / suspended organizations' projects do not exist for you.
    const project = await this.prisma.project.findFirst({
      where: { AND: [{ id: projectId }, buildVisibilityFilter(volunteer, null)] },
      select: { id: true, status: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!isOpenForApplications(project.status)) {
      throw new ConflictException('This project is not open for applications');
    }

    const existing = await this.prisma.application.findUnique({
      where: { projectId_volunteerId: { projectId, volunteerId: volunteer.id } },
      select: { id: true, status: true },
    });
    const id = existing
      ? await this.reapply(existing, dto)
      : await this.createApplication(projectId, volunteer.id, dto);

    // Snapshot of how well the volunteer fits right now (null if matching is unavailable).
    const matchScore = await this.matching.scoreForApplication(volunteer.id, projectId);
    const row = await this.prisma.application.update({
      where: { id },
      data: { matchScore },
      include: MY_APPLICATION_INCLUDE,
    });
    return toMyApplicationView(row);
  }

  async listMine(
    volunteer: AuthenticatedUser,
    query: ListMyApplicationsQueryDto,
  ): Promise<PaginatedResult<MyApplicationView>> {
    const where: Prisma.ApplicationWhereInput = {
      volunteerId: volunteer.id,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        include: MY_APPLICATION_INCLUDE,
        orderBy: [{ [query.sortBy]: query.order }, { id: 'asc' }],
        ...toPrismaPagination(query),
      }),
      this.prisma.application.count({ where }),
    ]);
    return buildPaginatedResult(rows.map(toMyApplicationView), total, query);
  }

  /** DELETE /applications/:id — withdraws (soft); the history is kept. Idempotent. */
  async withdraw(volunteer: AuthenticatedUser, applicationId: string): Promise<void> {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, volunteerId: volunteer.id },
      select: { id: true, status: true, project: { select: { status: true } } },
    });
    // Someone else's application looks exactly like a missing one.
    if (!application) throw new NotFoundException('Application not found');
    if (application.status === ApplicationStatus.WITHDRAWN) return;

    if (!canTransition(application.status, ApplicationStatus.WITHDRAWN)) {
      throw new ConflictException(`Cannot withdraw an application that is ${application.status}`);
    }
    if (!isOpenForReview(application.project.status)) {
      throw new ConflictException('This project is closed');
    }

    const { count } = await this.prisma.application.updateMany({
      where: { id: applicationId, status: application.status }, // guards against concurrent changes
      data: { status: ApplicationStatus.WITHDRAWN },
    });
    if (count === 0) throw new ConflictException('The application was modified, please retry');
  }

  // ───────────────────────── Internals ─────────────────────────

  private async createApplication(
    projectId: string,
    volunteerId: string,
    dto: CreateApplicationDto,
  ): Promise<string> {
    try {
      const created = await this.prisma.application.create({
        data: { projectId, volunteerId, message: dto.message },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      // Two simultaneous requests: the unique(projectId, volunteerId) constraint decides.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You have already applied to this project');
      }
      throw error;
    }
  }

  /** A volunteer who withdrew may apply again; any other existing application blocks a new one. */
  private async reapply(
    existing: { id: string; status: ApplicationStatus },
    dto: CreateApplicationDto,
  ): Promise<string> {
    if (existing.status !== ApplicationStatus.WITHDRAWN) {
      throw new ConflictException('You have already applied to this project');
    }
    const { count } = await this.prisma.application.updateMany({
      where: { id: existing.id, status: ApplicationStatus.WITHDRAWN },
      data: { status: ApplicationStatus.PENDING, message: dto.message ?? null, matchScore: null },
    });
    if (count === 0) throw new ConflictException('You have already applied to this project');
    return existing.id;
  }
}
