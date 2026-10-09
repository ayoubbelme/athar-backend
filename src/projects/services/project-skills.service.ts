import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectSkillInputDto } from '../dto/project.dto';

export const DEFAULT_REQUIRED_COUNT = 1;
export const DEFAULT_IMPORTANCE = 3;

/** Everything about a project's required skills (validation + replace). */
@Injectable()
export class ProjectSkillsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every referenced skill must exist. Duplicates are already rejected by the DTO. */
  async assertSkillsExist(inputs: readonly ProjectSkillInputDto[] | undefined): Promise<void> {
    if (!inputs || inputs.length === 0) return;
    const ids = [...new Set(inputs.map((s) => s.skillId))];
    const found = await this.prisma.skill.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new UnprocessableEntityException('One or more required skills do not exist');
    }
  }

  toCreateData(
    inputs: readonly ProjectSkillInputDto[],
  ): Prisma.ProjectSkillCreateWithoutProjectInput[] {
    return inputs.map((s) => ({
      skill: { connect: { id: s.skillId } },
      requiredCount: s.requiredCount ?? DEFAULT_REQUIRED_COUNT,
      importance: s.importance ?? DEFAULT_IMPORTANCE,
    }));
  }

  /** Atomically replaces the whole set of required skills of a project. */
  async replace(projectId: string, inputs: readonly ProjectSkillInputDto[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.projectSkill.deleteMany({ where: { projectId } }),
      this.prisma.projectSkill.createMany({
        data: inputs.map((s) => ({
          projectId,
          skillId: s.skillId,
          requiredCount: s.requiredCount ?? DEFAULT_REQUIRED_COUNT,
          importance: s.importance ?? DEFAULT_IMPORTANCE,
        })),
      }),
    ]);
  }
}
