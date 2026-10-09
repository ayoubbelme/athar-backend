import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountStatus, Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-response.dto';
import { buildPaginatedResult, toPrismaPagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ListUsersQueryDto } from '../dto/users.dto';
import { PUBLIC_USER_SELECT, PublicUser } from '../users.service';

/** Platform administration of accounts. Controllers restrict every method to ADMIN. */
@Injectable()
export class UsersAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListUsersQueryDto): Promise<PaginatedResult<PublicUser>> {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: PUBLIC_USER_SELECT,
        orderBy: { createdAt: 'desc' },
        ...toPrismaPagination(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return buildPaginatedResult(data, total, query);
  }

  async findOne(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: PUBLIC_USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Suspending also revokes every device session so refresh tokens stop working at once. */
  async updateStatus(
    actorId: string,
    targetId: string,
    status: AccountStatus,
  ): Promise<PublicUser> {
    if (actorId === targetId) {
      throw new ForbiddenException('You cannot change your own account status');
    }
    await this.findOne(targetId);

    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetId },
        data: { status },
        select: PUBLIC_USER_SELECT,
      }),
      ...(status === AccountStatus.SUSPENDED
        ? [
            this.prisma.refreshToken.updateMany({
              where: { userId: targetId, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
    ]);
    return user;
  }
}
