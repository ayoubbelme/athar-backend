import {
  ConflictException,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus, Role } from '@prisma/client';
import { UsersService } from '../../users/users.service';
import { RegisterDto } from '../dto/register.dto';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const CLIENT = { ip: '1.2.3.4', userAgent: 'jest' };
const TOKENS = { accessToken: 'a', refreshToken: 'r', accessTokenExpiresAt: 'x' };
const publicUser = {
  id: 'u1',
  email: 'a@b.co',
  role: Role.VOLUNTEER,
  status: AccountStatus.ACTIVE,
};

describe('AuthService', () => {
  let service: AuthService;
  const users = {
    create: jest.fn(),
    findByEmailWithPassword: jest.fn(),
    findPublicById: jest.fn(),
  };
  const passwords = { hash: jest.fn(), verify: jest.fn(), verifyDummy: jest.fn() };
  const tokens = {
    issueSession: jest.fn(),
    refresh: jest.fn(),
    revokeSession: jest.fn(),
    revokeAllSessions: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    tokens.issueSession.mockResolvedValue(TOKENS);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: PasswordService, useValue: passwords },
        { provide: TokenService, useValue: tokens },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('register', () => {
    const dto: RegisterDto = {
      name: 'Amina',
      email: 'a@b.co',
      password: 'Str0ngPassw0rd',
      role: Role.ORGANIZATION,
      organizationName: 'Green Hands',
    };

    it('stores only the password hash and signs the user in', async () => {
      passwords.hash.mockResolvedValue('HASH');
      users.create.mockResolvedValue(publicUser);

      const result = await service.register(dto, CLIENT);

      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ passwordHash: 'HASH', organizationName: 'Green Hands' }),
      );
      expect(JSON.stringify(users.create.mock.calls[0][0])).not.toContain('Str0ngPassw0rd');
      expect(tokens.issueSession).toHaveBeenCalledWith('u1', CLIENT);
      expect(result).toEqual({ user: publicUser, tokens: TOKENS });
    });

    it('propagates duplicate-email conflicts', async () => {
      passwords.hash.mockResolvedValue('HASH');
      users.create.mockRejectedValue(new ConflictException('Email is already registered'));
      await expect(service.register(dto, CLIENT)).rejects.toThrow(ConflictException);
      expect(tokens.issueSession).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const account = { ...publicUser, passwordHash: 'HASH' };

    it('succeeds with valid credentials', async () => {
      users.findByEmailWithPassword.mockResolvedValue(account);
      passwords.verify.mockResolvedValue(true);
      users.findPublicById.mockResolvedValue(publicUser);

      await expect(service.login({ email: 'a@b.co', password: 'pw' }, CLIENT)).resolves.toEqual({
        user: publicUser,
        tokens: TOKENS,
      });
    });

    it('gives the same error for a wrong password and an unknown email', async () => {
      users.findByEmailWithPassword.mockResolvedValueOnce(account);
      passwords.verify.mockResolvedValue(false);
      const wrongPassword = await service
        .login({ email: 'a@b.co', password: 'x' }, CLIENT)
        .catch((e) => e);

      users.findByEmailWithPassword.mockResolvedValueOnce(null);
      const unknownEmail = await service
        .login({ email: 'no@b.co', password: 'x' }, CLIENT)
        .catch((e) => e);

      expect(wrongPassword).toBeInstanceOf(UnauthorizedException);
      expect(unknownEmail).toBeInstanceOf(UnauthorizedException);
      expect(wrongPassword.message).toBe(unknownEmail.message);
      expect(passwords.verifyDummy).toHaveBeenCalledTimes(1); // timing equalizer
      expect(tokens.issueSession).not.toHaveBeenCalled();
    });

    it('blocks suspended accounts only after the password is proven', async () => {
      const suspended = { ...account, status: AccountStatus.SUSPENDED };
      users.findByEmailWithPassword.mockResolvedValue(suspended);

      passwords.verify.mockResolvedValueOnce(true);
      await expect(service.login({ email: 'a@b.co', password: 'ok' }, CLIENT)).rejects.toThrow(
        ForbiddenException,
      );

      passwords.verify.mockResolvedValueOnce(false);
      await expect(service.login({ email: 'a@b.co', password: 'bad' }, CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  it('delegates refresh, logout and logout-all to the token service', async () => {
    tokens.refresh.mockResolvedValue(TOKENS);
    await expect(service.refresh('r', CLIENT)).resolves.toBe(TOKENS);
    await service.logout('r');
    await service.logoutAll('u1');
    expect(tokens.revokeSession).toHaveBeenCalledWith('r');
    expect(tokens.revokeAllSessions).toHaveBeenCalledWith('u1');
  });

  it('me() returns the user or 401 when the account no longer exists', async () => {
    users.findPublicById.mockResolvedValueOnce(publicUser);
    await expect(service.me('u1')).resolves.toBe(publicUser);
    users.findPublicById.mockResolvedValueOnce(null);
    await expect(service.me('gone')).rejects.toThrow(UnauthorizedException);
  });
});
