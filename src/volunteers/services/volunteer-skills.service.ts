import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProficiencyLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface UserSkillView {
  skill: { id: string; name: string; description: string | null };
  proficiency: ProficiencyLevel;
  createdAt: Date;
}

const USER_SKILL_INCLUDE = {
  skill: { select: { id: true, name: true, description: true } },
} satisfies Prisma.UserSkillInclude;

const toView = (row: {
  skill: UserSkillView['skill'];
  proficiency: ProficiencyLevel;
  createdAt: Date;
}): UserSkillView => ({
  skill: row.skill,
  proficiency: row.proficiency,
  createdAt: row.createdAt,
});

/** Skills held by one volunteer. Every method is scoped by the caller's own userId. */
@Injectable()
export class VolunteerSkillsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<UserSkillView[]> {
    const rows = await this.prisma.userSkill.findMany({
      where: { userId },
      include: USER_SKILL_INCLUDE,
      orderBy: { skill: { name: 'asc' } },
    });
    return rows.map(toView);
  }

  async add(
    userId: string,
    skillId: string,
    proficiency: ProficiencyLevel = ProficiencyLevel.BEGINNER,
  ): Promise<UserSkillView> {
    const skill = await this.prisma.skill.findUnique({
      where: { id: skillId },
      select: { id: true },
    });
    if (!skill) throw new NotFoundException('Skill not found');

    try {
      const row = await this.prisma.userSkill.create({
        data: { userId, skillId, proficiency },
        include: USER_SKILL_INCLUDE,
      });
      return toView(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You already have this skill');
      }
      throw error;
    }
  }

  async updateProficiency(
    userId: string,
    skillId: string,
    proficiency: ProficiencyLevel,
  ): Promise<UserSkillView> {
    try {
      const row = await this.prisma.userSkill.update({
        where: { userId_skillId: { userId, skillId } },
        data: { proficiency },
        include: USER_SKILL_INCLUDE,
      });
      return toView(row);
    } catch (error) {
      throw this.translateNotFound(error);
    }
  }

  async remove(userId: string, skillId: string): Promise<void> {
    try {
      await this.prisma.userSkill.delete({ where: { userId_skillId: { userId, skillId } } });
    } catch (error) {
      throw this.translateNotFound(error);
    }
  }

  private translateNotFound(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return new NotFoundException('You do not have this skill');
    }
    return error;
  }
}
