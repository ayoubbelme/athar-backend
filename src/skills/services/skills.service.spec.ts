import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListSkillsQueryDto } from '../dto/skill.dto';
import { SkillsService } from './skills.service';

const skill = { id: 's1', name: 'First Aid', description: null, createdAt: new Date() };

describe('SkillsService', () => {
  let service: SkillsService;
  const prisma = {
    skill: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    const moduleRef = await Test.createTestingModule({
      providers: [SkillsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(SkillsService);
  });

  describe('list', () => {
    const query = (over: Partial<ListSkillsQueryDto> = {}) =>
      Object.assign(new ListSkillsQueryDto(), over);

    it('paginates and returns the standard envelope', async () => {
      prisma.skill.findMany.mockResolvedValue([skill]);
      prisma.skill.count.mockResolvedValue(41);

      const result = await service.list(query({ page: 2, limit: 20 }));

      expect(prisma.skill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20, orderBy: { name: 'asc' } }),
      );
      expect(result.meta).toEqual({ page: 2, limit: 20, total: 41, totalPages: 3 });
    });

    it('applies a case-insensitive search on name and description', async () => {
      prisma.skill.findMany.mockResolvedValue([]);
      prisma.skill.count.mockResolvedValue(0);
      await service.list(query({ search: 'aid', sortBy: 'createdAt', order: 'desc' }));

      const args = prisma.skill.findMany.mock.calls[0][0];
      expect(args.where.OR).toEqual([
        { name: { contains: 'aid', mode: 'insensitive' } },
        { description: { contains: 'aid', mode: 'insensitive' } },
      ]);
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  describe('create', () => {
    it('creates when the name is free', async () => {
      prisma.skill.findFirst.mockResolvedValue(null);
      prisma.skill.create.mockResolvedValue(skill);
      await expect(service.create({ name: 'First Aid' })).resolves.toBe(skill);
    });

    it('rejects a name that exists ignoring case', async () => {
      prisma.skill.findFirst.mockResolvedValue({ id: 'other' });
      await expect(service.create({ name: 'first aid' })).rejects.toThrow(ConflictException);
      expect(prisma.skill.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: { equals: 'first aid', mode: 'insensitive' } } }),
      );
      expect(prisma.skill.create).not.toHaveBeenCalled();
    });

    it('turns a racing unique-constraint violation into 409', async () => {
      prisma.skill.findFirst.mockResolvedValue(null);
      prisma.skill.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' }),
      );
      await expect(service.create({ name: 'X1' })).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('404s for an unknown skill', async () => {
      prisma.skill.findUnique.mockResolvedValue(null);
      await expect(service.update('nope', { description: 'd' })).rejects.toThrow(NotFoundException);
    });

    it('excludes the skill itself from the duplicate-name check', async () => {
      prisma.skill.findUnique.mockResolvedValue(skill);
      prisma.skill.findFirst.mockResolvedValue(null);
      prisma.skill.update.mockResolvedValue(skill);
      await service.update('s1', { name: 'FIRST AID' });
      expect(prisma.skill.findFirst.mock.calls[0][0].where.id).toEqual({ not: 's1' });
    });

    it('rejects renaming onto another skill', async () => {
      prisma.skill.findUnique.mockResolvedValue(skill);
      prisma.skill.findFirst.mockResolvedValue({ id: 's2' });
      await expect(service.update('s1', { name: 'Teaching' })).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('404s for an unknown skill', async () => {
      prisma.skill.findUnique.mockResolvedValue(null);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });

    it('refuses to delete a skill that is still in use', async () => {
      prisma.skill.findUnique.mockResolvedValue({ ...skill, _count: { users: 2, projects: 1 } });
      await expect(service.remove('s1')).rejects.toThrow(/2 volunteer\(s\) and 1 project\(s\)/);
      expect(prisma.skill.delete).not.toHaveBeenCalled();
    });

    it('deletes an unused skill', async () => {
      prisma.skill.findUnique.mockResolvedValue({ ...skill, _count: { users: 0, projects: 0 } });
      await service.remove('s1');
      expect(prisma.skill.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });
  });
});
