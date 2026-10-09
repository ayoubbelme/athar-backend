import { Injectable, NotFoundException } from '@nestjs/common';
import { VolunteerProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateVolunteerProfileDto } from '../dto/volunteer.dto';

@Injectable()
export class VolunteersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyProfile(userId: string): Promise<VolunteerProfile> {
    const profile = await this.prisma.volunteerProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Volunteer profile not found');
    return profile;
  }

  /**
   * The profile is the source of truth for location/availability; the same values are
   * mirrored onto the user row (in one transaction) so both stay consistent for matching.
   */
  async updateMyProfile(userId: string, dto: UpdateVolunteerProfileDto): Promise<VolunteerProfile> {
    await this.getMyProfile(userId);

    const mirrored = {
      ...(dto.location !== undefined ? { location: dto.location } : {}),
      ...(dto.availability !== undefined ? { availability: dto.availability } : {}),
    };

    const [profile] = await this.prisma.$transaction([
      this.prisma.volunteerProfile.update({ where: { userId }, data: dto }),
      ...(Object.keys(mirrored).length > 0
        ? [this.prisma.user.update({ where: { id: userId }, data: mirrored })]
        : []),
    ]);
    return profile;
  }
}
