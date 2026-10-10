import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ImpactStatsService } from './impact-stats.service';

describe('ImpactStatsService', () => {
  let service: ImpactStatsService;
  const prisma = {
    organizationProfile: { count: jest.fn() },
    user: { count: jest.fn() },
    project: { groupBy: jest.fn() },
    impact: { aggregate: jest.fn() },
    $queryRaw: jest.fn(),
  };

  const aggregateResult = {
    _count: { _all: 3 },
    _sum: {
      volunteersCount: 40,
      hours: new Prisma.Decimal('312.75'),
      activitiesCount: 9,
      beneficiariesCount: 700,
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.organizationProfile.count.mockResolvedValue(1);
    prisma.user.count.mockResolvedValue(8);
    prisma.project.groupBy.mockResolvedValue([
      { status: 'DRAFT', _count: { _all: 2 } },
      { status: 'COMPLETED', _count: { _all: 3 } },
      { status: 'CANCELLED', _count: { _all: 1 } },
    ]);
    prisma.impact.aggregate.mockResolvedValue(aggregateResult);
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join('').includes('COUNT(DISTINCT')
          ? [{ count: 17 }]
          : [
              {
                category: 'HEALTH',
                projects: 2,
                volunteers: 30,
                hours: 250.5,
                activities: 6,
                beneficiaries: 500,
              },
              {
                category: null,
                projects: 1,
                volunteers: 10,
                hours: 62.25,
                activities: 3,
                beneficiaries: 200,
              },
            ],
      ),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [ImpactStatsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ImpactStatsService);
  });

  describe('forOrganization', () => {
    it('404s for an unknown organization', async () => {
      prisma.organizationProfile.count.mockResolvedValue(0);
      await expect(service.forOrganization('ghost')).rejects.toThrow(NotFoundException);
      expect(prisma.impact.aggregate).not.toHaveBeenCalled();
    });

    it('shapes the figures and converts the decimal hours', async () => {
      const stats = await service.forOrganization('org-1');
      expect(stats).toEqual({
        organizationId: 'org-1',
        projects: { total: 6, draft: 2, published: 0, inProgress: 0, completed: 3, cancelled: 1 },
        impact: {
          projectsWithImpact: 3,
          volunteersCount: 40,
          hours: 312.75,
          activitiesCount: 9,
          beneficiariesCount: 700,
        },
        uniqueVolunteers: 17,
        byCategory: [
          {
            category: 'HEALTH',
            projectsWithImpact: 2,
            volunteersCount: 30,
            hours: 250.5,
            activitiesCount: 6,
            beneficiariesCount: 500,
          },
          {
            category: null,
            projectsWithImpact: 1,
            volunteersCount: 10,
            hours: 62.25,
            activitiesCount: 3,
            beneficiariesCount: 200,
          },
        ],
      });
    });

    it('scopes EVERY query to the organization (no cross-organization leakage)', async () => {
      await service.forOrganization('org-1');

      expect(prisma.project.groupBy.mock.calls[0][0].where).toEqual({ organizationId: 'org-1' });
      expect(prisma.impact.aggregate.mock.calls[0][0].where.project).toMatchObject({
        organizationId: 'org-1',
      });
      // both raw queries bind the organization id as a parameter (never string-concatenated)
      for (const call of prisma.$queryRaw.mock.calls) {
        const fragment = call[1] as Prisma.Sql;
        expect(fragment.values).toEqual(['org-1']);
        expect(fragment.sql).toContain('"organizationId"');
      }
    });

    it('excludes cancelled projects from impact totals', async () => {
      await service.forOrganization('org-1');
      expect(prisma.impact.aggregate.mock.calls[0][0].where.project.status).toEqual({
        not: 'CANCELLED',
      });
      for (const call of prisma.$queryRaw.mock.calls) {
        expect((call[0] as TemplateStringsArray).join('')).toContain("p.status <> 'CANCELLED'");
      }
    });

    it('reports zeros for an organization without any impact', async () => {
      prisma.project.groupBy.mockResolvedValue([]);
      prisma.impact.aggregate.mockResolvedValue({
        _count: { _all: 0 },
        _sum: {
          volunteersCount: null,
          hours: null,
          activitiesCount: null,
          beneficiariesCount: null,
        },
      });
      prisma.$queryRaw.mockResolvedValue([]);

      const stats = await service.forOrganization('org-1');
      expect(stats.projects).toEqual({
        total: 0,
        draft: 0,
        published: 0,
        inProgress: 0,
        completed: 0,
        cancelled: 0,
      });
      expect(stats.impact).toEqual({
        projectsWithImpact: 0,
        volunteersCount: 0,
        hours: 0,
        activitiesCount: 0,
        beneficiariesCount: 0,
      });
      expect(stats.uniqueVolunteers).toBe(0);
      expect(stats.byCategory).toEqual([]);
    });
  });

  describe('forPlatform', () => {
    it('aggregates globally and counts only ACTIVE accounts', async () => {
      const stats = await service.forPlatform();

      expect(stats).toMatchObject({ organizations: 1, volunteers: 8, uniqueVolunteers: 17 });
      expect(prisma.organizationProfile.count.mock.calls[0][0]).toEqual({
        where: { user: { status: 'ACTIVE' } },
      });
      expect(prisma.user.count.mock.calls[0][0]).toEqual({
        where: { role: 'VOLUNTEER', status: 'ACTIVE' },
      });
      expect(prisma.project.groupBy.mock.calls[0][0].where).toEqual({});
      expect(prisma.impact.aggregate.mock.calls[0][0].where.project).toEqual({
        status: { not: 'CANCELLED' },
      });
      for (const call of prisma.$queryRaw.mock.calls) {
        expect((call[1] as Prisma.Sql).sql).toBe(''); // no organization filter
      }
    });
  });
});
