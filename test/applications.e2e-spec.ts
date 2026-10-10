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
const GHOST_ID = '00000000-0000-4000-8000-000000000000';

interface Account {
  id: string;
  email: string;
  token: string;
}

describe('Applications (e2e)', () => {
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
    return { id: res.body.user.id, email: res.body.user.email, token: res.body.tokens.accessToken };
  }
  const makeVolunteer = (label = 'vol') =>
    signUp({ name: `Vol ${label}`, email: email(label), role: 'VOLUNTEER' });

  const createProject = async (owner: Account, body: Record<string, unknown> = {}) =>
    (
      await as(owner)
        .post('/projects')
        .send({
          title: `AppProject ${RUN}`,
          description: 'A sufficiently long description.',
          status: 'PUBLISHED',
          ...body,
        })
        .expect(201)
    ).body;
  const apply = (v: Account, projectId: string, body: Record<string, unknown> = {}) =>
    as(v).post(`/projects/${projectId}/applications`).send(body);
  const setStatus = (who: Account, applicationId: string, status: string) =>
    as(who).patch(`/applications/${applicationId}/status`).send({ status });

  let admin: Account;
  let orgA: Account;
  let orgB: Account;
  let skillId: string;

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
    skillId = (await prisma.skill.create({ data: { name: `E2E Skill App ${RUN}` } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    await prisma.skill.deleteMany({ where: { name: { startsWith: 'E2E Skill' } } });
    process.env.THROTTLE_AUTH_LIMIT = saved.auth;
    process.env.THROTTLE_LIMIT = saved.limit;
    await app.close();
  });

  // ───────────────────────── Core flow from the specification ─────────────────────────
  describe('end-to-end volunteering flow', () => {
    it('register → login → profile & skills → organization publishes → apply → review → accept', async () => {
      // volunteer registers, logs in, completes the profile and adds a skill
      const volEmail = email('flow');
      await http()
        .post('/auth/register')
        .send({ name: 'Flow Vol', email: volEmail, password: PASSWORD, role: 'VOLUNTEER' })
        .expect(201);
      const login = await http()
        .post('/auth/login')
        .send({ email: volEmail, password: PASSWORD })
        .expect(200);
      const vol: Account = {
        id: login.body.user.id,
        email: volEmail,
        token: login.body.tokens.accessToken,
      };
      await as(vol)
        .patch('/volunteers/me')
        .send({ bio: 'Keen helper', phone: '+213 555 11 22 33', location: 'Algiers' })
        .expect(200);
      await as(vol)
        .post('/volunteers/me/skills')
        .send({ skillId, proficiency: 'ADVANCED' })
        .expect(201);

      // organization creates a project with required skills and publishes it
      const project = await createProject(orgA, {
        title: `Flow project ${RUN}`,
        status: 'DRAFT',
        maxVolunteers: 5,
        skills: [{ skillId, requiredCount: 2, importance: 5 }],
      });
      await as(orgA).patch(`/projects/${project.id}`).send({ status: 'PUBLISHED' }).expect(200);

      // volunteer applies
      const applied = await apply(vol, project.id, { message: 'I can help!' }).expect(201);
      expect(applied.body).toMatchObject({
        status: 'PENDING',
        message: 'I can help!',
        project: { id: project.id },
      });

      // organization reviews: profile + skills visible, contact hidden
      const list = await as(orgA).get(`/projects/${project.id}/applications`).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].volunteer).toMatchObject({
        name: 'Flow Vol',
        bio: 'Keen helper',
        location: 'Algiers',
        skills: [{ id: skillId, proficiency: 'ADVANCED' }],
        contact: null,
      });
      expect(JSON.stringify(list.body)).not.toContain(volEmail);
      expect(JSON.stringify(list.body)).not.toContain('555 11 22 33');

      // organization accepts → contact revealed, project counts the volunteer
      const accepted = await setStatus(orgA, applied.body.id, 'ACCEPTED').expect(200);
      expect(accepted.body.status).toBe('ACCEPTED');
      expect(accepted.body.volunteer.contact).toEqual({
        email: volEmail,
        phone: '+213 555 11 22 33',
      });
      expect(
        (await as(vol).get(`/projects/${project.id}`).expect(200)).body.acceptedVolunteers,
      ).toBe(1);

      const mine = await as(vol).get('/applications/my').expect(200);
      expect(mine.body.data[0]).toMatchObject({ id: applied.body.id, status: 'ACCEPTED' });
    });
  });

  // ───────────────────────── Applying ─────────────────────────
  describe('apply', () => {
    let project: { id: string };
    let vol: Account;

    beforeAll(async () => {
      project = await createProject(orgA, { title: `Apply project ${RUN}` });
      vol = await makeVolunteer('apply');
    });

    it('is restricted to volunteers and requires authentication', async () => {
      await http().post(`/projects/${project.id}/applications`).send({}).expect(401);
      await apply(orgA, project.id).expect(403);
      await apply(admin, project.id).expect(403);
    });

    it('creates a PENDING application, trims the message and does not leak internals', async () => {
      const res = await apply(vol, project.id, { message: '  Count me in  ' }).expect(201);
      expect(res.body).toMatchObject({
        status: 'PENDING',
        message: 'Count me in',
        matchScore: 0, // computed on apply; this project specifies no requirements, so nothing to score
        project: { id: project.id, status: 'PUBLISHED', organization: { name: `Org A ${RUN}` } },
      });
      expect(res.body.volunteerId).toBeUndefined();
    });

    it('prevents duplicate applications (409)', async () => {
      const res = await apply(vol, project.id).expect(409);
      expect(res.body.message).toBe('You have already applied to this project');
    });

    it.each([
      ['message over 1000 characters', { message: 'x'.repeat(1001) }],
      ['unknown field (status)', { status: 'ACCEPTED' }],
      ['unknown field (volunteerId)', { volunteerId: GHOST_ID }],
    ])('rejects %s with 400', async (_l, body) => {
      const fresh = await makeVolunteer('badbody');
      await apply(fresh, project.id, body).expect(400);
    });

    it('validates the project id and hides what a volunteer must not see', async () => {
      const v = await makeVolunteer('hidden');
      await apply(v, 'not-a-uuid').expect(400);
      await apply(v, GHOST_ID).expect(404);

      const draft = await createProject(orgA, { title: `Draft ${RUN}`, status: 'DRAFT' });
      await apply(v, draft.id).expect(404); // not 403: drafts are invisible
    });

    it('only accepts applications while the project is PUBLISHED', async () => {
      const v = await makeVolunteer('closed');
      for (const status of ['IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
        const p = await createProject(orgA, { title: `${status} ${RUN}` });
        const path: Record<string, string[]> = {
          IN_PROGRESS: ['IN_PROGRESS'],
          COMPLETED: ['IN_PROGRESS', 'COMPLETED'],
          CANCELLED: ['CANCELLED'],
        };
        for (const s of path[status])
          await as(orgA).patch(`/projects/${p.id}`).send({ status: s }).expect(200);
        const res = await apply(v, p.id).expect(409);
        expect(res.body.message).toBe('This project is not open for applications');
      }
    });

    it('cannot apply to projects of suspended organizations', async () => {
      const suspendedOrg = await signUp({
        name: 'Suspended Owner',
        email: email('sorg'),
        role: 'ORGANIZATION',
        organizationName: `Org S ${RUN}`,
      });
      const p = await createProject(suspendedOrg, { title: `Suspended ${RUN}` });
      await as(admin)
        .patch(`/users/${suspendedOrg.id}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(200);
      await apply(await makeVolunteer('s'), p.id).expect(404);
    });

    it('lets exactly one of many simultaneous applications through (DB uniqueness under concurrency)', async () => {
      const p = await createProject(orgA, { title: `Race apply ${RUN}` });
      const racer = await makeVolunteer('racer');
      const results = await Promise.all(Array.from({ length: 6 }, () => apply(racer, p.id)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
      expect(await prisma.application.count({ where: { projectId: p.id } })).toBe(1);
    });
  });

  // ───────────────────────── My applications ─────────────────────────
  describe('GET /applications/my', () => {
    let v1: Account;
    let v2: Account;
    const ids: string[] = [];

    beforeAll(async () => {
      v1 = await makeVolunteer('my1');
      v2 = await makeVolunteer('my2');
      for (let i = 0; i < 3; i++) {
        const p = await createProject(orgA, { title: `My list ${i} ${RUN}` });
        ids.push((await apply(v1, p.id).expect(201)).body.id);
      }
      await setStatus(orgA, ids[0], 'ACCEPTED').expect(200);
      await setStatus(orgA, ids[1], 'REJECTED').expect(200);
    });

    it('returns only my applications, newest first, with pagination metadata', async () => {
      const res = await as(v1).get('/applications/my').query({ limit: 2 }).expect(200);
      expect(res.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
      expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([ids[2], ids[1]]);

      const page2 = await as(v1).get('/applications/my').query({ limit: 2, page: 2 }).expect(200);
      expect(page2.body.data.map((a: { id: string }) => a.id)).toEqual([ids[0]]);
    });

    it('filters by status and sorts', async () => {
      const accepted = await as(v1)
        .get('/applications/my')
        .query({ status: 'ACCEPTED' })
        .expect(200);
      expect(accepted.body.data.map((a: { id: string }) => a.id)).toEqual([ids[0]]);
      const asc = await as(v1).get('/applications/my').query({ order: 'asc' }).expect(200);
      expect(asc.body.data[0].id).toBe(ids[0]);
    });

    it("never shows another volunteer's applications", async () => {
      const res = await as(v2).get('/applications/my').expect(200);
      expect(res.body).toMatchObject({ data: [], meta: { total: 0 } });
    });

    it('is volunteers-only and validates its query', async () => {
      await as(orgA).get('/applications/my').expect(403);
      await http().get('/applications/my').expect(401);
      await as(v1).get('/applications/my').query({ limit: 101 }).expect(400);
      await as(v1).get('/applications/my').query({ status: 'DONE' }).expect(400);
      await as(v1).get('/applications/my').query({ sortBy: 'matchScore' }).expect(400);
    });
  });

  // ───────────────────────── Organization review ─────────────────────────
  describe('reviewing applicants', () => {
    let project: { id: string };
    let draft: { id: string };
    let v1: Account;
    let v2: Account;
    let a1: string;
    let a2: string;

    beforeAll(async () => {
      project = await createProject(orgA, { title: `Review ${RUN}` });
      draft = await createProject(orgA, { title: `Review draft ${RUN}`, status: 'DRAFT' });
      v1 = await makeVolunteer('rev1');
      v2 = await makeVolunteer('rev2');
      a1 = (await apply(v1, project.id).expect(201)).body.id;
      a2 = (await apply(v2, project.id).expect(201)).body.id;
    });

    it('lists applicants for the owner (and admins), with filters', async () => {
      const res = await as(orgA).get(`/projects/${project.id}/applications`).expect(200);
      expect(res.body.meta.total).toBe(2);
      expect(
        (await as(admin).get(`/projects/${project.id}/applications`).expect(200)).body.meta.total,
      ).toBe(2);

      await setStatus(orgA, a2, 'REJECTED').expect(200);
      const pending = await as(orgA)
        .get(`/projects/${project.id}/applications`)
        .query({ status: 'PENDING' })
        .expect(200);
      expect(pending.body.data.map((a: { id: string }) => a.id)).toEqual([a1]);
      await as(orgA)
        .get(`/projects/${project.id}/applications`)
        .query({ sortBy: 'matchScore', order: 'asc' })
        .expect(200);
    });

    it('shows admins contact details, but organizations only after acceptance', async () => {
      const adminView = await as(admin)
        .get(`/projects/${project.id}/applications`)
        .query({ status: 'PENDING' })
        .expect(200);
      expect(adminView.body.data[0].volunteer.contact).toMatchObject({ email: v1.email });
      const orgView = await as(orgA)
        .get(`/projects/${project.id}/applications`)
        .query({ status: 'PENDING' })
        .expect(200);
      expect(orgView.body.data[0].volunteer.contact).toBeNull();
    });

    it('blocks everyone else from the applicant list', async () => {
      await http().get(`/projects/${project.id}/applications`).expect(401);
      await as(v1).get(`/projects/${project.id}/applications`).expect(403); // volunteers
      await as(orgB).get(`/projects/${project.id}/applications`).expect(403); // other organization, public project
      await as(orgB).get(`/projects/${draft.id}/applications`).expect(404); // other organization, draft
      await as(orgA).get(`/projects/${GHOST_ID}/applications`).expect(404);
      await as(orgA).get('/projects/not-a-uuid/applications').expect(400);
    });

    it('validates the list query', async () => {
      await as(orgA).get(`/projects/${project.id}/applications`).query({ limit: 101 }).expect(400);
      await as(orgA)
        .get(`/projects/${project.id}/applications`)
        .query({ sortBy: 'email' })
        .expect(400);
      await as(orgA)
        .get(`/projects/${project.id}/applications`)
        .query({ status: 'MAYBE' })
        .expect(400);
    });

    it("treats another organization's application as non-existent when changing status", async () => {
      await setStatus(orgB, a1, 'ACCEPTED').expect(404);
      await setStatus(orgA, GHOST_ID, 'ACCEPTED').expect(404);
      await setStatus(orgA, 'not-a-uuid', 'ACCEPTED').expect(400);
      expect((await prisma.application.findUniqueOrThrow({ where: { id: a1 } })).status).toBe(
        'PENDING',
      );
    });

    it('volunteers cannot change statuses (not even their own application)', async () => {
      await setStatus(v1, a1, 'ACCEPTED').expect(403);
      await http().patch(`/applications/${a1}/status`).send({ status: 'ACCEPTED' }).expect(401);
    });

    it.each(['WITHDRAWN', 'PENDING', 'MAYBE', ''])(
      'only accepts ACCEPTED or REJECTED as input (got %p)',
      async (status) => {
        await setStatus(orgA, a1, status).expect(400);
      },
    );

    it('rejects unknown body fields', async () => {
      await as(orgA)
        .patch(`/applications/${a1}/status`)
        .send({ status: 'ACCEPTED', matchScore: 100 })
        .expect(400);
    });

    it('validates transitions: accept → accept again 409; reject an accepted one is allowed; rejection is final', async () => {
      await setStatus(orgA, a1, 'ACCEPTED').expect(200);
      const again = await setStatus(orgA, a1, 'ACCEPTED').expect(409);
      expect(again.body.message).toBe('Cannot change application status from ACCEPTED to ACCEPTED');

      await setStatus(orgA, a1, 'REJECTED').expect(200); // revoke acceptance
      const final = await setStatus(orgA, a1, 'ACCEPTED').expect(409);
      expect(final.body.message).toBe('Cannot change application status from REJECTED to ACCEPTED');
      await setStatus(orgA, a2, 'ACCEPTED').expect(409); // a2 was rejected earlier
    });

    it('lets ADMIN review any application', async () => {
      const p = await createProject(orgB, { title: `Admin review ${RUN}` });
      const v = await makeVolunteer('adm');
      const a = (await apply(v, p.id).expect(201)).body.id;
      const res = await setStatus(admin, a, 'ACCEPTED').expect(200);
      expect(res.body.status).toBe('ACCEPTED');
    });
  });

  // ───────────────────────── Capacity ─────────────────────────
  describe('capacity (maxVolunteers)', () => {
    it('refuses to accept beyond maxVolunteers, and frees a spot when someone is rejected or withdraws', async () => {
      const p = await createProject(orgA, { title: `Capacity ${RUN}`, maxVolunteers: 2 });
      const vols = await Promise.all([
        makeVolunteer('c1'),
        makeVolunteer('c2'),
        makeVolunteer('c3'),
        makeVolunteer('c4'),
      ]);
      const apps: string[] = [];
      for (const v of vols) apps.push((await apply(v, p.id).expect(201)).body.id); // applying is never blocked

      await setStatus(orgA, apps[0], 'ACCEPTED').expect(200);
      await setStatus(orgA, apps[1], 'ACCEPTED').expect(200);
      const full = await setStatus(orgA, apps[2], 'ACCEPTED').expect(409);
      expect(full.body.message).toBe('The project has reached its maximum number of volunteers');
      await setStatus(orgA, apps[2], 'REJECTED').expect(200); // rejecting is always possible

      await as(vols[0]).delete(`/applications/${apps[0]}`).expect(204); // withdrawing frees a spot
      expect((await as(vols[3]).get(`/projects/${p.id}`).expect(200)).body.acceptedVolunteers).toBe(
        1,
      );
      await setStatus(orgA, apps[3], 'ACCEPTED').expect(200);
      expect((await as(vols[3]).get(`/projects/${p.id}`).expect(200)).body.acceptedVolunteers).toBe(
        2,
      );
    });

    it('never over-accepts when many accept requests race (row lock): 1 spot, 6 applicants → exactly 1 success', async () => {
      const p = await createProject(orgA, { title: `Race accept ${RUN}`, maxVolunteers: 1 });
      const vols = await Promise.all(Array.from({ length: 6 }, (_, i) => makeVolunteer(`ra${i}`)));
      const apps: string[] = [];
      for (const v of vols) apps.push((await apply(v, p.id).expect(201)).body.id);

      const results = await Promise.all(apps.map((id) => setStatus(orgA, id, 'ACCEPTED')));
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([200, 409, 409, 409, 409, 409]);
      expect(
        await prisma.application.count({ where: { projectId: p.id, status: 'ACCEPTED' } }),
      ).toBe(1);
    });
  });

  // ───────────────────────── Withdrawing ─────────────────────────
  describe('withdraw (DELETE /applications/:id)', () => {
    let project: { id: string };
    let v: Account;
    let other: Account;
    let appId: string;

    beforeAll(async () => {
      project = await createProject(orgA, { title: `Withdraw ${RUN}` });
      v = await makeVolunteer('wd');
      other = await makeVolunteer('wd-other');
      appId = (await apply(v, project.id, { message: 'first try' }).expect(201)).body.id;
    });

    it('only the applicant can withdraw; everyone else gets 403/404', async () => {
      await as(other).delete(`/applications/${appId}`).expect(404);
      await as(orgA).delete(`/applications/${appId}`).expect(403);
      await http().delete(`/applications/${appId}`).expect(401);
      await as(v).delete('/applications/not-a-uuid').expect(400);
      await as(v).delete(`/applications/${GHOST_ID}`).expect(404);
      expect((await prisma.application.findUniqueOrThrow({ where: { id: appId } })).status).toBe(
        'PENDING',
      );
    });

    it('withdraws softly (history kept) and is idempotent', async () => {
      await as(v).delete(`/applications/${appId}`).expect(204);
      await as(v).delete(`/applications/${appId}`).expect(204);
      const mine = await as(v).get('/applications/my').expect(200);
      expect(mine.body.data[0]).toMatchObject({ id: appId, status: 'WITHDRAWN' });
    });

    it('a withdrawn application cannot be accepted until the volunteer re-applies', async () => {
      await setStatus(orgA, appId, 'ACCEPTED').expect(409);
    });

    it('allows re-applying: the same application is reactivated as PENDING with the new message', async () => {
      const res = await apply(v, project.id, { message: 'second try' }).expect(201);
      expect(res.body).toMatchObject({ id: appId, status: 'PENDING', message: 'second try' });
      expect(
        await prisma.application.count({ where: { projectId: project.id, volunteerId: v.id } }),
      ).toBe(1);
      await apply(v, project.id).expect(409); // and now it blocks again
    });

    it('cannot withdraw a rejected application (rejection is final) and cannot re-apply after it', async () => {
      await setStatus(orgA, appId, 'REJECTED').expect(200);
      const res = await as(v).delete(`/applications/${appId}`).expect(409);
      expect(res.body.message).toBe('Cannot withdraw an application that is REJECTED');
      await apply(v, project.id).expect(409);
    });
  });

  // ───────────────────────── Project lifecycle interaction ─────────────────────────
  describe('project lifecycle interaction', () => {
    it('allows review while IN_PROGRESS but freezes everything once the project is COMPLETED', async () => {
      const p = await createProject(orgA, { title: `Lifecycle ${RUN}` });
      const [v1, v2, v3] = await Promise.all([
        makeVolunteer('l1'),
        makeVolunteer('l2'),
        makeVolunteer('l3'),
      ]);
      const a1 = (await apply(v1, p.id).expect(201)).body.id;
      const a2 = (await apply(v2, p.id).expect(201)).body.id;
      const a3 = (await apply(v3, p.id).expect(201)).body.id;

      await as(orgA).patch(`/projects/${p.id}`).send({ status: 'IN_PROGRESS' }).expect(200);
      await apply(await makeVolunteer('late'), p.id).expect(409); // no new applicants
      await setStatus(orgA, a1, 'ACCEPTED').expect(200); // but review continues
      await as(v3).delete(`/applications/${a3}`).expect(204); // and withdrawing works

      await as(orgA).patch(`/projects/${p.id}`).send({ status: 'COMPLETED' }).expect(200);
      const review = await setStatus(orgA, a2, 'ACCEPTED').expect(409);
      expect(review.body.message).toMatch(/project is closed/);
      await as(v1).delete(`/applications/${a1}`).expect(409);
      // history is still readable
      expect(
        (await as(orgA).get(`/projects/${p.id}/applications`).expect(200)).body.meta.total,
      ).toBe(3);
    });

    it('a cancelled project keeps its applications readable but frozen', async () => {
      const p = await createProject(orgA, { title: `Cancelled ${RUN}` });
      const v = await makeVolunteer('cx');
      const a = (await apply(v, p.id).expect(201)).body.id;
      await as(orgA).patch(`/projects/${p.id}`).send({ status: 'CANCELLED' }).expect(200);
      await setStatus(orgA, a, 'ACCEPTED').expect(409);
      expect((await as(v).get('/applications/my').expect(200)).body.data[0].project.status).toBe(
        'CANCELLED',
      );
    });

    it('deleting a draft or removing a project as admin cascades to its applications', async () => {
      const p = await createProject(orgA, { title: `Cascade ${RUN}` });
      const v = await makeVolunteer('casc');
      await apply(v, p.id).expect(201);
      await as(admin).delete(`/projects/${p.id}`).expect(204);
      expect(await prisma.application.count({ where: { projectId: p.id } })).toBe(0);
      expect((await as(v).get('/applications/my').expect(200)).body.meta.total).toBe(0);
    });
  });
});
