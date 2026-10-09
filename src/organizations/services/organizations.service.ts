import { Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationProfile, Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-response.dto';
import { buildPaginatedResult, toPrismaPagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ListOrganizationsQueryDto, UpdateOrganizationProfileDto } from '../dto/organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyProfile(userId: string): Promise<OrganizationProfile> {
    const profile = await this.prisma.organizationProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Organization profile not found');
    return profile;
  }

  /** Location is mirrored onto the user row in the same transaction (see VolunteersService). */
  async updateMyProfile(
    userId: string,
    dto: UpdateOrganizationProfileDto,
  ): Promise<OrganizationProfile> {
    await this.getMyProfile(userId);

    const [profile] = await this.prisma.$transaction([
      this.prisma.organizationProfile.update({ where: { userId }, data: dto }),
      ...(dto.location !== undefined
        ? [this.prisma.user.update({ where: { id: userId }, data: { location: dto.location } })]
        : []),
    ]);
    return profile;
  }

  /** Organization profiles are public to any authenticated user (volunteers browse them). */
  async findById(id: string): Promise<OrganizationProfile> {
    const profile = await this.prisma.organizationProfile.findUnique({
      where: { id },
    });
    if (!profile) throw new NotFoundException('Organization not found');
    return profile;
  }

  async list(query: ListOrganizationsQueryDto): Promise<PaginatedResult<OrganizationProfile>> {
    const where: Prisma.OrganizationProfileWhereInput = {
      user: { status: 'ACTIVE' }, // suspended organizations disappear from the directory
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.location ? { location: { contains: query.location, mode: 'insensitive' } } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.organizationProfile.findMany({
        where,
        orderBy: { name: 'asc' },
        ...toPrismaPagination(query),
      }),
      this.prisma.organizationProfile.count({ where }),
    ]);
    return buildPaginatedResult(data, total, query);
  }
}
