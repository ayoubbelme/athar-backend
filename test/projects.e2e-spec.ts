import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApplicationStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

const EMAIL_DOMAIN = '@e2e.athar.test';
const RUN = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Str0ngPassw0rd';
const email = (p: string): string =>
  `${p}-${RUN}-${Math.random().toString(36).slice(2, 6)}${EMAIL_DOMAIN}`;
const GHOST_ID = '00000000-0000-4000-8000-000000000000';

interface Account {
  id: string;
  token: string;
  orgId?: string;
}

describe('Projects (e2e)', () => {
  const saved = { auth: process.env.THROTTLE_AUTH_LIMIT, limit: process.env.THROTTLE_LIMIT };
  let app: INestApplication;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer());
  const as = (a: Account) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${a.token}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${a.token}`),
    patch: (url: string) => http().patch(url).set('Authorization', `Bearer ${a.token}`),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${a.token}`),
    delete: (url: string) => http().delete(url).set('Authorization', `Bearer ${a.token}`),
  });

  async function signUp(body: Record<string, unknown>): Promise<Account> {
    const res = await http()
      .post('/auth/register')
      .send({ password: PASSWORD, ...body })
      .expect(201);
    return { id: res.body.user.id, token: res.body.tokens.accessToken };
  }

  let admin: Account;
  let volunteer: Account;
  let orgA: Account;
  let orgB: Account;
  let skillA: string;
  let skillB: string;

  const baseProject = (over: Record<string, unknown> = {}) => ({
    title: `Project ${RUN} base`,
    description: 'A sufficiently long project description.',
    ...over,
  });
  const createProject = async (a: Account, body: Record<string, unknown>) =>
    (await as(a).post('/projects').send(baseProject(body)).expect(201)).body;

  beforeAll(async () => {
    process.env.THROTTLE_AUTH_LIMIT = '1000';
    process.env.THROTTLE_LIMIT = '10000';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    admin = await signUp({ name: 'Admin', email: email('admin'), role: 'VOLUNTEER' });
    await prisma.user.update({ where: { id: admin.id }, data: { role: Role.ADMIN } });
    volunteer = await signUp({ name: 'Volunteer', email: email('vol'), role: 'VOLUNTEER' });
    orgA = await signUp({
      name: 'Owner A',
      email: email('orga'),
      role: 'ORGANIZATION',
      organizationName: `Org A ${RUN}`,
    });
    orgB = await signUp({
      name: 'Owner B',
      email: email('orgb'),
      role: 'ORGANIZATION',
      organizationName: `Org B ${RUN}`,
    });
    orgA.orgId = (await as(orgA).get('/organizations/me').expect(200)).body.id;
    orgB.orgId = (await as(orgB).get('/organizations/me').expect(200)).body.id;

    skillA = (await prisma.skill.create({ data: { name: `E2E Skill A ${RUN}` } })).id;
    skillB = (await prisma.skill.create({ data: { name: `E2E Skill B ${RUN}` } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } }); // cascades projects
    await prisma.skill.deleteMany({ where: { name: { startsWith: 'E2E Skill' } } });
    process.env.THROTTLE_AUTH_LIMIT = saved.auth;
    process.env.THROTTLE_LIMIT = saved.limit;
    await app.close();
  });

  // ───────────────────────── Create ─────────────────────────
  describe('create', () => {
    it('lets an organization create a DRAFT owned by its own profile, with required skills', async () => {
      const res = await as(orgA)
        .post('/projects')
        .send(
          baseProject({
            title: `  Project ${RUN} create  `,
            location: 'Algiers',
            startDate: '2026-11-14T09:00:00Z',
            endDate: '2026-11-14T17:00:00Z',
            maxVolunteers: 10,
            skills: [{ skillId: skillB, requiredCount: 2, importance: 5 }, { skillId: skillA }],
          }),
        )
        .expect(201);

      expect(res.body).toMatchObject({
        title: `Project ${RUN} create`,
        status: 'DRAFT',
        organizationId: orgA.orgId,
        acceptedVolunteers: 0,
        organization: { id: orgA.orgId, name: `Org A ${RUN}` },
      });
      expect(res.body.skills).toEqual([
        { skill: { id: skillA, name: `E2E Skill A ${RUN}` }, requiredCount: 1, importance: 3 }, // defaults
        { skill: { id: skillB, name: `E2E Skill B ${RUN}` }, requiredCount: 2, importance: 5 },
      ]);
    });

    it('stores a category and the availability a project needs (used by matching)', async () => {
      const res = await as(orgA)
        .post('/projects')
        .send(baseProject({ category: 'HEALTH', availability: ['WEEKENDS', 'EVENINGS'] }))
        .expect(201);
      expect(res.body).toMatchObject({
        category: 'HEALTH',
        availability: ['WEEKENDS', 'EVENINGS'],
      });

      const defaults = await as(orgA).post('/projects').send(baseProject()).expect(201);
      expect(defaults.body).toMatchObject({ category: null, availability: [] });

      const patched = await as(orgA)
        .patch(`/projects/${res.body.id}`)
        .send({ category: 'EDUCATION', availability: ['FLEXIBLE'] })
        .expect(200);
      expect(patched.body).toMatchObject({ category: 'EDUCATION', availability: ['FLEXIBLE'] });

      const cleared = await as(orgA)
        .patch(`/projects/${res.body.id}`)
        .send({ category: null, availability: [] })
        .expect(200);
      expect(cleared.body).toMatchObject({ category: null, availability: [] });
    });

    it.each([
      ['unknown category', { category: 'GAMING' }],
      ['unknown availability value', { availability: ['NIGHTS'] }],
      ['duplicate availability values', { availability: ['WEEKENDS', 'WEEKENDS'] }],
      ['availability as a string', { availability: 'WEEKENDS' }],
    ])('rejects %s on create with 400', async (_l, body) => {
      await as(orgA).post('/projects').send(baseProject(body)).expect(400);
    });

    it('can be created directly as PUBLISHED', async () => {
      const res = await as(orgA)
        .post('/projects')
        .send(baseProject({ status: 'PUBLISHED' }))
        .expect(201);
      expect(res.body.status).toBe('PUBLISHED');
    });

    it('is restricted to organizations', async () => {
      await http().post('/projects').send(baseProject()).expect(401);
      await as(volunteer).post('/projects').send(baseProject()).expect(403);
      await as(admin).post('/projects').send(baseProject()).expect(403);
    });

    it.each([
      ['short title', { title: 'ab' }],
      ['short description', { description: 'short' }],
      ['maxVolunteers 0', { maxVolunteers: 0 }],
      ['non-integer maxVolunteers', { maxVolunteers: 1.5 }],
      ['invalid date', { startDate: 'tomorrow-ish' }],
      ['importance out of range', { skills: [{ skillId: 'REPLACE', importance: 6 }] }],
      ['requiredCount 0', { skills: [{ skillId: 'REPLACE', requiredCount: 0 }] }],
      ['non-UUID skillId', { skills: [{ skillId: 'nope' }] }],
      ['status IN_PROGRESS on create', { status: 'IN_PROGRESS' }],
      ['organizationId in body (ownership spoofing)', { organizationId: GHOST_ID }],
      [
        'more than 30 skills',
        { skills: Array.from({ length: 31 }, () => ({ skillId: GHOST_ID })) },
      ],
    ])('rejects %s with 400', async (_l, body) => {
      const payload = JSON.parse(JSON.stringify(body).replace(/REPLACE/g, skillA));
      await as(orgA).post('/projects').send(baseProject(payload)).expect(400);
    });

    it('rejects duplicate required skills (400), unknown skills (422) and reversed dates (422)', async () => {
      await as(orgA)
        .post('/projects')
        .send(baseProject({ skills: [{ skillId: skillA }, { skillId: skillA }] }))
        .expect(400);
      await as(orgA)
        .post('/projects')
        .send(baseProject({ skills: [{ skillId: GHOST_ID }] }))
        .expect(422);
      const res = await as(orgA)
        .post('/projects')
        .send(baseProject({ startDate: '2026-05-02', endDate: '2026-05-01' }))
        .expect(422);
      expect(res.body.message).toBe('endDate must not be before startDate');
    });
  });

  // ───────────────────────── Visibility, ownership, lifecycle ─────────────────────────
  describe('visibility, ownership and lifecycle', () => {
    let projectId: string;

    beforeAll(async () => {
      projectId = (await createProject(orgA, { title: `Project ${RUN} lifecycle` })).id;
    });

    it('hides drafts from everyone except the owner and admins (404, not 403)', async () => {
      await as(orgA).get(`/projects/${projectId}`).expect(200);
      await as(admin).get(`/projects/${projectId}`).expect(200);
      await as(volunteer).get(`/projects/${projectId}`).expect(404);
      await as(orgB).get(`/projects/${projectId}`).expect(404);

      const list = (r: Account) =>
        as(r)
          .get('/projects')
          .query({ search: `${RUN} lifecycle` })
          .expect(200);
      expect((await list(orgA)).body.data).toHaveLength(1);
      expect((await list(admin)).body.data).toHaveLength(1);
      expect((await list(volunteer)).body.data).toHaveLength(0);
      expect((await list(orgB)).body.data).toHaveLength(0);
    });

    it('does not reveal or let other organizations change a draft', async () => {
      await as(orgB).patch(`/projects/${projectId}`).send({ title: 'Hijacked!' }).expect(404);
      await as(orgB).delete(`/projects/${projectId}`).expect(404);
      await as(orgB).put(`/projects/${projectId}/skills`).send({ skills: [] }).expect(404);
    });

    it('only organizations/admins can modify (volunteers get 403)', async () => {
      await as(volunteer).patch(`/projects/${projectId}`).send({ title: 'Nope nope' }).expect(403);
      await as(volunteer).delete(`/projects/${projectId}`).expect(403);
    });

    it('publishes; then volunteers see it and other organizations are blocked with 403', async () => {
      const res = await as(orgA)
        .patch(`/projects/${projectId}`)
        .send({ status: 'PUBLISHED' })
        .expect(200);
      expect(res.body.status).toBe('PUBLISHED');

      await as(volunteer).get(`/projects/${projectId}`).expect(200);
      await as(orgB).get(`/projects/${projectId}`).expect(200); // public
      const forbidden = await as(orgB)
        .patch(`/projects/${projectId}`)
        .send({ title: 'Hijacked!' })
        .expect(403);
      expect(forbidden.body.message).toBe('You can only manage your own projects');
      await as(orgB).delete(`/projects/${projectId}`).expect(403);
    });

    it('rejects invalid status transitions with 409', async () => {
      await as(orgA).patch(`/projects/${projectId}`).send({ status: 'DRAFT' }).expect(409);
      const res = await as(orgA)
        .patch(`/projects/${projectId}`)
        .send({ status: 'COMPLETED' })
        .expect(409);
      expect(res.body.message).toBe('Cannot change project status from PUBLISHED to COMPLETED');
      await as(orgA).patch(`/projects/${projectId}`).send({ status: 'NOT_A_STATUS' }).expect(400);
    });

    it('updates fields partially; null clears optional fields; dates are validated against stored values', async () => {
      const set = await as(orgA)
        .patch(`/projects/${projectId}`)
        .send({ title: '  Renamed project  ', location: 'Oran', startDate: '2026-06-10T00:00:00Z' })
        .expect(200);
      expect(set.body).toMatchObject({ title: 'Renamed project', location: 'Oran' });

      await as(orgA)
        .patch(`/projects/${projectId}`)
        .send({ endDate: '2026-06-01T00:00:00Z' })
        .expect(422);
      await as(orgA)
        .patch(`/projects/${projectId}`)
        .send({ endDate: '2026-06-20T00:00:00Z' })
        .expect(200);

      const cleared = await as(orgA)
        .patch(`/projects/${projectId}`)
        .send({ location: null, endDate: null })
        .expect(200);
      expect(cleared.body).toMatchObject({ location: null, endDate: null });

      await as(orgA).patch(`/projects/${projectId}`).send({ title: null }).expect(400);
      await as(orgA)
        .patch(`/projects/${projectId}`)
        .send({ organizationId: orgB.orgId })
        .expect(400);
    });

    it('replaces required skills (full set), including clearing them', async () => {
      const set = await as(orgA)
        .put(`/projects/${projectId}/skills`)
        .send({
          skills: [
            { skillId: skillA, importance: 4 },
            { skillId: skillB, requiredCount: 3 },
          ],
        })
        .expect(200);
      expect(set.body.skills).toHaveLength(2);

      const replaced = await as(orgA)
        .put(`/projects/${projectId}/skills`)
        .send({ skills: [{ skillId: skillB }] })
        .expect(200);
      expect(replaced.body.skills).toEqual([
        { skill: expect.objectContaining({ id: skillB }), requiredCount: 1, importance: 3 },
      ]);

      await as(orgA)
        .put(`/projects/${projectId}/skills`)
        .send({ skills: [{ skillId: GHOST_ID }] })
        .expect(422);
      await as(orgA)
        .put(`/projects/${projectId}/skills`)
        .send({ skills: [{ skillId: skillA }, { skillId: skillA }] })
        .expect(400);
      await as(orgA).put(`/projects/${projectId}/skills`).send({}).expect(400);
      // failed attempts must not have changed anything
      expect((await as(orgA).get(`/projects/${projectId}`).expect(200)).body.skills).toHaveLength(
        1,
      );

      const cleared = await as(orgA)
        .put(`/projects/${projectId}/skills`)
        .send({ skills: [] })
        .expect(200);
      expect(cleared.body.skills).toEqual([]);
      await as(orgA)
        .put(`/projects/${projectId}/skills`)
        .send({ skills: [{ skillId: skillA }] })
        .expect(200);
    });

    it('protects maxVolunteers against the number of accepted volunteers', async () => {
      const second = await signUp({ name: 'Second Vol', email: email('vol2'), role: 'VOLUNTEER' });
      await prisma.application.createMany({
        data: [
          { projectId, volunteerId: volunteer.id, status: ApplicationStatus.ACCEPTED },
          { projectId, volunteerId: second.id, status: ApplicationStatus.ACCEPTED },
          {
            projectId,
            volunteerId: (
              await signUp({ name: 'Third Vol', email: email('vol3'), role: 'VOLUNTEER' })
            ).id,
            status: ApplicationStatus.PENDING,
          },
        ],
      });

      await as(orgA).patch(`/projects/${projectId}`).send({ maxVolunteers: 5 }).expect(200);
      const tooLow = await as(orgA)
        .patch(`/projects/${projectId}`)
        .send({ maxVolunteers: 1 })
        .expect(409);
      expect(tooLow.body.message).toBe(
        'maxVolunteers cannot be lower than the 2 volunteer(s) already accepted',
      );
      await as(orgA).patch(`/projects/${projectId}`).send({ maxVolunteers: 2 }).expect(200); // == accepted → ok
      await as(orgA).patch(`/projects/${projectId}`).send({ maxVolunteers: 0 }).expect(400);

      // only ACCEPTED applications count (the PENDING one does not)
      const detail = await as(volunteer).get(`/projects/${projectId}`).expect(200);
      expect(detail.body.acceptedVolunteers).toBe(2);
    });

    it('refuses deletion of a skill that a project requires (cross-module integrity)', async () => {
      const res = await as(admin).delete(`/skills/${skillA}`).expect(409);
      expect(res.body.message).toMatch(/project\(s\)/);
    });

    it('walks PUBLISHED → IN_PROGRESS → COMPLETED, after which the project is read-only', async () => {
      await as(orgA).patch(`/projects/${projectId}`).send({ status: 'IN_PROGRESS' }).expect(200);
      await as(orgA).patch(`/projects/${projectId}`).send({ status: 'COMPLETED' }).expect(200);

      const res = await as(orgA)
        .patch(`/projects/${projectId}`)
        .send({ title: 'Too late' })
        .expect(409);
      expect(res.body.message).toBe('A COMPLETED project can no longer be modified');
      await as(orgA).put(`/projects/${projectId}/skills`).send({ skills: [] }).expect(409);
      await as(orgA).patch(`/projects/${projectId}`).send({ status: 'CANCELLED' }).expect(409);
      await as(orgA).delete(`/projects/${projectId}`).expect(409);
    });

    it('lets admins moderate: edit and delete any project', async () => {
      const pub = await createProject(orgA, {
        title: `Project ${RUN} moderated`,
        status: 'PUBLISHED',
      });
      await as(admin)
        .patch(`/projects/${pub.id}`)
        .send({ title: `Project ${RUN} moderated!` })
        .expect(200);
      await as(admin).delete(`/projects/${pub.id}`).expect(204);
      await as(admin).get(`/projects/${pub.id}`).expect(404);
    });
  });

  // ───────────────────────── Delete ─────────────────────────
  describe('delete', () => {
    it('owners can delete drafts only; published projects must be cancelled instead', async () => {
      const draft = await createProject(orgA, { title: `Project ${RUN} del-draft` });
      await as(orgA).delete(`/projects/${draft.id}`).expect(204);
      await as(orgA).get(`/projects/${draft.id}`).expect(404);
      await as(orgA).delete(`/projects/${draft.id}`).expect(404);

      const pub = await createProject(orgA, {
        title: `Project ${RUN} del-pub`,
        status: 'PUBLISHED',
      });
      const res = await as(orgA).delete(`/projects/${pub.id}`).expect(409);
      expect(res.body.message).toBe(
        'Only draft projects can be deleted. Cancel the project instead.',
      );
      const cancelled = await as(orgA)
        .patch(`/projects/${pub.id}`)
        .send({ status: 'CANCELLED' })
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
    });

    it('validates the id format', async () => {
      await as(orgA).delete('/projects/not-a-uuid').expect(400);
      await as(orgA).get('/projects/not-a-uuid').expect(400);
      await as(orgA).get(`/projects/${GHOST_ID}`).expect(404);
    });
  });

  // ───────────────────────── Listing ─────────────────────────
  describe('listing: search, filters, sorting, pagination', () => {
    const TAG = `LIST${RUN}`;
    const titleOf = (names: Array<{ title: string }>): string[] => names.map((p) => p.title);
    const list = (query: Record<string, unknown>, who: Account = volunteer) =>
      as(who)
        .get('/projects')
        .query({ search: TAG, ...query })
        .expect(200);

    beforeAll(async () => {
      await createProject(orgA, {
        title: `${TAG} Alpha`,
        status: 'PUBLISHED',
        category: 'HEALTH',
        location: 'Algiers',
        startDate: '2026-11-01T00:00:00Z',
        skills: [{ skillId: skillA }],
      });
      await createProject(orgA, {
        title: `${TAG} Bravo`,
        status: 'PUBLISHED',
        location: 'Oran',
        startDate: '2026-12-01T00:00:00Z',
        skills: [{ skillId: skillB }],
      });
      await createProject(orgB, {
        title: `${TAG} Charlie`,
        status: 'PUBLISHED',
        location: 'Algiers',
      }); // no dates, no skills
      await createProject(orgB, {
        title: `${TAG} Delta`,
        status: 'PUBLISHED',
        location: 'Constantine',
        startDate: '2027-01-15T00:00:00Z',
        skills: [{ skillId: skillA }, { skillId: skillB }],
      });
      await createProject(orgA, { title: `${TAG} Echo hidden draft` });
    });

    it('searches title/description case-insensitively and hides drafts from volunteers', async () => {
      const res = await list({ search: TAG.toLowerCase(), limit: 100 });
      expect(res.body.meta.total).toBe(4);
      expect(titleOf(res.body.data).some((t) => t.includes('hidden draft'))).toBe(false);
    });

    it('filters by location, status, skill, organization', async () => {
      expect(
        titleOf((await list({ location: 'algi', sortBy: 'title', order: 'asc' })).body.data),
      ).toEqual([`${TAG} Alpha`, `${TAG} Charlie`]);
      expect((await list({ category: 'HEALTH' })).body.meta.total).toBe(1);
      expect((await list({ category: 'SPORTS' })).body.meta.total).toBe(0);
      expect((await list({ skillId: skillA })).body.meta.total).toBe(2);
      expect((await list({ skillId: skillB })).body.meta.total).toBe(2);
      expect((await list({ organizationId: orgB.orgId })).body.meta.total).toBe(2);
      expect((await list({ status: 'DRAFT' })).body.meta.total).toBe(0); // volunteers can never reach drafts
      expect((await list({ status: 'DRAFT' }, orgA)).body.meta.total).toBe(1); // owner can
      expect(
        (await list({ status: 'PUBLISHED', location: 'oran', skillId: skillB })).body.meta.total,
      ).toBe(1);
    });

    it('filters by start date range', async () => {
      const res = await list({
        startDateFrom: '2026-11-15',
        startDateTo: '2026-12-31',
        limit: 100,
      });
      expect(titleOf(res.body.data)).toEqual([`${TAG} Bravo`]);
      const open = await list({
        startDateFrom: '2026-12-01T00:00:00Z',
        sortBy: 'startDate',
        order: 'asc',
      });
      expect(titleOf(open.body.data)).toEqual([`${TAG} Bravo`, `${TAG} Delta`]);
    });

    it('sorts, with undated projects always last', async () => {
      const asc = await list({ sortBy: 'startDate', order: 'asc' });
      expect(titleOf(asc.body.data)).toEqual([
        `${TAG} Alpha`,
        `${TAG} Bravo`,
        `${TAG} Delta`,
        `${TAG} Charlie`,
      ]);
      const desc = await list({ sortBy: 'startDate', order: 'desc' });
      expect(titleOf(desc.body.data)).toEqual([
        `${TAG} Delta`,
        `${TAG} Bravo`,
        `${TAG} Alpha`,
        `${TAG} Charlie`,
      ]);
      const byTitle = await list({ sortBy: 'title', order: 'desc' });
      expect(titleOf(byTitle.body.data)[0]).toBe(`${TAG} Delta`);
    });

    it('paginates with consistent metadata and no overlap between pages', async () => {
      const p1 = await list({ page: 1, limit: 3, sortBy: 'title', order: 'asc' });
      const p2 = await list({ page: 2, limit: 3, sortBy: 'title', order: 'asc' });
      expect(p1.body.meta).toEqual({ page: 1, limit: 3, total: 4, totalPages: 2 });
      expect(p1.body.data).toHaveLength(3);
      expect(p2.body.data).toHaveLength(1);
      const ids = [...p1.body.data, ...p2.body.data].map((p: { id: string }) => p.id);
      expect(new Set(ids).size).toBe(4);
      expect((await list({ page: 99 })).body.data).toEqual([]);
    });

    it.each([
      ['limit above the maximum', { limit: 101 }],
      ['page 0', { page: 0 }],
      ['unknown sort field', { sortBy: 'passwordHash' }],
      ['bad sort order', { order: 'sideways' }],
      ['non-UUID skillId', { skillId: 'x' }],
      ['non-UUID organizationId', { organizationId: 'x' }],
      ['invalid date', { startDateFrom: 'soon' }],
      ['invalid status', { status: 'ARCHIVED' }],
      ['invalid category', { category: 'GAMING' }],
      ['unknown query parameter', { evil: '1' }],
    ])('rejects %s with 400', async (_l, query) => {
      await as(volunteer).get('/projects').query(query).expect(400);
    });

    it('requires authentication', async () => {
      await http().get('/projects').expect(401);
    });
  });

  // ───────────────────────── Suspended organizations ─────────────────────────
  describe('suspended organizations', () => {
    it('hides their public projects from volunteers (admins still see them) and restores them on reactivation', async () => {
      const suspended = await signUp({
        name: 'Soon Suspended',
        email: email('susp'),
        role: 'ORGANIZATION',
        organizationName: `Org S ${RUN}`,
      });
      const project = await createProject(suspended, {
        title: `Project ${RUN} suspended-org`,
        status: 'PUBLISHED',
      });
      await as(volunteer).get(`/projects/${project.id}`).expect(200);

      await as(admin)
        .patch(`/users/${suspended.id}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(200);
      await as(volunteer).get(`/projects/${project.id}`).expect(404);
      expect(
        (await as(volunteer).get('/projects').query({ search: 'suspended-org' }).expect(200)).body
          .data,
      ).toHaveLength(0);
      await as(admin).get(`/projects/${project.id}`).expect(200);

      await as(admin).patch(`/users/${suspended.id}/status`).send({ status: 'ACTIVE' }).expect(200);
      await as(volunteer).get(`/projects/${project.id}`).expect(200);
    });
  });
});
