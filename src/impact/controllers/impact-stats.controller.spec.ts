import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { OrganizationsService } from '../../organizations/services/organizations.service';
import { ImpactStatsService } from '../services/impact-stats.service';
import { ImpactStatsController } from './impact-stats.controller';

const org: AuthenticatedUser = { id: 'u-org', email: 'o@x.co', role: Role.ORGANIZATION };
const admin: AuthenticatedUser = { id: 'u-admin', email: 'a@x.co', role: Role.ADMIN };

describe('ImpactStatsController (who may see whose statistics)', () => {
  let controller: ImpactStatsController;
  const stats = { forOrganization: jest.fn(), forPlatform: jest.fn() };
  const organizations = { findIdByUserId: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    stats.forOrganization.mockResolvedValue({ ok: true });
    organizations.findIdByUserId.mockResolvedValue('org-1');
    const moduleRef = await Test.createTestingModule({
      controllers: [ImpactStatsController],
      providers: [
        { provide: ImpactStatsService, useValue: stats },
        { provide: OrganizationsService, useValue: organizations },
      ],
    }).compile();
    controller = moduleRef.get(ImpactStatsController);
  });

  it('an organization always gets its own statistics', async () => {
    await controller.organization(org, {});
    expect(stats.forOrganization).toHaveBeenCalledWith('org-1');
  });

  it('an organization may repeat its own id but never ask for another one', async () => {
    await controller.organization(org, { organizationId: 'org-1' });
    expect(stats.forOrganization).toHaveBeenCalledWith('org-1');

    stats.forOrganization.mockClear();
    await expect(controller.organization(org, { organizationId: 'org-2' })).rejects.toThrow(
      ForbiddenException,
    );
    expect(stats.forOrganization).not.toHaveBeenCalled();
  });

  it('an organization user without a profile is forbidden', async () => {
    organizations.findIdByUserId.mockResolvedValue(null);
    await expect(controller.organization(org, {})).rejects.toThrow(ForbiddenException);
  });

  it('an admin must say which organization, and can pick any', async () => {
    await expect(controller.organization(admin, {})).rejects.toThrow(BadRequestException);
    await controller.organization(admin, { organizationId: 'org-9' });
    expect(stats.forOrganization).toHaveBeenCalledWith('org-9');
    expect(organizations.findIdByUserId).not.toHaveBeenCalled();
  });
});
