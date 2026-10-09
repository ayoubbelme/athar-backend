import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { VolunteersService } from './volunteers.service';

describe('VolunteersService', () => {
  let service: VolunteersService;
  const prisma = {
    volunteerProfile: { findUnique: jest.fn(), update: jest.fn() },
    user: { update: jest.fn() },
    $transaction: jest.fn(),
  };
  const profile = { id: 'p1', userId: 'u1', bio: null };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    prisma.volunteerProfile.findUnique.mockResolvedValue(profile);
    prisma.volunteerProfile.update.mockResolvedValue({ ...profile, bio: 'Hi' });
    const moduleRef = await Test.createTestingModule({
      providers: [VolunteersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(VolunteersService);
  });

  it('404s when the profile is missing', async () => {
    prisma.volunteerProfile.findUnique.mockResolvedValue(null);
    await expect(service.getMyProfile('u1')).rejects.toThrow(NotFoundException);
  });

  it("updates only the caller's profile and does not touch the user row for other fields", async () => {
    await service.updateMyProfile('u1', { bio: 'Hi' });
    expect(prisma.volunteerProfile.update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { bio: 'Hi' },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('mirrors location and availability onto the user in the same transaction', async () => {
    await service.updateMyProfile('u1', { location: 'Algiers', availability: null, bio: 'x' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { location: 'Algiers', availability: null },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
