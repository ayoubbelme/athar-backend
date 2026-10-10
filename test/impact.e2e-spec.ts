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
  token: string;
  orgId?: string;
}

describe('Impact (e2e)', () => {
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
    return { id: res.body.user.id, token: res.body.tokens.accessToken };
  }
  const newVolunteer = (label: string) =>
    signUp({ name: `Vol ${label}`, email: email(label), role: 'VOLUNTEER' });
  const newOrg = async (label: string): Promise<Account> => {
    const o = await signUp({
      name: `Owner ${label}`,
      email: email(label),
      role: 'ORGANIZATION',
      organizationName: `Impact Org ${label} ${RUN}`,
    });
    o.orgId = (await as(o).get('/organizations/me').expect(200)).body.id;
    return o;
  };

  const createProject = async (owner: Account, body: Record<string, unknown> = {}) =>
    (
      await as(owner)
        .post('/projects')
        .send({
          title: `Impact project ${RUN}`,
          description: 'A sufficiently long description.',
          status: 'PUBLISHED',
          ...body,
        })
        .expect(201)
    ).body;
  const setProjectStatus = (owner: Account, id: string, status: string) =>
    as(owner).patch(`/projects/${id}`).send({ status }).expect(200);
  const accept = async (owner: Account, projectId: string, volunteer: Account) => {
    const application = await as(volunteer)
      .post(`/projects/${projectId}/applications`)
      .send({})
      .expect(201);
    await as(owner)
      .patch(`/applications/${application.body.id}/status`)
      .send({ status: 'ACCEPTED' })
      .expect(200);
  };

  /** Creates a project, accepts the given volunteers, records impact and moves it to its final status. */
  async function projectWithImpact(
    owner: Account,
    opts: {
      title: string;
      category?: string;
      finalStatus: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
      impact: {
        volunteersCount: number;
        hours: number;
        activitiesCount: number;
        beneficiariesCount: number;
      };
      accepted?: Account[];
    },
  ) {
    const project = await createProject(owner, { title: opts.title, category: opts.category });
    for (const v of opts.accepted ?? []) await accept(owner, project.id, v);
    await setProjectStatus(owner, project.id, 'IN_PROGRESS');
    await as(owner).post(`/projects/${project.id}/impact`).send(opts.impact).expect(201);
    if (opts.finalStatus !== 'IN_PROGRESS')
      await setProjectStatus(owner, project.id, opts.finalStatus);
    return project;
  }

  let admin: Account;

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
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    process.env.THROTTLE_AUTH_LIMIT = saved.auth;
    process.env.THROTTLE_LIMIT = saved.limit;
    await app.close();
  });

  // ───────────────────────── Recording & retrieving ─────────────────────────
  describe('project impact', () => {
    let orgA: Account;
    let orgB: Account;
    let v1: Account;
    let v2: Account;
    let v3: Account;
    let project: { id: string };

    beforeAll(async () => {
      orgA = await newOrg('a');
      orgB = await newOrg('b');
      [v1, v2, v3] = await Promise.all([
        newVolunteer('v1'),
        newVolunteer('v2'),
        newVolunteer('v3'),
      ]);
      project = await createProject(orgA, { title: `Flow ${RUN}`, category: 'HEALTH' });
      await accept(orgA, project.id, v1);
      await accept(orgA, project.id, v2);
      await as(v3).post(`/projects/${project.id}/applications`).send({}).expect(201); // stays PENDING
    });

    it('is gated by project status: only IN_PROGRESS or COMPLETED projects can record impact', async () => {
      const draft = await createProject(orgA, { title: `Draft ${RUN}`, status: 'DRAFT' });
      const published = await createProject(orgA, { title: `Published ${RUN}` });
      const cancelled = await createProject(orgA, { title: `Cancelled ${RUN}` });
      await setProjectStatus(orgA, cancelled.id, 'CANCELLED');

      for (const p of [draft, published, cancelled]) {
        const res = await as(orgA).post(`/projects/${p.id}/impact`).send({ hours: 1 }).expect(409);
        expect(res.body.message).toMatch(/in progress or completed/);
      }
      // the project of the flow is still PUBLISHED here
      await as(orgA).post(`/projects/${project.id}/impact`).send({ hours: 1 }).expect(409);
    });

    it('records impact; volunteersCount defaults to the ACCEPTED applications (2, not the pending 3rd)', async () => {
      await setProjectStatus(orgA, project.id, 'IN_PROGRESS');
      const res = await as(orgA)
        .post(`/projects/${project.id}/impact`)
        .send({
          hours: 12.5,
          activitiesCount: 3,
          beneficiariesCount: 120,
          resources: '  Gloves, bags ',
          description: 'First results',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        projectId: project.id,
        volunteersCount: 2,
        acceptedVolunteers: 2,
        hours: 12.5,
        activitiesCount: 3,
        beneficiariesCount: 120,
        resources: 'Gloves, bags',
        description: 'First results',
      });
      expect(typeof res.body.hours).toBe('number');
      expect(res.body.metrics).toBeUndefined();
    });

    it('allows only one record per project (409), even when requests race', async () => {
      const res = await as(orgA).post(`/projects/${project.id}/impact`).send({}).expect(409);
      expect(res.body.message).toBe(
        'Impact has already been recorded for this project; update it instead',
      );

      const fresh = await createProject(orgA, { title: `Race ${RUN}` });
      await setProjectStatus(orgA, fresh.id, 'IN_PROGRESS');
      const results = await Promise.all(
        Array.from({ length: 5 }, () => as(orgA).post(`/projects/${fresh.id}/impact`).send({})),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
      expect(await prisma.impact.count({ where: { projectId: fresh.id } })).toBe(1);
    });

    it('is readable by anyone who can see the project, with the live accepted count', async () => {
      for (const who of [orgA, orgB, v1, v3, admin]) {
        const res = await as(who).get(`/projects/${project.id}/impact`).expect(200);
        expect(res.body).toMatchObject({ volunteersCount: 2, hours: 12.5 });
      }
      await http().get(`/projects/${project.id}/impact`).expect(401);
    });

    it('shows the reported count next to the live one when they diverge', async () => {
      // v3 applied earlier and was still pending: the organization accepts that application now
      const mine = await as(v3).get('/applications/my').expect(200);
      const pending = mine.body.data.find(
        (a: { project: { id: string } }) => a.project.id === project.id,
      );
      await as(orgA)
        .patch(`/applications/${pending.id}/status`)
        .send({ status: 'ACCEPTED' })
        .expect(200);
      const res = await as(orgA).get(`/projects/${project.id}/impact`).expect(200);
      expect(res.body).toMatchObject({ volunteersCount: 2, acceptedVolunteers: 3 });
    });

    it('can be written only by the owning organization (or an admin)', async () => {
      await as(v1).post(`/projects/${project.id}/impact`).send({}).expect(403);
      await as(v1).patch(`/projects/${project.id}/impact`).send({ hours: 999 }).expect(403);
      await as(orgB).patch(`/projects/${project.id}/impact`).send({ hours: 999 }).expect(403);
      await http().patch(`/projects/${project.id}/impact`).send({ hours: 999 }).expect(401);
      expect((await as(orgA).get(`/projects/${project.id}/impact`).expect(200)).body.hours).toBe(
        12.5,
      );

      const adminEdit = await as(admin)
        .patch(`/projects/${project.id}/impact`)
        .send({ hours: 13 })
        .expect(200);
      expect(adminEdit.body.hours).toBe(13);
    });

    it('updates partially: omitted = unchanged, null clears text, the volunteer count can be overridden', async () => {
      const res = await as(orgA)
        .patch(`/projects/${project.id}/impact`)
        .send({ hours: 40.25, volunteersCount: 5, resources: null })
        .expect(200);
      expect(res.body).toMatchObject({
        hours: 40.25,
        volunteersCount: 5,
        activitiesCount: 3, // unchanged
        beneficiariesCount: 120, // unchanged
        resources: null, // cleared
        description: 'First results', // unchanged
      });
      expect(res.body.acceptedVolunteers).toBe(3); // the live figure is unaffected by the override
    });

    it.each([
      ['negative hours', { hours: -1 }],
      ['hours with 3 decimals', { hours: 1.234 }],
      ['hours as a string', { hours: 'ten' }],
      ['negative beneficiaries', { beneficiariesCount: -5 }],
      ['fractional activities', { activitiesCount: 2.5 }],
      ['volunteers over the cap', { volunteersCount: 1_000_001 }],
      ['null instead of a number', { activitiesCount: null }],
      ['too long resources', { resources: 'x'.repeat(2001) }],
      ['unknown field: projectId (cannot be reassigned)', { projectId: GHOST_ID }],
      ['unknown field: metrics (not exposed yet)', { metrics: { a: 1 } }],
      ['unknown field: id', { id: GHOST_ID }],
    ])('rejects %s with 400 and changes nothing', async (_l, body) => {
      await as(orgA).patch(`/projects/${project.id}/impact`).send(body).expect(400);
      const unchanged = await as(orgA).get(`/projects/${project.id}/impact`).expect(200);
      expect(unchanged.body.hours).toBe(40.25);
    });

    it('also validates on create', async () => {
      const p = await createProject(orgA, { title: `Create validation ${RUN}` });
      await setProjectStatus(orgA, p.id, 'IN_PROGRESS');
      await as(orgA).post(`/projects/${p.id}/impact`).send({ hours: -2 }).expect(400);
      await as(orgA).post(`/projects/${p.id}/impact`).send({ volunteersCount: 'many' }).expect(400);
      await as(orgA).post(`/projects/${p.id}/impact`).send({ projectId: GHOST_ID }).expect(400);
      expect(await prisma.impact.count({ where: { projectId: p.id } })).toBe(0);
    });

    it('keeps the report correctable after completion, although the project itself is frozen', async () => {
      await setProjectStatus(orgA, project.id, 'COMPLETED');
      await as(orgA).patch(`/projects/${project.id}`).send({ title: 'Too late' }).expect(409); // project frozen
      const res = await as(orgA)
        .patch(`/projects/${project.id}/impact`)
        .send({ beneficiariesCount: 150 })
        .expect(200);
      expect(res.body.beneficiariesCount).toBe(150);
    });

    it('reports 404 correctly: no impact yet vs. project not visible', async () => {
      const noImpact = await createProject(orgA, { title: `NoImpact ${RUN}` });
      await setProjectStatus(orgA, noImpact.id, 'IN_PROGRESS');
      const none = await as(v1).get(`/projects/${noImpact.id}/impact`).expect(404);
      expect(none.body.message).toBe('No impact has been recorded for this project yet');
      await as(orgA).patch(`/projects/${noImpact.id}/impact`).send({ hours: 1 }).expect(404);

      const draft = await createProject(orgA, { title: `Hidden draft ${RUN}`, status: 'DRAFT' });
      const hidden = await as(v1).get(`/projects/${draft.id}/impact`).expect(404);
      expect(hidden.body.message).toBe('Project not found');
      await as(orgB).post(`/projects/${draft.id}/impact`).send({}).expect(404); // not even confirming it exists

      await as(v1).get(`/projects/${GHOST_ID}/impact`).expect(404);
      await as(v1).get('/projects/not-a-uuid/impact').expect(400);
    });

    it('is removed together with its project', async () => {
      const p = await projectWithImpact(orgA, {
        title: `Cascade ${RUN}`,
        finalStatus: 'COMPLETED',
        impact: { volunteersCount: 1, hours: 1, activitiesCount: 1, beneficiariesCount: 1 },
      });
      await as(admin).delete(`/projects/${p.id}`).expect(204);
      expect(await prisma.impact.count({ where: { projectId: p.id } })).toBe(0);
    });

    it('is protected by database constraints as a last line of defence', async () => {
      const row = await prisma.impact.findUniqueOrThrow({ where: { projectId: project.id } });
      await expect(
        prisma.impact.update({ where: { id: row.id }, data: { hours: -1 } }),
      ).rejects.toThrow();
      await expect(
        prisma.impact.update({ where: { id: row.id }, data: { beneficiariesCount: -1 } }),
      ).rejects.toThrow();
    });
  });

  // ───────────────────────── Statistics ─────────────────────────
  describe('statistics', () => {
    let s1: Account;
    let s2: Account;
    let volunteer: Account;
    let baseline: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    let x: Account;
    let y: Account;
    let z: Account;
    let w: Account;

    beforeAll(async () => {
      baseline = (await as(admin).get('/impact/platform').expect(200)).body;

      s1 = await newOrg('s1');
      s2 = await newOrg('s2');
      [x, y, z, w] = await Promise.all([
        newVolunteer('x'),
        newVolunteer('y'),
        newVolunteer('z'),
        newVolunteer('w'),
      ]);
      volunteer = x;

      // Organization S1
      await projectWithImpact(s1, {
        title: `Stats A ${RUN}`,
        category: 'HEALTH',
        finalStatus: 'COMPLETED',
        accepted: [x],
        impact: { volunteersCount: 10, hours: 100.5, activitiesCount: 4, beneficiariesCount: 200 },
      });
      await projectWithImpact(s1, {
        title: `Stats B ${RUN}`,
        category: 'HEALTH',
        finalStatus: 'IN_PROGRESS',
        accepted: [x],
        impact: { volunteersCount: 5, hours: 50.25, activitiesCount: 2, beneficiariesCount: 100 },
      });
      await projectWithImpact(s1, {
        title: `Stats C ${RUN}`,
        category: 'EDUCATION',
        finalStatus: 'COMPLETED',
        accepted: [y],
        impact: { volunteersCount: 3, hours: 30, activitiesCount: 1, beneficiariesCount: 40 },
      });
      const d = await createProject(s1, { title: `Stats D ${RUN}` }); // no category; w only applied (pending)
      await as(w).post(`/projects/${d.id}/applications`).send({}).expect(201);
      await setProjectStatus(s1, d.id, 'IN_PROGRESS');
      await as(s1)
        .post(`/projects/${d.id}/impact`)
        .send({ volunteersCount: 2, hours: 20, activitiesCount: 1, beneficiariesCount: 10 })
        .expect(201);
      await setProjectStatus(s1, d.id, 'COMPLETED');
      // E: impact recorded, then CANCELLED → must not count anywhere (z was accepted only here)
      await projectWithImpact(s1, {
        title: `Stats E ${RUN}`,
        category: 'HEALTH',
        finalStatus: 'CANCELLED',
        accepted: [z],
        impact: { volunteersCount: 99, hours: 999, activitiesCount: 99, beneficiariesCount: 999 },
      });
      await createProject(s1, { title: `Stats F ${RUN}`, status: 'DRAFT' });
      await createProject(s1, { title: `Stats G ${RUN}` }); // PUBLISHED, no impact

      // Organization S2 (x is accepted here too: counted once per organization, once platform-wide)
      await projectWithImpact(s2, {
        title: `Stats H ${RUN}`,
        category: 'HEALTH',
        finalStatus: 'COMPLETED',
        accepted: [x],
        impact: { volunteersCount: 7, hours: 70, activitiesCount: 3, beneficiariesCount: 90 },
      });
    });

    it('computes exact organization figures (cancelled excluded, unique volunteers de-duplicated)', async () => {
      const res = await as(s1).get('/impact/organization').expect(200);
      expect(res.body).toEqual({
        organizationId: s1.orgId,
        projects: { total: 7, draft: 1, published: 1, inProgress: 1, completed: 3, cancelled: 1 },
        impact: {
          projectsWithImpact: 4,
          volunteersCount: 20,
          hours: 200.75,
          activitiesCount: 8,
          beneficiariesCount: 350,
        },
        uniqueVolunteers: 2, // x (two projects) and y; z (cancelled only) and w (pending) do not count
        byCategory: [
          {
            category: 'HEALTH',
            projectsWithImpact: 2,
            volunteersCount: 15,
            hours: 150.75,
            activitiesCount: 6,
            beneficiariesCount: 300,
          },
          {
            category: 'EDUCATION',
            projectsWithImpact: 1,
            volunteersCount: 3,
            hours: 30,
            activitiesCount: 1,
            beneficiariesCount: 40,
          },
          {
            category: null,
            projectsWithImpact: 1,
            volunteersCount: 2,
            hours: 20,
            activitiesCount: 1,
            beneficiariesCount: 10,
          },
        ],
      });
    });

    it('never mixes organizations: each only sees its own projects', async () => {
      const res = await as(s2).get('/impact/organization').expect(200);
      expect(res.body.organizationId).toBe(s2.orgId);
      expect(res.body.projects.total).toBe(1);
      expect(res.body.impact).toEqual({
        projectsWithImpact: 1,
        volunteersCount: 7,
        hours: 70,
        activitiesCount: 3,
        beneficiariesCount: 90,
      });
      expect(res.body.uniqueVolunteers).toBe(1);
      expect(res.body.byCategory).toHaveLength(1);
    });

    it('returns zeros for an organization without projects', async () => {
      const empty = await newOrg('empty');
      const res = await as(empty).get('/impact/organization').expect(200);
      expect(res.body).toEqual({
        organizationId: empty.orgId,
        projects: { total: 0, draft: 0, published: 0, inProgress: 0, completed: 0, cancelled: 0 },
        impact: {
          projectsWithImpact: 0,
          volunteersCount: 0,
          hours: 0,
          activitiesCount: 0,
          beneficiariesCount: 0,
        },
        uniqueVolunteers: 0,
        byCategory: [],
      });
    });

    it('enforces who may ask: organizations only for themselves, admins by organizationId', async () => {
      await as(s1).get('/impact/organization').query({ organizationId: s1.orgId }).expect(200);
      const other = await as(s1)
        .get('/impact/organization')
        .query({ organizationId: s2.orgId })
        .expect(403);
      expect(other.body.message).toBe('You can only view statistics of your own organization');

      const adminNoId = await as(admin).get('/impact/organization').expect(400);
      expect(adminNoId.body.message).toBe('organizationId is required for administrators');
      const viaAdmin = await as(admin)
        .get('/impact/organization')
        .query({ organizationId: s2.orgId })
        .expect(200);
      expect(viaAdmin.body.impact.hours).toBe(70);
      await as(admin).get('/impact/organization').query({ organizationId: GHOST_ID }).expect(404);
      await as(admin).get('/impact/organization').query({ organizationId: 'nope' }).expect(400);
      await as(admin).get('/impact/organization').query({ evil: '1' }).expect(400);

      await as(volunteer).get('/impact/organization').expect(403);
      await http().get('/impact/organization').expect(401);
    });

    it('platform statistics are ADMIN-only', async () => {
      await as(s1).get('/impact/platform').expect(403);
      await as(volunteer).get('/impact/platform').expect(403);
      await http().get('/impact/platform').expect(401);
    });

    it('platform totals grew by exactly what this test added (cancelled excluded; x counted once)', async () => {
      const after = (await as(admin).get('/impact/platform').expect(200)).body;
      const delta = (a: number, b: number) => Math.round((a - b) * 100) / 100;

      expect(after.organizations - baseline.organizations).toBeGreaterThanOrEqual(3); // s1, s2, empty (+ earlier test orgs)
      expect(delta(after.impact.projectsWithImpact, baseline.impact.projectsWithImpact)).toBe(5);
      expect(delta(after.impact.volunteersCount, baseline.impact.volunteersCount)).toBe(27); // 10+5+3+2+7, not +99
      expect(delta(after.impact.hours, baseline.impact.hours)).toBe(270.75); // not +999
      expect(delta(after.impact.activitiesCount, baseline.impact.activitiesCount)).toBe(11);
      expect(delta(after.impact.beneficiariesCount, baseline.impact.beneficiariesCount)).toBe(440);
      expect(after.projects.total - baseline.projects.total).toBe(8);
      expect(after.projects.cancelled - baseline.projects.cancelled).toBe(1);
      expect(after.projects.completed - baseline.projects.completed).toBe(4);
      expect(after.uniqueVolunteers - baseline.uniqueVolunteers).toBe(2); // x and y; x is shared by two organizations

      const health = (s: typeof after) =>
        s.byCategory.find((c: { category: string | null }) => c.category === 'HEALTH') ?? {
          projectsWithImpact: 0,
          volunteersCount: 0,
        };
      expect(health(after).projectsWithImpact - health(baseline).projectsWithImpact).toBe(3); // A, B, H (not cancelled E)
      expect(health(after).volunteersCount - health(baseline).volunteersCount).toBe(22); // 10+5+7
    });

    it('stops counting a project as soon as it is cancelled after reporting impact', async () => {
      const before = (await as(s2).get('/impact/organization').expect(200)).body;
      const p = await projectWithImpact(s2, {
        title: `Stats late cancel ${RUN}`,
        category: 'HEALTH',
        finalStatus: 'IN_PROGRESS',
        impact: { volunteersCount: 50, hours: 500, activitiesCount: 5, beneficiariesCount: 5000 },
      });
      const during = (await as(s2).get('/impact/organization').expect(200)).body;
      expect(during.impact.volunteersCount - before.impact.volunteersCount).toBe(50);

      await setProjectStatus(s2, p.id, 'CANCELLED');
      const cancelled = (await as(s2).get('/impact/organization').expect(200)).body;
      expect(cancelled.impact).toEqual(before.impact);
    });
  });
});
