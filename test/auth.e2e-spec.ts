import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Roles } from '../src/common/decorators/roles.decorator';
import { PrismaService } from '../src/prisma/prisma.service';

/** Test-only routes proving @Roles + RolesGuard work end to end. */
@Controller('__rbac-probe')
class RbacProbeController {
  @Get('admin')
  @Roles(Role.ADMIN)
  admin(): { ok: true } {
    return { ok: true };
  }

  @Get('org-or-admin')
  @Roles(Role.ORGANIZATION, Role.ADMIN)
  orgOrAdmin(): { ok: true } {
    return { ok: true };
  }

  @Get('any-authenticated')
  anyAuthenticated(): { ok: true } {
    return { ok: true };
  }
}

const EMAIL_DOMAIN = '@e2e.athar.test';
const unique = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${EMAIL_DOMAIN}`;
const PASSWORD = 'Str0ngPassw0rd';

describe('Authentication (e2e)', () => {
  const previousAuthLimit = process.env.THROTTLE_AUTH_LIMIT;
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;

  const server = () => app.getHttpServer();

  const register = (body: Record<string, unknown>) =>
    request(server()).post('/auth/register').send(body);
  const login = (email: string, password = PASSWORD) =>
    request(server()).post('/auth/login').send({ email, password });
  const refresh = (refreshToken: string) =>
    request(server()).post('/auth/refresh').send({ refreshToken });
  const me = (accessToken: string) =>
    request(server()).get('/auth/me').set('Authorization', `Bearer ${accessToken}`);

  beforeAll(async () => {
    process.env.THROTTLE_AUTH_LIMIT = '1000'; // functional tests must not trip brute-force protection
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [RbacProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    http = request(server());
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    process.env.THROTTLE_AUTH_LIMIT = previousAuthLimit;
    await app.close();
  });

  describe('registration', () => {
    it('registers a volunteer, creates an empty profile and signs in', async () => {
      const email = unique('vol');
      const res = await register({
        name: '  Amina  ',
        email: email.toUpperCase(),
        password: PASSWORD,
        role: 'VOLUNTEER',
      }).expect(201);

      expect(res.body.user).toMatchObject({
        name: 'Amina',
        email,
        role: 'VOLUNTEER',
        status: 'ACTIVE',
      });
      expect(res.body.tokens.accessToken).toBeDefined();
      expect(res.body.tokens.refreshToken).toBeDefined();
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|refreshTokenHash/);

      const stored = await prisma.user.findUnique({
        where: { email },
        include: { volunteerProfile: true },
      });
      expect(stored?.volunteerProfile).not.toBeNull();
      expect(stored?.passwordHash).not.toContain(PASSWORD);
      expect(stored?.passwordHash.startsWith('$argon2id$')).toBe(true);
    });

    it('registers an organization with its profile', async () => {
      const email = unique('org');
      await register({
        name: 'Org Admin',
        email,
        password: PASSWORD,
        role: 'ORGANIZATION',
        organizationName: 'Green Hands',
      }).expect(201);
      const stored = await prisma.user.findUnique({
        where: { email },
        include: { organizationProfile: true },
      });
      expect(stored?.organizationProfile?.name).toBe('Green Hands');
    });

    it('rejects duplicate emails (case-insensitive) with 409', async () => {
      const email = unique('dup');
      await register({ name: 'A B', email, password: PASSWORD, role: 'VOLUNTEER' }).expect(201);
      const res = await register({
        name: 'A B',
        email: email.toUpperCase(),
        password: PASSWORD,
        role: 'VOLUNTEER',
      }).expect(409);
      expect(res.body).toMatchObject({ statusCode: 409, message: 'Email is already registered' });
    });

    it.each([
      ['weak password (no digit)', { password: 'onlyletters' }],
      ['short password', { password: 'a1' }],
      ['ADMIN self-registration', { role: 'ADMIN' }],
      ['organization without organizationName', { role: 'ORGANIZATION' }],
      ['unknown extra field (mass assignment)', { status: 'SUSPENDED' }],
    ])('rejects %s with 400', async (_label, override) => {
      const res = await register({
        name: 'A B',
        email: unique('bad'),
        password: PASSWORD,
        role: 'VOLUNTEER',
        ...override,
      }).expect(400);
      expect(res.body.message).toBe('Validation failed');
      expect(res.body.details.length).toBeGreaterThan(0);
    });
  });

  describe('login and /auth/me', () => {
    const email = unique('login');
    let accessToken: string;

    beforeAll(async () => {
      await register({ name: 'Login User', email, password: PASSWORD, role: 'VOLUNTEER' }).expect(
        201,
      );
    });

    it('logs in and returns the current user from /auth/me', async () => {
      const res = await login(email).expect(200);
      accessToken = res.body.tokens.accessToken;
      const profile = await me(accessToken).expect(200);
      expect(profile.body).toMatchObject({ email, role: 'VOLUNTEER' });
      expect(profile.body.passwordHash).toBeUndefined();
    });

    it('returns the same 401 for wrong password and unknown email', async () => {
      const wrong = await login(email, 'WrongPassw0rd').expect(401);
      const unknown = await login(unique('ghost')).expect(401);
      expect(wrong.body.message).toBe('Invalid email or password');
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('requires a valid access token', async () => {
      await http.get('/auth/me').expect(401);
      await me('not.a.jwt').expect(401);
    });

    it('does not accept a refresh token as an access token', async () => {
      const res = await login(email).expect(200);
      await me(res.body.tokens.refreshToken).expect(401);
    });
  });

  describe('multi-device sessions and token rotation', () => {
    const email = unique('devices');
    let phone: { accessToken: string; refreshToken: string };
    let tablet: { accessToken: string; refreshToken: string };

    beforeAll(async () => {
      await register({ name: 'Multi Device', email, password: PASSWORD, role: 'VOLUNTEER' }).expect(
        201,
      );
      phone = (await login(email).set('User-Agent', 'ATHAR-Phone/1.0').expect(200)).body.tokens;
      tablet = (await login(email).set('User-Agent', 'ATHAR-Tablet/1.0').expect(200)).body.tokens;
    });

    it('keeps both devices signed in and records device metadata', async () => {
      await me(phone.accessToken).expect(200);
      await me(tablet.accessToken).expect(200);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const sessions = await prisma.refreshToken.findMany({ where: { userId: user.id } });
      expect(new Set(sessions.map((s) => s.familyId)).size).toBeGreaterThanOrEqual(2);
      expect(sessions.map((s) => s.userAgent)).toEqual(
        expect.arrayContaining(['ATHAR-Phone/1.0', 'ATHAR-Tablet/1.0']),
      );
      expect(JSON.stringify(sessions)).not.toContain(phone.refreshToken);
    });

    it('rotates the refresh token and invalidates the previous one', async () => {
      const res = await refresh(phone.refreshToken).expect(200);
      expect(res.body.refreshToken).not.toBe(phone.refreshToken);
      await me(res.body.accessToken).expect(200);

      await refresh(phone.refreshToken).expect(401); // already used
      const previous = phone;
      phone = res.body;
      expect(previous.refreshToken).not.toBe(phone.refreshToken);
    });

    it('logout on one device leaves the other signed in', async () => {
      await request(server())
        .post('/auth/logout')
        .send({ refreshToken: phone.refreshToken })
        .expect(204);
      await refresh(phone.refreshToken).expect(401);
      await refresh(tablet.refreshToken).expect(200);
    });

    it('logout is idempotent and tolerates garbage tokens', async () => {
      await request(server())
        .post('/auth/logout')
        .send({ refreshToken: phone.refreshToken })
        .expect(204);
      await request(server()).post('/auth/logout').send({ refreshToken: 'garbage' }).expect(204);
    });

    it('logout-all revokes every device', async () => {
      const a = (await login(email).expect(200)).body.tokens;
      const b = (await login(email).expect(200)).body.tokens;
      await request(server())
        .post('/auth/logout-all')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(204);
      await refresh(a.refreshToken).expect(401);
      await refresh(b.refreshToken).expect(401);
    });

    it('rejects a missing refresh token body with 400', async () => {
      await request(server()).post('/auth/refresh').send({}).expect(400);
    });
  });

  describe('suspended accounts', () => {
    it('are locked out immediately, even with a still-valid access token', async () => {
      const email = unique('susp');
      const { body } = await register({
        name: 'To Suspend',
        email,
        password: PASSWORD,
        role: 'VOLUNTEER',
      }).expect(201);
      await me(body.tokens.accessToken).expect(200);

      await prisma.user.update({ where: { email }, data: { status: AccountStatus.SUSPENDED } });

      await me(body.tokens.accessToken).expect(401);
      await refresh(body.tokens.refreshToken).expect(403);
      await login(email).expect(403);
      const wrongPw = await login(email, 'WrongPassw0rd').expect(401); // no status leak without the password
      expect(wrongPw.body.message).toBe('Invalid email or password');
    });
  });

  describe('role-based authorization', () => {
    const tokensByRole: Partial<Record<Role, string>> = {};

    beforeAll(async () => {
      const vol = await register({
        name: 'Vol',
        email: unique('rv'),
        password: PASSWORD,
        role: 'VOLUNTEER',
      }).expect(201);
      const org = await register({
        name: 'Org',
        email: unique('ro'),
        password: PASSWORD,
        role: 'ORGANIZATION',
        organizationName: 'Org X',
      }).expect(201);
      tokensByRole.VOLUNTEER = vol.body.tokens.accessToken;
      tokensByRole.ORGANIZATION = org.body.tokens.accessToken;

      const adminEmail = unique('admin');
      const created = await register({
        name: 'Soon Admin',
        email: adminEmail,
        password: PASSWORD,
        role: 'VOLUNTEER',
      }).expect(201);
      await prisma.user.update({ where: { email: adminEmail }, data: { role: Role.ADMIN } });
      tokensByRole.ADMIN = created.body.tokens.accessToken;
    });

    const get = (path: string, token?: string) => {
      const req = request(server()).get(path);
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    it('returns 401 without a token, 403 with the wrong role, 200 with the right one', async () => {
      await get('/__rbac-probe/admin').expect(401);
      await get('/__rbac-probe/admin', tokensByRole.VOLUNTEER).expect(403);
      await get('/__rbac-probe/admin', tokensByRole.ORGANIZATION).expect(403);
      await get('/__rbac-probe/admin', tokensByRole.ADMIN).expect(200);
    });

    it('supports multiple allowed roles', async () => {
      await get('/__rbac-probe/org-or-admin', tokensByRole.VOLUNTEER).expect(403);
      await get('/__rbac-probe/org-or-admin', tokensByRole.ORGANIZATION).expect(200);
      await get('/__rbac-probe/org-or-admin', tokensByRole.ADMIN).expect(200);
    });

    it('role changes apply immediately (role is read from the database, not the token)', async () => {
      // ADMIN token was issued while the user was a VOLUNTEER; demote and re-check.
      const adminToken = tokensByRole.ADMIN as string;
      const payload = JSON.parse(Buffer.from(adminToken.split('.')[1], 'base64url').toString());
      await prisma.user.update({ where: { id: payload.sub }, data: { role: Role.VOLUNTEER } });
      await get('/__rbac-probe/admin', adminToken).expect(403);
    });

    it('open-to-all-authenticated routes still require login (secure by default)', async () => {
      await get('/__rbac-probe/any-authenticated').expect(401);
      await get('/__rbac-probe/any-authenticated', tokensByRole.VOLUNTEER).expect(200);
    });

    it('keeps /health public', async () => {
      await get('/health').expect(200);
    });
  });
});
