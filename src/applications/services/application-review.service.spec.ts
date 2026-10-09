import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApplicationStatus as A, ProjectStatus as P, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { OrganizationsService } from '../../organizations/services/organizations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../../projects/services/projects.service';
import { ListProjectApplicationsQueryDto } from '../dto/application.dto';
import { ApplicationReviewService } from './application-review.service';

const org = (id = 'org-1'): AuthenticatedUser => ({
  id: `user-${id}`,
  email: 'o@x.co',
  role: Role.ORGANIZATION,
});
const admin: AuthenticatedUser = { id: 'admin', email: 'a@x.co', role: Role.ADMIN };

const reviewRow = (status: A) => ({
  id: 'a1',
  projectId: 'p1',
  status,
  matchScore: null,
  message: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  volunteer: {
    id: 'v1',
    name: 'Vol',
    email: 'vol@example.com',
    location: null,
    availability: null,
    volunteerProfile: { bio: null, phone: '123', experience: null },
    skills: [],
  },
});

describe('ApplicationReviewService (organization side)', () => {
  let service: ApplicationReviewService;
  const tx = {
    $queryRaw: jest.fn(),
    application: { findUniqueOrThrow: jest.fn(), count: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    application: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const projects = { getManageableProject: jest.fn() };
  const organizations = { findIdByUserId: jest.fn() };

  const stateInTx = (
    status: A,
    projectStatus: P = P.PUBLISHED,
    maxVolunteers: number | null = null,
  ) =>
    tx.application.findUniqueOrThrow.mockResolvedValue({
      status,
      project: { status: projectStatus, maxVolunteers },
    });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: typeof tx) => unknown)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    );
    organizations.findIdByUserId.mockImplementation((userId: string) =>
      Promise.resolve(userId.replace('user-', '')),
    );
    prisma.application.findUnique.mockResolvedValue({
      id: 'a1',
      projectId: 'p1',
      project: { organizationId: 'org-1' },
    });
    prisma.application.findUniqueOrThrow.mockResolvedValue(reviewRow(A.ACCEPTED));
    stateInTx(A.PENDING);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApplicationReviewService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectsService, useValue: projects },
        { provide: OrganizationsService, useValue: organizations },
      ],
    }).compile();
    service = moduleRef.get(ApplicationReviewService);
  });

  describe('listForProject', () => {
    const query = (over: Partial<ListProjectApplicationsQueryDto> = {}) =>
      Object.assign(new ListProjectApplicationsQueryDto(), over);

    it('requires ownership of the project first', async () => {
      projects.getManageableProject.mockRejectedValue(new ForbiddenException());
      await expect(service.listForProject(org('org-2'), 'p1', query())).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.application.findMany).not.toHaveBeenCalled();
    });

    it('filters by status and sorts unscored applications last', async () => {
      projects.getManageableProject.mockResolvedValue({});
      prisma.application.findMany.mockResolvedValue([reviewRow(A.PENDING)]);
      prisma.application.count.mockResolvedValue(1);

      const result = await service.listForProject(
        org(),
        'p1',
        query({ status: A.PENDING, sortBy: 'matchScore', order: 'desc' }),
      );

      const args = prisma.application.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ projectId: 'p1', status: 'PENDING' });
      expect(args.orderBy).toEqual([
        { matchScore: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ]);
      expect(result.data[0].volunteer.contact).toBeNull(); // pending → hidden
    });
  });

  describe('updateStatus', () => {
    it('404s for unknown applications', async () => {
      prisma.application.findUnique.mockResolvedValue(null);
      await expect(service.updateStatus(org(), 'a1', A.ACCEPTED)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("treats another organization's application as missing (404, not 403)", async () => {
      await expect(service.updateStatus(org('org-2'), 'a1', A.ACCEPTED)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lets the owner accept under a row lock on the project and reveals contact on ACCEPTED', async () => {
      const view = await service.updateStatus(org(), 'a1', A.ACCEPTED);

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // SELECT ... FOR UPDATE
      expect(tx.application.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { status: 'ACCEPTED' },
      });
      expect(view.volunteer.contact).toEqual({ email: 'vol@example.com', phone: '123' });
    });

    it('lets ADMIN review any application', async () => {
      await service.updateStatus(admin, 'a1', A.REJECTED);
      expect(tx.application.update).toHaveBeenCalled();
      expect(organizations.findIdByUserId).not.toHaveBeenCalled();
    });

    it.each([
      [A.REJECTED, A.ACCEPTED],
      [A.WITHDRAWN, A.ACCEPTED],
      [A.ACCEPTED, A.ACCEPTED],
      [A.REJECTED, A.REJECTED],
    ])('rejects the invalid transition %s → %s with 409', async (from, to) => {
      stateInTx(from);
      await expect(service.updateStatus(org(), 'a1', to)).rejects.toThrow(
        `Cannot change application status from ${from} to ${to}`,
      );
      expect(tx.application.update).not.toHaveBeenCalled();
    });

    it.each([P.COMPLETED, P.CANCELLED, P.DRAFT])(
      'refuses to review applications of a %s project',
      async (projectStatus) => {
        stateInTx(A.PENDING, projectStatus);
        await expect(service.updateStatus(org(), 'a1', A.ACCEPTED)).rejects.toThrow(
          /project is closed/,
        );
      },
    );

    it('enforces maxVolunteers when accepting', async () => {
      stateInTx(A.PENDING, P.PUBLISHED, 2);
      tx.application.count.mockResolvedValue(2);
      await expect(service.updateStatus(org(), 'a1', A.ACCEPTED)).rejects.toThrow(
        'The project has reached its maximum number of volunteers',
      );
      expect(tx.application.update).not.toHaveBeenCalled();
    });

    it('accepts while below capacity, and ignores capacity for rejections', async () => {
      stateInTx(A.PENDING, P.PUBLISHED, 2);
      tx.application.count.mockResolvedValue(1);
      await service.updateStatus(org(), 'a1', A.ACCEPTED);
      expect(tx.application.update).toHaveBeenCalledTimes(1);

      tx.application.count.mockClear();
      stateInTx(A.PENDING, P.PUBLISHED, 1);
      await service.updateStatus(org(), 'a1', A.REJECTED);
      expect(tx.application.count).not.toHaveBeenCalled();
    });

    it('does not count capacity when the project has no maxVolunteers', async () => {
      await service.updateStatus(org(), 'a1', A.ACCEPTED);
      expect(tx.application.count).not.toHaveBeenCalled();
    });

    it('surfaces conflicts as ConflictException', async () => {
      stateInTx(A.REJECTED);
      await expect(service.updateStatus(org(), 'a1', A.ACCEPTED)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
