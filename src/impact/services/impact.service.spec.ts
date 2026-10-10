import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, ProjectStatus as P, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { OrganizationsService } from '../../organizations/services/organizations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../../projects/services/projects.service';
import { ImpactService } from './impact.service';

const org: AuthenticatedUser = { id: 'user-org-1', email: 'o@x.co', role: Role.ORGANIZATION };
const volunteer: AuthenticatedUser = { id: 'v1', email: 'v@x.co', role: Role.VOLUNTEER };

const impactRow = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  projectId: 'p1',
  volunteersCount: 3,
  hours: new Prisma.Decimal('10.5'),
  activitiesCount: 2,
  beneficiariesCount: 40,
  resources: null,
  description: null,
  metrics: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('ImpactService', () => {
  let service: ImpactService;
  const prisma = {
    impact: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    project: { findFirst: jest.fn() },
    application: { count: jest.fn() },
  };
  const projects = { getManageableProject: jest.fn() };
  const organizations = { findIdByUserId: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    projects.getManageableProject.mockResolvedValue({
      id: 'p1',
      organizationId: 'org-1',
      status: P.COMPLETED,
    });
    prisma.application.count.mockResolvedValue(5);
    prisma.impact.create.mockResolvedValue(impactRow({ volunteersCount: 5 }));
    organizations.findIdByUserId.mockResolvedValue('org-1');

    const moduleRef = await Test.createTestingModule({
      providers: [
        ImpactService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectsService, useValue: projects },
        { provide: OrganizationsService, useValue: organizations },
      ],
    }).compile();
    service = moduleRef.get(ImpactService);
  });

  describe('create', () => {
    it('defaults volunteersCount to the number of ACCEPTED applications', async () => {
      const view = await service.create(org, 'p1', { hours: 12.5 });

      expect(prisma.application.count).toHaveBeenCalledWith({
        where: { projectId: 'p1', status: 'ACCEPTED' },
      });
      expect(prisma.impact.create.mock.calls[0][0].data).toMatchObject({
        projectId: 'p1',
        volunteersCount: 5,
        hours: 12.5,
      });
      expect(view.acceptedVolunteers).toBe(5);
    });

    it('lets the organization override the volunteer count (e.g. walk-ins), including with 0', async () => {
      await service.create(org, 'p1', { volunteersCount: 12 });
      expect(prisma.impact.create.mock.calls[0][0].data.volunteersCount).toBe(12);
      await service.create(org, 'p1', { volunteersCount: 0 });
      expect(prisma.impact.create.mock.calls[1][0].data.volunteersCount).toBe(0);
    });

    it('requires ownership (delegated to the project rules): others are rejected before any write', async () => {
      projects.getManageableProject.mockRejectedValue(new ForbiddenException());
      await expect(service.create(org, 'p1', {})).rejects.toThrow(ForbiddenException);
      expect(prisma.impact.create).not.toHaveBeenCalled();
    });

    it.each([P.DRAFT, P.PUBLISHED, P.CANCELLED])('refuses projects that are %s', async (status) => {
      projects.getManageableProject.mockResolvedValue({
        id: 'p1',
        organizationId: 'org-1',
        status,
      });
      await expect(service.create(org, 'p1', {})).rejects.toThrow(/in progress or completed/);
      expect(prisma.impact.create).not.toHaveBeenCalled();
    });

    it('accepts IN_PROGRESS (interim reports)', async () => {
      projects.getManageableProject.mockResolvedValue({
        id: 'p1',
        organizationId: 'org-1',
        status: P.IN_PROGRESS,
      });
      await expect(service.create(org, 'p1', {})).resolves.toBeDefined();
    });

    it('409s when impact was already recorded (also for simultaneous requests: unique constraint)', async () => {
      prisma.impact.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' }),
      );
      await expect(service.create(org, 'p1', {})).rejects.toThrow(
        'Impact has already been recorded',
      );
    });

    it('does not swallow unexpected errors', async () => {
      prisma.impact.create.mockRejectedValue(new Error('boom'));
      await expect(service.create(org, 'p1', {})).rejects.toThrow('boom');
    });
  });

  describe('findForProject', () => {
    it('applies the same visibility rule as browsing projects', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.findForProject(volunteer, 'p1')).rejects.toThrow('Project not found');
      expect(prisma.project.findFirst.mock.calls[0][0].where.AND[1].status).toEqual({
        not: 'DRAFT',
      });
    });

    it('distinguishes "no such project" from "no impact yet" (both 404)', async () => {
      prisma.project.findFirst.mockResolvedValue({ impact: null, _count: { applications: 0 } });
      await expect(service.findForProject(volunteer, 'p1')).rejects.toThrow(NotFoundException);
      await expect(service.findForProject(volunteer, 'p1')).rejects.toThrow(
        'No impact has been recorded',
      );
    });

    it('returns the impact with the live accepted count', async () => {
      prisma.project.findFirst.mockResolvedValue({
        impact: impactRow(),
        _count: { applications: 4 },
      });
      const view = await service.findForProject(volunteer, 'p1');
      expect(view).toMatchObject({ volunteersCount: 3, acceptedVolunteers: 4, hours: 10.5 });
    });

    it('lets an organization see its own draft projects (owner visibility)', async () => {
      prisma.project.findFirst.mockResolvedValue({
        impact: impactRow(),
        _count: { applications: 0 },
      });
      await service.findForProject(org, 'p1');
      expect(organizations.findIdByUserId).toHaveBeenCalledWith('user-org-1');
      expect(prisma.project.findFirst.mock.calls[0][0].where.AND[1].OR[0]).toEqual({
        organizationId: 'org-1',
      });
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.impact.findUnique.mockResolvedValue({ id: 'i1' });
      prisma.impact.update.mockResolvedValue(impactRow({ hours: new Prisma.Decimal('99') }));
    });

    it('updates the record of the project, even after the project is COMPLETED', async () => {
      const view = await service.update(org, 'p1', { hours: 99 });
      expect(prisma.impact.update.mock.calls[0][0]).toMatchObject({ where: { projectId: 'p1' } });
      expect(prisma.impact.update.mock.calls[0][0].data.hours).toBe(99);
      expect(view.hours).toBe(99);
    });

    it('404s if nothing was recorded yet', async () => {
      prisma.impact.findUnique.mockResolvedValue(null);
      await expect(service.update(org, 'p1', { hours: 1 })).rejects.toThrow(
        'No impact has been recorded',
      );
    });

    it('refuses cancelled projects and non-owners', async () => {
      projects.getManageableProject.mockResolvedValue({
        id: 'p1',
        organizationId: 'org-1',
        status: P.CANCELLED,
      });
      await expect(service.update(org, 'p1', {})).rejects.toThrow(ConflictException);

      projects.getManageableProject.mockRejectedValue(new ForbiddenException());
      await expect(service.update(org, 'p1', {})).rejects.toThrow(ForbiddenException);
      expect(prisma.impact.update).not.toHaveBeenCalled();
    });

    it('passes null through to clear optional text fields', async () => {
      await service.update(org, 'p1', { resources: null, description: null });
      expect(prisma.impact.update.mock.calls[0][0].data).toMatchObject({
        resources: null,
        description: null,
      });
    });
  });
});
