import { ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { REFRESH_REUSE_GRACE_MS } from '../auth.constants';
import { TokenService } from './token.service';

interface Row {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent?: string;
  ip?: string;
}
type Where = Partial<Pick<Row, 'id' | 'userId' | 'familyId'>> & {
  revokedAt?: null;
  expiresAt?: { lt: Date };
};

/** In-memory stand-in for the refresh_tokens table so rotation logic is really exercised. */
function fakePrisma() {
  const rows: Row[] = [];
  const matches = (r: Row, w: Where): boolean =>
    (w.id === undefined || r.id === w.id) &&
    (w.userId === undefined || r.userId === w.userId) &&
    (w.familyId === undefined || r.familyId === w.familyId) &&
    (w.revokedAt === undefined || r.revokedAt === null) &&
    (w.expiresAt === undefined || r.expiresAt < w.expiresAt.lt);

  const refreshToken = {
    create: jest.fn(({ data }: { data: Omit<Row, 'revokedAt'> }) => {
      rows.push({ ...data, revokedAt: null });
      return Promise.resolve(data);
    }),
    findUnique: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
    ),
    updateMany: jest.fn(({ where, data }: { where: Where; data: Partial<Row> }) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return Promise.resolve({ count: hit.length });
    }),
    deleteMany: jest.fn(({ where }: { where: Where }) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return Promise.resolve({ count: hit.length });
    }),
  };
  const prisma = {
    refreshToken,
    $transaction: <T>(cb: (tx: { refreshToken: typeof refreshToken }) => Promise<T>) =>
      cb({ refreshToken }),
  };
  return { rows, prisma };
}

const CONFIG: Record<string, string> = {
  'jwt.accessSecret': 'a'.repeat(40),
  'jwt.refreshSecret': 'b'.repeat(40),
  'jwt.accessExpiresIn': '15m',
  'jwt.refreshExpiresIn': '7d',
};
const CLIENT = { ip: '127.0.0.1', userAgent: 'jest' };

describe('TokenService', () => {
  let service: TokenService;
  let jwt: JwtService;
  let rows: Row[];
  const users = { findPublicById: jest.fn() };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const fake = fakePrisma();
    rows = fake.rows;
    users.findPublicById.mockResolvedValue({ id: 'u1', status: AccountStatus.ACTIVE });

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        TokenService,
        { provide: ConfigService, useValue: { get: (k: string) => CONFIG[k] } },
        { provide: PrismaService, useValue: fake.prisma },
        { provide: UsersService, useValue: users },
      ],
    }).compile();
    service = moduleRef.get(TokenService);
    jwt = moduleRef.get(JwtService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('issueSession', () => {
    it('returns a verifiable access token and stores only a hash of the refresh token', async () => {
      const tokens = await service.issueSession('u1', CLIENT);

      const payload = await jwt.verifyAsync<{ sub: string }>(tokens.accessToken, {
        secret: CONFIG['jwt.accessSecret'],
      });
      expect(payload.sub).toBe('u1');
      expect(new Date(tokens.accessTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());

      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(rows)).not.toContain(tokens.refreshToken);
      expect(rows[0]).toMatchObject({ userId: 'u1', ip: '127.0.0.1', userAgent: 'jest' });
    });

    it('creates an independent session per login (multi-device)', async () => {
      await service.issueSession('u1', CLIENT);
      await service.issueSession('u1', CLIENT);
      expect(rows).toHaveLength(2);
      expect(rows[0].familyId).not.toBe(rows[1].familyId);
    });

    it("purges the user's expired sessions", async () => {
      rows.push({
        id: 'old',
        userId: 'u1',
        familyId: 'f',
        tokenHash: 'x',
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
      });
      await service.issueSession('u1', CLIENT);
      expect(rows.find((r) => r.id === 'old')).toBeUndefined();
    });
  });

  describe('refresh', () => {
    it('rotates: revokes the old token and issues a new one in the same family', async () => {
      const first = await service.issueSession('u1', CLIENT);
      const second = await service.refresh(first.refreshToken, CLIENT);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(rows).toHaveLength(2);
      expect(rows[0].revokedAt).not.toBeNull();
      expect(rows[1].revokedAt).toBeNull();
      expect(rows[1].familyId).toBe(rows[0].familyId);

      // the new token keeps working
      await expect(service.refresh(second.refreshToken, CLIENT)).resolves.toBeDefined();
    });

    it('revokes the whole session when an old token is replayed after the grace window', async () => {
      const first = await service.issueSession('u1', CLIENT);
      const second = await service.refresh(first.refreshToken, CLIENT);
      rows[0].revokedAt = new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000);

      await expect(service.refresh(first.refreshToken, CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
      // attacker's replay killed the legitimate newest token too
      await expect(service.refresh(second.refreshToken, CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a replay inside the grace window without killing the session', async () => {
      const first = await service.issueSession('u1', CLIENT);
      const second = await service.refresh(first.refreshToken, CLIENT);

      await expect(service.refresh(first.refreshToken, CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refresh(second.refreshToken, CLIENT)).resolves.toBeDefined();
    });

    it('does not let one device session affect another', async () => {
      const phone = await service.issueSession('u1', CLIENT);
      const tablet = await service.issueSession('u1', CLIENT);
      await service.revokeSession(phone.refreshToken);

      await expect(service.refresh(phone.refreshToken, CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refresh(tablet.refreshToken, CLIENT)).resolves.toBeDefined();
    });

    it('rejects garbage, wrong-secret and unknown tokens', async () => {
      await expect(service.refresh('garbage', CLIENT)).rejects.toThrow(UnauthorizedException);

      const wrongSecret = await jwt.signAsync(
        { sub: 'u1', sid: 's', fam: 'f' },
        { secret: 'c'.repeat(40), expiresIn: '1d' },
      );
      await expect(service.refresh(wrongSecret, CLIENT)).rejects.toThrow(UnauthorizedException);

      const unknownSession = await jwt.signAsync(
        { sub: 'u1', sid: 'nope', fam: 'f' },
        { secret: CONFIG['jwt.refreshSecret'], expiresIn: '1d' },
      );
      await expect(service.refresh(unknownSession, CLIENT)).rejects.toThrow(UnauthorizedException);
    });

    it('does not accept an access token as a refresh token', async () => {
      const { accessToken } = await service.issueSession('u1', CLIENT);
      await expect(service.refresh(accessToken, CLIENT)).rejects.toThrow(UnauthorizedException);
    });

    it('blocks and revokes the session of a suspended user', async () => {
      const tokens = await service.issueSession('u1', CLIENT);
      users.findPublicById.mockResolvedValue({ id: 'u1', status: AccountStatus.SUSPENDED });

      await expect(service.refresh(tokens.refreshToken, CLIENT)).rejects.toThrow(
        ForbiddenException,
      );
      expect(rows[0].revokedAt).not.toBeNull();
    });
  });

  describe('revokeSession / revokeAllSessions', () => {
    it('never throws for invalid tokens (idempotent logout)', async () => {
      await expect(service.revokeSession('garbage')).resolves.toBeUndefined();
    });

    it('revokes every session of a user', async () => {
      await service.issueSession('u1', CLIENT);
      await service.issueSession('u1', CLIENT);
      await service.issueSession('other', CLIENT);
      await service.revokeAllSessions('u1');

      expect(rows.filter((r) => r.userId === 'u1').every((r) => r.revokedAt !== null)).toBe(true);
      expect(rows.find((r) => r.userId === 'other')?.revokedAt).toBeNull();
    });
  });
});
