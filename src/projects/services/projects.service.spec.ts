import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProjectStatus as S, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { OrganizationsService } from '../../organizations/services/organizations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListProjectsQueryDto } from '../dto/project.dto';
import { ProjectSkillsService } from './project-skills.service';
import { ProjectsService } from './projects.service';

const org = (id = 'org-1'): AuthenticatedUser => ({
  id: `user-${id}`,
  email: 'o@x.co',
  role: Role.ORGANIZATION,
});
const volunteer: AuthenticatedUser = { id: 'v1', email: 'v@x.co', role: Role.VOLUNTEER };
const admin: AuthenticatedUser = { id: 'a1', email: 'a@x.co', role: Role.ADMIN };

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  organizationId: 'org-1',
  title: 'T',
  description: 'D',
  location: null,
  startDate: null,
  endDate: null,
  status: S.DRAFT,
  maxVolunteers: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  organization: { id: 'org-1', name: 'Org', logo: null, location: null },
  skills: [
    {
      skill: { id: 's1', name: 'First Aid' },
      requiredCount: 2,
      importance: 5,
      projectId: 'p1',
      skillId: 's1',
    },
  ],
  _count: { applications: 3 },
  ...over,
});

describe('ProjectsService', () => {
  let service: ProjectsService;
  const prisma = {
    project: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    application: { count: jest.fn() },
    $transaction: jest.fn(),
  };
  const organizations = { findIdByUserId: jest.fn() };
  const projectSkills = {
    assertSkillsExist: jest.fn(),
    toCreateData: jest.fn(),
    replace: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    organizations.findIdByUserId.mockImplementation((userId: string) =>
      Promise.resolve(userId.startsWith('user-') ? userId.replace('user-', '') : null),
    );
    projectSkills.toCreateData.mockReturnValue([{ marker: true }]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrganizationsService, useValue: organizations },
        { provide: ProjectSkillsService, useValue: projectSkills },
      ],
    }).compile();
    service = moduleRef.get(ProjectsService);
  });

  describe('create', () => {
    it('derives the owner from the caller and defaults to DRAFT', async () => {
      prisma.project.create.mockResolvedValue(row());
      const view = await service.create(org(), {
        title: 'T',
        description: 'D',
        skills: [{ skillId: 's1' }],
      });

      const data = prisma.project.create.mock.calls[0][0].data;
      expect(data.organizationId).toBe('org-1');
      expect(data.status).toBe(S.DRAFT);
      expect(data.skills).toEqual({ create: [{ marker: true }] });
      expect(view.acceptedVolunteers).toBe(3);
      expect(view.skills[0]).toEqual({
        skill: { id: 's1', name: 'First Aid' },
        requiredCount: 2,
        importance: 5,
      });
    });

    it('rejects callers without an organization profile', async () => {
      await expect(service.create(volunteer, { title: 'T', description: 'D' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('422s when endDate is before startDate', async () => {
      await expect(
        service.create(org(), {
          title: 'T',
          description: 'D',
          startDate: new Date('2026-05-02'),
          endDate: new Date('2026-05-01'),
        }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.project.create).not.toHaveBeenCalled();
    });

    it('validates required skills before writing', async () => {
      projectSkills.assertSkillsExist.mockRejectedValue(new UnprocessableEntityException());
      await expect(
        service.create(org(), { title: 'T', description: 'D', skills: [{ skillId: 'ghost' }] }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.project.create).not.toHaveBeenCalled();
    });
  });

  describe('list / findOne visibility', () => {
    const query = (over: Partial<ListProjectsQueryDto> = {}) =>
      Object.assign(new ListProjectsQueryDto(), over);

    it('applies the volunteer visibility filter AND the requested filters', async () => {
      prisma.project.findMany.mockResolvedValue([row({ status: S.PUBLISHED })]);
      prisma.project.count.mockResolvedValue(1);

      await service.list(
        volunteer,
        query({
          status: S.PUBLISHED,
          location: 'alg',
          skillId: 's1',
          organizationId: 'org-1',
          search: 'health',
        }),
      );

      const { where } = prisma.project.findMany.mock.calls[0][0];
      const [visibility, filters] = where.AND;
      expect(visibility.status).toEqual({ not: 'DRAFT' });
      expect(filters).toMatchObject({
        status: 'PUBLISHED',
        organizationId: 'org-1',
        location: { contains: 'alg', mode: 'insensitive' },
        skills: { some: { skillId: 's1' } },
      });
      expect(filters.OR).toHaveLength(2);
    });

    it('applies the date range and null-safe date sorting', async () => {
      prisma.project.findMany.mockResolvedValue([]);
      prisma.project.count.mockResolvedValue(0);
      const from = new Date('2026-11-01');
      const to = new Date('2026-12-01');

      await service.list(
        admin,
        query({ startDateFrom: from, startDateTo: to, sortBy: 'startDate', order: 'asc' }),
      );

      const args = prisma.project.findMany.mock.calls[0][0];
      expect(args.where.AND[0]).toEqual({}); // admin: no visibility restriction
      expect(args.where.AND[1].startDate).toEqual({ gte: from, lte: to });
      expect(args.orderBy).toEqual([{ startDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]);
    });

    it('lets organizations see their own drafts through the visibility filter', async () => {
      prisma.project.findMany.mockResolvedValue([]);
      prisma.project.count.mockResolvedValue(0);
      await service.list(org(), query());
      expect(prisma.project.findMany.mock.calls[0][0].where.AND[0].OR[0]).toEqual({
        organizationId: 'org-1',
      });
    });

    it('returns the same 404 for missing and invisible projects', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.findOne(volunteer, 'p1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const current = (over: Record<string, unknown> = {}) => ({
      id: 'p1',
      organizationId: 'org-1',
      status: S.DRAFT,
      startDate: null,
      endDate: null,
      ...over,
    });

    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue(current());
      prisma.project.update.mockResolvedValue(row());
    });

    it('lets the owner update', async () => {
      await service.update(org(), 'p1', { title: 'New title' });
      expect(prisma.project.update.mock.calls[0][0].data.title).toBe('New title');
    });

    it('404s for unknown projects', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(service.update(org(), 'nope', {})).rejects.toThrow(NotFoundException);
    });

    it("403s for another organization's public project but 404s for its draft", async () => {
      prisma.project.findUnique.mockResolvedValue(current({ status: S.PUBLISHED }));
      await expect(service.update(org('org-2'), 'p1', { title: 'Hack' })).rejects.toThrow(
        ForbiddenException,
      );

      prisma.project.findUnique.mockResolvedValue(current({ status: S.DRAFT }));
      await expect(service.update(org('org-2'), 'p1', { title: 'Hack' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('lets ADMIN update any project', async () => {
      await service.update(admin, 'p1', { title: 'Moderated' });
      expect(prisma.project.update).toHaveBeenCalled();
    });

    it('refuses to modify COMPLETED / CANCELLED projects', async () => {
      prisma.project.findUnique.mockResolvedValue(current({ status: S.COMPLETED }));
      await expect(service.update(org(), 'p1', { title: 'x' })).rejects.toThrow(
        /can no longer be modified/,
      );
      prisma.project.findUnique.mockResolvedValue(current({ status: S.CANCELLED }));
      await expect(service.update(org(), 'p1', { title: 'x' })).rejects.toThrow(ConflictException);
    });

    it('validates status transitions', async () => {
      await service.update(org(), 'p1', { status: S.PUBLISHED }); // DRAFT → PUBLISHED ok
      await expect(service.update(org(), 'p1', { status: S.COMPLETED })).rejects.toThrow(
        'Cannot change project status from DRAFT to COMPLETED',
      );
      prisma.project.findUnique.mockResolvedValue(current({ status: S.PUBLISHED }));
      await expect(service.update(org(), 'p1', { status: S.DRAFT })).rejects.toThrow(
        ConflictException,
      );
    });

    it('validates date order against the stored values for partial updates', async () => {
      prisma.project.findUnique.mockResolvedValue(current({ startDate: new Date('2026-06-10') }));
      await expect(
        service.update(org(), 'p1', { endDate: new Date('2026-06-01') }),
      ).rejects.toThrow(UnprocessableEntityException);
      await expect(
        service.update(org(), 'p1', { endDate: new Date('2026-06-20') }),
      ).resolves.toBeDefined();
    });

    it('does not allow maxVolunteers below the accepted count', async () => {
      prisma.application.count.mockResolvedValue(5);
      await expect(service.update(org(), 'p1', { maxVolunteers: 4 })).rejects.toThrow(
        ConflictException,
      );
      await expect(service.update(org(), 'p1', { maxVolunteers: 5 })).resolves.toBeDefined();
    });
  });

  describe('replaceSkills', () => {
    it('replaces for the owner, rejects for final projects', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: 'p1',
        organizationId: 'org-1',
        status: S.PUBLISHED,
      });
      prisma.project.findUniqueOrThrow.mockResolvedValue(row());
      await service.replaceSkills(org(), 'p1', { skills: [{ skillId: 's1' }] });
      expect(projectSkills.replace).toHaveBeenCalledWith('p1', [{ skillId: 's1' }]);

      prisma.project.findUnique.mockResolvedValue({
        id: 'p1',
        organizationId: 'org-1',
        status: S.COMPLETED,
      });
      await expect(service.replaceSkills(org(), 'p1', { skills: [] })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('remove', () => {
    it('lets owners delete drafts only', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: 'p1',
        organizationId: 'org-1',
        status: S.DRAFT,
      });
      await service.remove(org(), 'p1');
      expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });

      prisma.project.delete.mockClear();
      prisma.project.findUnique.mockResolvedValue({
        id: 'p1',
        organizationId: 'org-1',
        status: S.PUBLISHED,
      });
      await expect(service.remove(org(), 'p1')).rejects.toThrow(/Cancel the project instead/);
      expect(prisma.project.delete).not.toHaveBeenCalled();
    });

    it('lets ADMIN delete any project', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: 'p1',
        organizationId: 'org-9',
        status: S.COMPLETED,
      });
      await service.remove(admin, 'p1');
      expect(prisma.project.delete).toHaveBeenCalled();
    });

    it("forbids deleting someone else's project", async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: 'p1',
        organizationId: 'org-1',
        status: S.PUBLISHED,
      });
      await expect(service.remove(org('org-2'), 'p1')).rejects.toThrow(ForbiddenException);
    });
  });
});
