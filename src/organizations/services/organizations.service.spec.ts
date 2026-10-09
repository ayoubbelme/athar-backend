import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ListOrganizationsQueryDto } from '../dto/organization.dto';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  const prisma = {
    organizationProfile: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    user: { update: jest.fn() },
    $transaction: jest.fn(),
  };
  const org = { id: 'o1', userId: 'u1', name: 'Green Hands' };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    const moduleRef = await Test.createTestingModule({
      providers: [OrganizationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(OrganizationsService);
  });

  it('getMyProfile 404s when missing', async () => {
    prisma.organizationProfile.findUnique.mockResolvedValue(null);
    await expect(service.getMyProfile('u1')).rejects.toThrow(NotFoundException);
  });

  it('findById 404s for unknown organizations', async () => {
    prisma.organizationProfile.findUnique.mockResolvedValue(null);
    await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
  });

  it("updates the caller's profile and mirrors location onto the user", async () => {
    prisma.organizationProfile.findUnique.mockResolvedValue(org);
    prisma.organizationProfile.update.mockResolvedValue(org);
    await service.updateMyProfile('u1', { name: 'New', location: 'Oran' });

    expect(prisma.organizationProfile.update.mock.calls[0][0].where).toEqual({ userId: 'u1' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { location: 'Oran' },
    });
  });

  it('does not touch the user row when location is not part of the update', async () => {
    prisma.organizationProfile.findUnique.mockResolvedValue(org);
    prisma.organizationProfile.update.mockResolvedValue(org);
    await service.updateMyProfile('u1', { website: null });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('lists only ACTIVE organizations with search and location filters', async () => {
    prisma.organizationProfile.findMany.mockResolvedValue([org]);
    prisma.organizationProfile.count.mockResolvedValue(1);
    const query = Object.assign(new ListOrganizationsQueryDto(), {
      search: 'green',
      location: 'alg',
    });

    const result = await service.list(query);

    const where = prisma.organizationProfile.findMany.mock.calls[0][0].where;
    expect(where.user).toEqual({ status: 'ACTIVE' });
    expect(where.OR).toHaveLength(2);
    expect(where.location).toEqual({ contains: 'alg', mode: 'insensitive' });
    expect(result.meta.total).toBe(1);
  });
});
