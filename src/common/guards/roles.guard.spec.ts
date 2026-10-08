import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function context(user?: { role: Role }): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new RolesGuard(reflector as unknown as Reflector);

  it('allows any authenticated user when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(context({ role: Role.VOLUNTEER }))).toBe(true);
  });

  it('allows a user whose role is in the required list', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ORGANIZATION, Role.ADMIN]);
    expect(guard.canActivate(context({ role: Role.ADMIN }))).toBe(true);
  });

  it('rejects other roles with 403', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
    expect(() => guard.canActivate(context({ role: Role.VOLUNTEER }))).toThrow(ForbiddenException);
  });

  it('rejects when there is no user on the request', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
    expect(() => guard.canActivate(context(undefined))).toThrow(ForbiddenException);
  });
});
