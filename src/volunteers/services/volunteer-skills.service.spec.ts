import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, ProficiencyLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VolunteerSkillsService } from './volunteer-skills.service';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 't' });

describe('VolunteerSkillsService', () => {
  let service: VolunteerSkillsService;
  const prisma = {
    skill: { findUnique: jest.fn() },
    userSkill: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  };
  const row = {
    userId: 'u1',
    skillId: 's1',
    proficiency: ProficiencyLevel.ADVANCED,
    createdAt: new Date(),
    skill: { id: 's1', name: 'First Aid', description: null },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [VolunteerSkillsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(VolunteerSkillsService);
  });

  it("lists only the caller's skills and hides internal ids", async () => {
    prisma.userSkill.findMany.mockResolvedValue([row]);
    const result = await service.list('u1');
    expect(prisma.userSkill.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
    expect(result[0]).toEqual({
      skill: row.skill,
      proficiency: 'ADVANCED',
      createdAt: row.createdAt,
    });
    expect(result[0]).not.toHaveProperty('userId');
  });

  describe('add', () => {
    it('defaults the proficiency to BEGINNER', async () => {
      prisma.skill.findUnique.mockResolvedValue({ id: 's1' });
      prisma.userSkill.create.mockResolvedValue({ ...row, proficiency: 'BEGINNER' });
      await service.add('u1', 's1');
      expect(prisma.userSkill.create.mock.calls[0][0].data).toEqual({
        userId: 'u1',
        skillId: 's1',
        proficiency: 'BEGINNER',
      });
    });

    it('404s when the skill does not exist', async () => {
      prisma.skill.findUnique.mockResolvedValue(null);
      await expect(service.add('u1', 'nope')).rejects.toThrow(NotFoundException);
      expect(prisma.userSkill.create).not.toHaveBeenCalled();
    });

    it('409s when the volunteer already has the skill', async () => {
      prisma.skill.findUnique.mockResolvedValue({ id: 's1' });
      prisma.userSkill.create.mockRejectedValue(prismaError('P2002'));
      await expect(service.add('u1', 's1')).rejects.toThrow(ConflictException);
    });
  });

  describe('updateProficiency / remove', () => {
    it("is scoped by the caller's userId (cannot touch another user's skill)", async () => {
      prisma.userSkill.update.mockResolvedValue(row);
      await service.updateProficiency('u1', 's1', ProficiencyLevel.EXPERT);
      expect(prisma.userSkill.update.mock.calls[0][0].where).toEqual({
        userId_skillId: { userId: 'u1', skillId: 's1' },
      });
    });

    it('404s when the volunteer does not have the skill', async () => {
      prisma.userSkill.update.mockRejectedValue(prismaError('P2025'));
      prisma.userSkill.delete.mockRejectedValue(prismaError('P2025'));
      await expect(service.updateProficiency('u1', 's1', 'EXPERT')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove('u1', 's1')).rejects.toThrow(NotFoundException);
    });

    it('does not swallow unexpected errors', async () => {
      prisma.userSkill.delete.mockRejectedValue(new Error('boom'));
      await expect(service.remove('u1', 's1')).rejects.toThrow('boom');
    });
  });
});
