import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Skill } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-response.dto';
import { buildPaginatedResult, toPrismaPagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSkillDto, ListSkillsQueryDto, UpdateSkillDto } from '../dto/skill.dto';

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListSkillsQueryDto): Promise<PaginatedResult<Skill>> {
    const where: Prisma.SkillWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [data, total] = await this.prisma.$transaction([
      this.prisma.skill.findMany({
        where,
        orderBy: { [query.sortBy]: query.order },
        ...toPrismaPagination(query),
      }),
      this.prisma.skill.count({ where }),
    ]);
    return buildPaginatedResult(data, total, query);
  }

  async findOne(id: string): Promise<Skill> {
    const skill = await this.prisma.skill.findUnique({ where: { id } });
    if (!skill) throw new NotFoundException('Skill not found');
    return skill;
  }

  async create(dto: CreateSkillDto): Promise<Skill> {
    await this.assertNameAvailable(dto.name);
    try {
      return await this.prisma.skill.create({ data: dto });
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }
  }

  async update(id: string, dto: UpdateSkillDto): Promise<Skill> {
    await this.findOne(id);
    if (dto.name !== undefined) await this.assertNameAvailable(dto.name, id);
    try {
      return await this.prisma.skill.update({ where: { id }, data: dto });
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }
  }

  /**
   * A skill that is still referenced cannot be deleted: cascading would silently strip it
   * from volunteers' profiles and from projects' requirements.
   */
  async remove(id: string): Promise<void> {
    const skill = await this.prisma.skill.findUnique({
      where: { id },
      include: { _count: { select: { users: true, projects: true } } },
    });
    if (!skill) throw new NotFoundException('Skill not found');

    const { users, projects } = skill._count;
    if (users + projects > 0) {
      throw new ConflictException(
        `Skill is in use by ${users} volunteer(s) and ${projects} project(s) and cannot be deleted`,
      );
    }
    await this.prisma.skill.delete({ where: { id } });
  }

  /** Names are unique ignoring case ("first aid" == "First Aid"). */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const clash = await this.prisma.skill.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException('A skill with this name already exists');
  }

  private translateUniqueViolation(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('A skill with this name already exists');
    }
    return error;
  }
}
