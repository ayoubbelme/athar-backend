import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

const EMAIL_DOMAIN = '@e2e.athar.test';
const RUN = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Str0ngPassw0rd';
const email = (p: string): string =>
  `${p}-${RUN}-${Math.random().toString(36).slice(2, 6)}${EMAIL_DOMAIN}`;

interface Account {
  id: string;
  email: string;
  token: string;
  refreshToken: string;
}

describe('Profiles, skills and user administration (e2e)', () => {
  const saved = { auth: process.env.THROTTLE_AUTH_LIMIT, limit: process.env.THROTTLE_LIMIT };
  let app: INestApplication;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer());
  const as = (a: Account) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${a.token}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${a.token}`),
    patch: (url: string) => http().patch(url).set('Authorization', `Bearer ${a.token}`),
    delete: (url: string) => http().delete(url).set('Authorization', `Bearer ${a.token}`),
  });

  async function signUp(body: Record<string, unknown>): Promise<Account> {
    const res = await http()
      .post('/auth/register')
      .send({ password: PASSWORD, ...body })
      .expect(201);
    return {
      id: res.body.user.id,
      email: res.body.user.email,
      token: res.body.tokens.accessToken,
      refreshToken: res.body.tokens.refreshToken,
    };
  }

  let admin: Account;
  let volunteer: Account;
  let otherVolunteer: Account;
  let org: Account;
  const orgName = `Org ${RUN}`;
  const skillName = `E2E Skill ${RUN}`;
  let skillId: string;

  beforeAll(async () => {
    process.env.THROTTLE_AUTH_LIMIT = '1000';
    process.env.THROTTLE_LIMIT = '10000';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    admin = await signUp({ name: 'Admin E2E', email: email('admin'), role: 'VOLUNTEER' });
    await prisma.user.update({ where: { id: admin.id }, data: { role: Role.ADMIN } });
    volunteer = await signUp({ name: 'Vol One', email: email('vol1'), role: 'VOLUNTEER' });
    otherVolunteer = await signUp({ name: 'Vol Two', email: email('vol2'), role: 'VOLUNTEER' });
    org = await signUp({
      name: 'Org Owner',
      email: email('org'),
      role: 'ORGANIZATION',
      organizationName: orgName,
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    await prisma.skill.deleteMany({ where: { name: { startsWith: 'E2E Skill' } } });
    process.env.THROTTLE_AUTH_LIMIT = saved.auth;
    process.env.THROTTLE_LIMIT = saved.limit;
    await app.close();
  });

  // ───────────────────────── Skills ─────────────────────────
  describe('skills', () => {
    it('only ADMIN can create (401 anonymous, 403 volunteer/org, 201 admin)', async () => {
      await http().post('/skills').send({ name: skillName }).expect(401);
      await as(volunteer).post('/skills').send({ name: skillName }).expect(403);
      await as(org).post('/skills').send({ name: skillName }).expect(403);
      const res = await as(admin)
        .post('/skills')
        .send({ name: `  ${skillName}  `, description: 'Demo' })
        .expect(201);
      expect(res.body).toMatchObject({ name: skillName, description: 'Demo' });
      skillId = res.body.id;
    });

    it('rejects duplicate names ignoring case with 409', async () => {
      const res = await as(admin)
        .post('/skills')
        .send({ name: skillName.toUpperCase() })
        .expect(409);
      expect(res.body.message).toBe('A skill with this name already exists');
    });

    it.each([
      ['too-short name', { name: 'x' }],
      ['missing name', { description: 'only' }],
      ['unknown field', { name: 'E2E Skill zzz', foo: 1 }],
    ])('validates input: %s → 400', async (_l, body) => {
      await as(admin).post('/skills').send(body).expect(400);
    });

    it('lets any authenticated user list, search, sort and paginate', async () => {
      const res = await as(volunteer)
        .get('/skills')
        .query({ search: skillName.toLowerCase(), limit: 5 })
        .expect(200);
      expect(res.body.data.map((s: { id: string }) => s.id)).toContain(skillId);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 5 });
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);

      await as(volunteer).get('/skills').query({ sortBy: 'createdAt', order: 'desc' }).expect(200);
      await http().get('/skills').expect(401);
    });

    it('enforces pagination limits and valid sort fields', async () => {
      await as(volunteer).get('/skills').query({ limit: 101 }).expect(400);
      await as(volunteer).get('/skills').query({ page: 0 }).expect(400);
      await as(volunteer).get('/skills').query({ sortBy: 'passwordHash' }).expect(400);
      await as(volunteer).get('/skills').query({ limit: 100 }).expect(200);
    });

    it('gets one skill; 400 for a bad id, 404 for an unknown id', async () => {
      await as(volunteer).get(`/skills/${skillId}`).expect(200);
      await as(volunteer).get('/skills/not-a-uuid').expect(400);
      await as(volunteer).get('/skills/00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('updates (admin only) and blocks renaming onto an existing skill', async () => {
      await as(volunteer).patch(`/skills/${skillId}`).send({ description: 'x' }).expect(403);
      const res = await as(admin)
        .patch(`/skills/${skillId}`)
        .send({ description: 'Updated' })
        .expect(200);
      expect(res.body.description).toBe('Updated');

      const other = await as(admin)
        .post('/skills')
        .send({ name: `E2E Skill other ${RUN}` })
        .expect(201);
      await as(admin)
        .patch(`/skills/${other.body.id}`)
        .send({ name: skillName.toLowerCase() })
        .expect(409);
      await as(admin).patch(`/skills/${skillId}`).send({ name: null }).expect(400);
    });
  });

  // ───────────────────────── Volunteer profile ─────────────────────────
  describe('volunteer profile', () => {
    it('returns the profile created at registration', async () => {
      const res = await as(volunteer).get('/volunteers/me').expect(200);
      expect(res.body).toMatchObject({ userId: volunteer.id, bio: null });
    });

    it('is restricted to volunteers', async () => {
      await as(org).get('/volunteers/me').expect(403);
      await as(admin).get('/volunteers/me').expect(403);
      await http().get('/volunteers/me').expect(401);
    });

    it('updates partially, can clear with null, and mirrors location/availability to the user', async () => {
      const res = await as(volunteer)
        .patch('/volunteers/me')
        .send({
          bio: '  Loves helping  ',
          phone: '+213 555 12 34 56',
          location: 'Algiers',
          availability: ['WEEKENDS', 'EVENINGS'],
          interests: ['HEALTH', 'EDUCATION'],
        })
        .expect(200);
      expect(res.body).toMatchObject({
        bio: 'Loves helping',
        location: 'Algiers',
        availability: ['WEEKENDS', 'EVENINGS'],
        interests: ['HEALTH', 'EDUCATION'],
      });

      const me = await as(volunteer).get('/auth/me').expect(200);
      expect(me.body).toMatchObject({
        location: 'Algiers',
        availability: ['WEEKENDS', 'EVENINGS'],
      });

      const cleared = await as(volunteer).patch('/volunteers/me').send({ bio: null }).expect(200);
      expect(cleared.body.bio).toBeNull();
      expect(cleared.body.location).toBe('Algiers'); // untouched
      expect(cleared.body.availability).toEqual(['WEEKENDS', 'EVENINGS']); // untouched
    });

    it('replaces the availability / interests sets and clears them with []', async () => {
      const replaced = await as(volunteer)
        .patch('/volunteers/me')
        .send({ availability: ['FLEXIBLE'], interests: ['SPORTS'] })
        .expect(200);
      expect(replaced.body).toMatchObject({ availability: ['FLEXIBLE'], interests: ['SPORTS'] });

      const cleared = await as(volunteer)
        .patch('/volunteers/me')
        .send({ availability: [], interests: [] })
        .expect(200);
      expect(cleared.body).toMatchObject({ availability: [], interests: [] });
      expect((await as(volunteer).get('/auth/me').expect(200)).body.availability).toEqual([]);
    });

    it.each([
      ['invalid phone', { phone: 'abc' }],
      ['too-long bio', { bio: 'x'.repeat(1001) }],
      ['non-whitelisted field (userId)', { userId: '00000000-0000-4000-8000-000000000000' }],
      ['free-text availability (now a fixed set)', { availability: 'Weekends' }],
      ['unknown availability value', { availability: ['NIGHTS'] }],
      ['duplicate availability values', { availability: ['WEEKENDS', 'WEEKENDS'] }],
      ['null availability (use [] to clear)', { availability: null }],
      ['unknown interest', { interests: ['GAMING'] }],
      ['interests that are not an array', { interests: 'HEALTH' }],
    ])('rejects %s with 400', async (_l, body) => {
      await as(volunteer).patch('/volunteers/me').send(body).expect(400);
    });
  });

  // ───────────────────────── Volunteer skills ─────────────────────────
  describe('volunteer skills', () => {
    it('adds a skill with default proficiency BEGINNER', async () => {
      const res = await as(volunteer).post('/volunteers/me/skills').send({ skillId }).expect(201);
      expect(res.body).toMatchObject({
        proficiency: 'BEGINNER',
        skill: { id: skillId, name: skillName },
      });
      expect(res.body.userId).toBeUndefined();
    });

    it('rejects duplicates (409), unknown skills (404) and bad input (400)', async () => {
      await as(volunteer).post('/volunteers/me/skills').send({ skillId }).expect(409);
      await as(volunteer)
        .post('/volunteers/me/skills')
        .send({ skillId: '00000000-0000-4000-8000-000000000000' })
        .expect(404);
      await as(volunteer).post('/volunteers/me/skills').send({ skillId: 'nope' }).expect(400);
      await as(otherVolunteer)
        .post('/volunteers/me/skills')
        .send({ skillId, proficiency: 'GURU' })
        .expect(400);
    });

    it('only volunteers can manage skills', async () => {
      await as(org).post('/volunteers/me/skills').send({ skillId }).expect(403);
      await as(org).get('/volunteers/me/skills').expect(403);
    });

    it('updates proficiency and lists the result', async () => {
      const res = await as(volunteer)
        .patch(`/volunteers/me/skills/${skillId}`)
        .send({ proficiency: 'EXPERT' })
        .expect(200);
      expect(res.body.proficiency).toBe('EXPERT');
      const list = await as(volunteer).get('/volunteers/me/skills').expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({ proficiency: 'EXPERT', skill: { id: skillId } });
    });

    it("isolates volunteers: nobody can see or change another volunteer's skills", async () => {
      const theirs = await as(otherVolunteer).get('/volunteers/me/skills').expect(200);
      expect(theirs.body).toEqual([]);
      await as(otherVolunteer)
        .patch(`/volunteers/me/skills/${skillId}`)
        .send({ proficiency: 'BEGINNER' })
        .expect(404);
      await as(otherVolunteer).delete(`/volunteers/me/skills/${skillId}`).expect(404);
      const mine = await as(volunteer).get('/volunteers/me/skills').expect(200);
      expect(mine.body[0].proficiency).toBe('EXPERT'); // unchanged
    });

    it('refuses to delete a skill that volunteers still use, then allows it once unused', async () => {
      const blocked = await as(admin).delete(`/skills/${skillId}`).expect(409);
      expect(blocked.body.message).toMatch(/in use by 1 volunteer/);
      await as(volunteer).delete(`/volunteers/me/skills/${skillId}`).expect(204);
      await as(volunteer).delete(`/volunteers/me/skills/${skillId}`).expect(404);

      await as(volunteer).delete(`/skills/${skillId}`).expect(403);
      await as(admin).delete(`/skills/${skillId}`).expect(204);
      await as(admin).delete(`/skills/${skillId}`).expect(404);
    });
  });

  // ───────────────────────── Organizations ─────────────────────────
  describe('organizations', () => {
    let orgProfileId: string;

    it('returns the profile created at registration (named by organizationName)', async () => {
      const res = await as(org).get('/organizations/me').expect(200);
      expect(res.body).toMatchObject({ userId: org.id, name: orgName });
      orgProfileId = res.body.id;
    });

    it('is restricted to organizations', async () => {
      await as(volunteer).get('/organizations/me').expect(403);
      await as(volunteer).patch('/organizations/me').send({ name: 'Hacked' }).expect(403);
    });

    it('updates the profile and mirrors location to the user', async () => {
      const res = await as(org)
        .patch('/organizations/me')
        .send({
          description: 'We plant trees',
          website: 'https://example.org',
          contactEmail: 'Contact@Example.org',
          logo: 'https://example.org/logo.png',
          location: 'Oran',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        description: 'We plant trees',
        website: 'https://example.org',
        location: 'Oran',
      });
      const me = await as(org).get('/auth/me').expect(200);
      expect(me.body.location).toBe('Oran');
    });

    it.each([
      ['null name', { name: null }],
      ['empty name', { name: '   ' }],
      ['non-http website', { website: 'javascript:alert(1)' }],
      ['website without protocol', { website: 'example.org' }],
      ['bad contact email', { contactEmail: 'nope' }],
      ['unknown field (userId)', { userId: 'x' }],
    ])('rejects %s with 400', async (_l, body) => {
      await as(org).patch('/organizations/me').send(body).expect(400);
    });

    it('is browsable by any authenticated user (search, location filter, by id)', async () => {
      const found = await as(volunteer)
        .get('/organizations')
        .query({ search: orgName.toLowerCase() })
        .expect(200);
      expect(found.body.data).toHaveLength(1);
      expect(found.body.data[0].id).toBe(orgProfileId);

      const byLocation = await as(volunteer)
        .get('/organizations')
        .query({ search: orgName, location: 'ora' })
        .expect(200);
      expect(byLocation.body.data).toHaveLength(1);
      const none = await as(volunteer)
        .get('/organizations')
        .query({ search: orgName, location: 'paris' })
        .expect(200);
      expect(none.body.data).toHaveLength(0);

      await as(volunteer).get(`/organizations/${orgProfileId}`).expect(200);
      await as(volunteer).get('/organizations/00000000-0000-4000-8000-000000000000').expect(404);
      await as(volunteer).get('/organizations/not-a-uuid').expect(400);
      await http().get('/organizations').expect(401);
    });

    it('hides suspended organizations from the directory', async () => {
      await as(admin).patch(`/users/${org.id}/status`).send({ status: 'SUSPENDED' }).expect(200);
      const res = await as(volunteer).get('/organizations').query({ search: orgName }).expect(200);
      expect(res.body.data).toHaveLength(0);
      await as(admin).patch(`/users/${org.id}/status`).send({ status: 'ACTIVE' }).expect(200);
      const back = await as(volunteer).get('/organizations').query({ search: orgName }).expect(200);
      expect(back.body.data).toHaveLength(1);
    });
  });

  // ───────────────────────── Users ─────────────────────────
  describe('users', () => {
    it('lets any user rename their own account', async () => {
      const res = await as(volunteer).patch('/users/me').send({ name: '  New Name ' }).expect(200);
      expect(res.body.name).toBe('New Name');
      await as(volunteer).patch('/users/me').send({ name: 'x' }).expect(400);
      await as(volunteer).patch('/users/me').send({ name: 'Ok Name', role: 'ADMIN' }).expect(400); // no privilege escalation
    });

    it('restricts the user directory to ADMIN and never leaks credentials', async () => {
      await as(volunteer).get('/users').expect(403);
      await as(org).get(`/users/${volunteer.id}`).expect(403);

      const res = await as(admin)
        .get('/users')
        .query({ search: RUN, role: 'VOLUNTEER', limit: 100 })
        .expect(200);
      expect(res.body.data).toHaveLength(2); // vol1 + vol2 (the admin was filtered out by role)
      expect(res.body.data.every((u: { role: string }) => u.role === 'VOLUNTEER')).toBe(true);
      const admins = await as(admin)
        .get('/users')
        .query({ search: RUN, role: 'ADMIN' })
        .expect(200);
      expect(admins.body.data).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash|refreshToken/);

      await as(admin).get(`/users/${volunteer.id}`).expect(200);
      await as(admin).get('/users/00000000-0000-4000-8000-000000000000').expect(404);
      await as(admin).get('/users').query({ role: 'SUPERUSER' }).expect(400);
    });

    it('suspending a user locks them out immediately and revokes their sessions; reactivation restores access', async () => {
      await as(otherVolunteer).get('/auth/me').expect(200);
      await as(admin)
        .patch(`/users/${otherVolunteer.id}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(200);

      await as(otherVolunteer).get('/auth/me').expect(401);
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: otherVolunteer.refreshToken })
        .expect(401);
      await http()
        .post('/auth/login')
        .send({ email: otherVolunteer.email, password: PASSWORD })
        .expect(403);

      await as(admin)
        .patch(`/users/${otherVolunteer.id}/status`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      const login = await http()
        .post('/auth/login')
        .send({ email: otherVolunteer.email, password: PASSWORD })
        .expect(200);
      expect(login.body.tokens.accessToken).toBeDefined();
    });

    it("prevents admins from changing their own status and non-admins from changing anyone's", async () => {
      await as(admin).patch(`/users/${admin.id}/status`).send({ status: 'SUSPENDED' }).expect(403);
      await as(volunteer)
        .patch(`/users/${org.id}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(403);
      await as(admin)
        .patch(`/users/${volunteer.id}/status`)
        .send({ status: 'DELETED' })
        .expect(400);
    });
  });
});
