import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersAdminService } from './users-admin.service';

describe('UsersAdminService', () => {
  let service: UsersAdminService;
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    prisma.user.findUnique.mockResolvedValue({ id: 'target' });
    prisma.user.update.mockResolvedValue({ id: 'target', status: 'SUSPENDED' });
    const moduleRef = await Test.createTestingModule({
      providers: [UsersAdminService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(UsersAdminService);
  });

  it('forbids changing your own status', async () => {
    await expect(service.updateStatus('me', 'me', AccountStatus.SUSPENDED)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('404s for unknown users', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.updateStatus('admin', 'nope', AccountStatus.SUSPENDED)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('revokes all sessions when suspending', async () => {
    await service.updateStatus('admin', 'target', AccountStatus.SUSPENDED);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'target', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('does not touch sessions when reactivating', async () => {
    await service.updateStatus('admin', 'target', AccountStatus.ACTIVE);
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('never selects the password hash', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);
    await service.list(Object.assign(Object.create({}), { page: 1, limit: 20 }));
    const select = prisma.user.findMany.mock.calls[0][0].select;
    expect(select.passwordHash).toBeUndefined();
    expect(select.email).toBe(true);
  });
});
