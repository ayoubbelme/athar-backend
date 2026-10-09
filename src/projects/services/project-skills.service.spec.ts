import { UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectSkillsService } from './project-skills.service';

describe('ProjectSkillsService', () => {
  let service: ProjectSkillsService;
  const prisma = {
    skill: { count: jest.fn() },
    projectSkill: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    const moduleRef = await Test.createTestingModule({
      providers: [ProjectSkillsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ProjectSkillsService);
  });

  it('accepts when every skill exists, and skips the query for empty input', async () => {
    prisma.skill.count.mockResolvedValue(2);
    await expect(
      service.assertSkillsExist([{ skillId: 'a' }, { skillId: 'b' }]),
    ).resolves.toBeUndefined();
    await service.assertSkillsExist([]);
    await service.assertSkillsExist(undefined);
    expect(prisma.skill.count).toHaveBeenCalledTimes(1);
  });

  it('rejects with 422 when a skill does not exist', async () => {
    prisma.skill.count.mockResolvedValue(1);
    await expect(
      service.assertSkillsExist([{ skillId: 'a' }, { skillId: 'ghost' }]),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('applies defaults (requiredCount 1, importance 3)', () => {
    const [row] = service.toCreateData([{ skillId: 'a' }]);
    expect(row).toMatchObject({ requiredCount: 1, importance: 3, skill: { connect: { id: 'a' } } });
    const [custom] = service.toCreateData([{ skillId: 'a', requiredCount: 4, importance: 5 }]);
    expect(custom).toMatchObject({ requiredCount: 4, importance: 5 });
  });

  it('replaces the full set in one transaction', async () => {
    await service.replace('p1', [{ skillId: 'a', importance: 5 }]);
    expect(prisma.projectSkill.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(prisma.projectSkill.createMany).toHaveBeenCalledWith({
      data: [{ projectId: 'p1', skillId: 'a', requiredCount: 1, importance: 5 }],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
