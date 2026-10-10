import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApplicationStatus as A, Prisma, ProjectStatus as P, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { MatchingService } from '../../matching/services/matching.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListMyApplicationsQueryDto } from '../dto/application.dto';
import { ApplicationsService } from './applications.service';

const vol: AuthenticatedUser = { id: 'v1', email: 'v@x.co', role: Role.VOLUNTEER };
const appRow = {
  id: 'a1',
  status: A.PENDING,
  matchScore: null,
  message: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  project: {
    id: 'p1',
    title: 'T',
    status: P.PUBLISHED,
    location: null,
    startDate: null,
    endDate: null,
    organization: { id: 'o1', name: 'Org', logo: null },
  },
};

describe('ApplicationsService (volunteer side)', () => {
  let service: ApplicationsService;
  const prisma = {
    project: { findFirst: jest.fn() },
    application: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const matching = { scoreForApplication: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    prisma.project.findFirst.mockResolvedValue({ id: 'p1', status: P.PUBLISHED });
    prisma.application.findUnique.mockResolvedValue(null);
    prisma.application.create.mockResolvedValue({ id: 'a1' });
    prisma.application.update.mockResolvedValue({ ...appRow, matchScore: 87 });
    matching.scoreForApplication.mockResolvedValue(87);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ApplicationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MatchingService, useValue: matching },
      ],
    }).compile();
    service = moduleRef.get(ApplicationsService);
  });

  describe('apply', () => {
    it('creates a PENDING application for the caller and returns the volunteer view', async () => {
      const view = await service.apply(vol, 'p1', { message: 'Hi' });
      expect(prisma.application.create).toHaveBeenCalledWith({
        data: { projectId: 'p1', volunteerId: 'v1', message: 'Hi' },
        select: { id: true },
      });
      expect(view).toMatchObject({ id: 'a1', status: 'PENDING', project: { id: 'p1' } });
      expect(view).not.toHaveProperty('volunteerId');
    });

    it('stores the match score computed at application time', async () => {
      const view = await service.apply(vol, 'p1', {});
      expect(matching.scoreForApplication).toHaveBeenCalledWith('v1', 'p1');
      expect(prisma.application.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'a1' }, data: { matchScore: 87 } }),
      );
      expect(view.matchScore).toBe(87);
    });

    it('still lets the volunteer apply when matching is unavailable (score stays empty)', async () => {
      matching.scoreForApplication.mockResolvedValue(null);
      prisma.application.update.mockResolvedValue({ ...appRow, matchScore: null });
      const view = await service.apply(vol, 'p1', {});
      expect(prisma.application.update.mock.calls[0][0].data).toEqual({ matchScore: null });
      expect(view.matchScore).toBeNull();
    });

    it('uses the public-visibility filter, so drafts / hidden projects are 404', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.apply(vol, 'p1', {})).rejects.toThrow(NotFoundException);
      const where = prisma.project.findFirst.mock.calls[0][0].where.AND;
      expect(where[1].status).toEqual({ not: 'DRAFT' });
    });

    it.each([P.IN_PROGRESS, P.COMPLETED, P.CANCELLED])(
      'refuses projects that are %s with 409',
      async (status) => {
        prisma.project.findFirst.mockResolvedValue({ id: 'p1', status });
        await expect(service.apply(vol, 'p1', {})).rejects.toThrow(
          'This project is not open for applications',
        );
        expect(prisma.application.create).not.toHaveBeenCalled();
      },
    );

    it.each([A.PENDING, A.ACCEPTED, A.REJECTED])(
      'blocks a second application while the first is %s',
      async (status) => {
        prisma.application.findUnique.mockResolvedValue({ id: 'a1', status });
        await expect(service.apply(vol, 'p1', {})).rejects.toThrow(
          'You have already applied to this project',
        );
        expect(prisma.application.create).not.toHaveBeenCalled();
        expect(prisma.application.updateMany).not.toHaveBeenCalled();
      },
    );

    it('reactivates a WITHDRAWN application instead of creating a duplicate', async () => {
      prisma.application.findUnique.mockResolvedValue({ id: 'a1', status: A.WITHDRAWN });
      prisma.application.updateMany.mockResolvedValue({ count: 1 });
      await service.apply(vol, 'p1', { message: 'Back again' });

      expect(prisma.application.updateMany).toHaveBeenCalledWith({
        where: { id: 'a1', status: A.WITHDRAWN },
        data: { status: A.PENDING, message: 'Back again', matchScore: null },
      });
      expect(prisma.application.create).not.toHaveBeenCalled();
    });

    it('turns a lost reactivation race into 409', async () => {
      prisma.application.findUnique.mockResolvedValue({ id: 'a1', status: A.WITHDRAWN });
      prisma.application.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.apply(vol, 'p1', {})).rejects.toThrow(ConflictException);
    });

    it('turns the unique-constraint race of two simultaneous applies into 409', async () => {
      prisma.application.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' }),
      );
      await expect(service.apply(vol, 'p1', {})).rejects.toThrow(
        'You have already applied to this project',
      );
    });
  });

  describe('listMine', () => {
    it('is always scoped to the caller and paginated', async () => {
      prisma.application.findMany.mockResolvedValue([appRow]);
      prisma.application.count.mockResolvedValue(21);
      const query = Object.assign(new ListMyApplicationsQueryDto(), {
        status: A.ACCEPTED,
        page: 2,
        limit: 10,
      });

      const result = await service.listMine(vol, query);

      const args = prisma.application.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ volunteerId: 'v1', status: 'ACCEPTED' });
      expect(args).toMatchObject({ skip: 10, take: 10 });
      expect(result.meta).toEqual({ page: 2, limit: 10, total: 21, totalPages: 3 });
    });
  });

  describe('withdraw', () => {
    const found = (status: A, projectStatus: P = P.PUBLISHED) => ({
      id: 'a1',
      status,
      project: { status: projectStatus },
    });

    it("is scoped to the caller: another volunteer's application is a 404", async () => {
      prisma.application.findFirst.mockResolvedValue(null);
      await expect(service.withdraw(vol, 'a1')).rejects.toThrow(NotFoundException);
      expect(prisma.application.findFirst.mock.calls[0][0].where).toEqual({
        id: 'a1',
        volunteerId: 'v1',
      });
    });

    it.each([A.PENDING, A.ACCEPTED])(
      'withdraws a %s application with a concurrency guard',
      async (status) => {
        prisma.application.findFirst.mockResolvedValue(found(status));
        prisma.application.updateMany.mockResolvedValue({ count: 1 });
        await service.withdraw(vol, 'a1');
        expect(prisma.application.updateMany).toHaveBeenCalledWith({
          where: { id: 'a1', status },
          data: { status: 'WITHDRAWN' },
        });
      },
    );

    it('is idempotent for an already withdrawn application', async () => {
      prisma.application.findFirst.mockResolvedValue(found(A.WITHDRAWN));
      await expect(service.withdraw(vol, 'a1')).resolves.toBeUndefined();
      expect(prisma.application.updateMany).not.toHaveBeenCalled();
    });

    it('cannot withdraw a rejected application', async () => {
      prisma.application.findFirst.mockResolvedValue(found(A.REJECTED));
      await expect(service.withdraw(vol, 'a1')).rejects.toThrow(
        'Cannot withdraw an application that is REJECTED',
      );
    });

    it('cannot withdraw from a closed project', async () => {
      prisma.application.findFirst.mockResolvedValue(found(A.ACCEPTED, P.COMPLETED));
      await expect(service.withdraw(vol, 'a1')).rejects.toThrow('This project is closed');
    });

    it('reports a concurrent modification as 409', async () => {
      prisma.application.findFirst.mockResolvedValue(found(A.PENDING));
      prisma.application.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.withdraw(vol, 'a1')).rejects.toThrow(ConflictException);
    });
  });
});
