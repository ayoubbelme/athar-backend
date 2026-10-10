import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
}

describe('Matching (e2e)', () => {
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
  const createProject = async (body: Record<string, unknown>) =>
    (
      await as(org)
        .post('/projects')
        .send({ description: 'A sufficiently long description.', status: 'PUBLISHED', ...body })
        .expect(201)
    ).body;
  const matchOf = async (who: Account, projectId: string) =>
    (await as(who).get(`/matching/projects/${projectId}`).expect(200)).body.match;
  const recommended = async (who: Account, query: Record<string, unknown> = {}) =>
    (
      await as(who)
        .get('/matching/projects')
        .query({ limit: 100, ...query })
        .expect(200)
    ).body;

  let admin: Account;
  let org: Account;
  let volunteer: Account;
  let skillA: string;
  let skillB: string;
  let skillC: string;
  const ids: Record<string, string> = {};
  /** Only my own projects, in the order the API returned them. */
  const mine = (body: { data: Array<{ project: { id: string } }> }): string[] => {
    const known = new Map(Object.entries(ids).map(([k, v]) => [v, k]));
    return body.data.map((d) => known.get(d.project.id)).filter((k): k is string => Boolean(k));
  };

  beforeAll(async () => {
    process.env.THROTTLE_AUTH_LIMIT = '1000';
    process.env.THROTTLE_LIMIT = '10000';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    admin = await signUp({ name: 'Admin', email: email('admin'), role: 'VOLUNTEER' });
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    org = await signUp({
      name: 'Owner',
      email: email('org'),
      role: 'ORGANIZATION',
      organizationName: `Match Org ${RUN}`,
    });
    volunteer = await signUp({ name: 'Matched Volunteer', email: email('vol'), role: 'VOLUNTEER' });

    [skillA, skillB, skillC] = (
      await Promise.all(
        ['A', 'B', 'C'].map((n) =>
          prisma.skill.create({ data: { name: `E2E Skill Match ${n} ${RUN}` } }),
        ),
      )
    ).map((s) => s.id);

    // Volunteer: Skill A (ADVANCED) + Skill B (BEGINNER), Algiers, weekends, health
    await as(volunteer)
      .post('/volunteers/me/skills')
      .send({ skillId: skillA, proficiency: 'ADVANCED' })
      .expect(201);
    await as(volunteer)
      .post('/volunteers/me/skills')
      .send({ skillId: skillB, proficiency: 'BEGINNER' })
      .expect(201);
    await as(volunteer)
      .patch('/volunteers/me')
      .send({ location: 'Algiers', availability: ['WEEKENDS'], interests: ['HEALTH'] })
      .expect(200);

    ids.perfect = (
      await createProject({
        title: `Perfect ${RUN}`,
        location: 'Algiers, Algeria',
        category: 'HEALTH',
        availability: ['WEEKENDS', 'EVENINGS'],
        skills: [
          { skillId: skillA, importance: 5 },
          { skillId: skillB, importance: 3 },
        ],
      })
    ).id;
    ids.partial = (
      await createProject({
        title: `Partial ${RUN}`,
        location: 'Oran',
        category: 'EDUCATION',
        availability: ['WEEKDAYS'],
        skills: [
          { skillId: skillA, importance: 5 },
          { skillId: skillC, importance: 5 },
        ],
      })
    ).id;
    ids.locationOnly = (
      await createProject({ title: `LocationOnly ${RUN}`, location: 'Algiers' })
    ).id;
    ids.noRequirements = (await createProject({ title: `NoReq ${RUN}` })).id;
    ids.draft = (
      await createProject({ title: `Draft ${RUN}`, status: 'DRAFT', location: 'Algiers' })
    ).id;
    ids.past = (
      await createProject({
        title: `Past ${RUN}`,
        location: 'Algiers',
        startDate: '2020-01-01T00:00:00Z',
        endDate: '2020-01-02T00:00:00Z',
      })
    ).id;
    ids.full = (
      await createProject({ title: `Full ${RUN}`, location: 'Algiers', maxVolunteers: 1 })
    ).id;
    ids.applied = (
      await createProject({
        title: `Applied ${RUN}`,
        location: 'Algiers',
        category: 'HEALTH',
        availability: ['WEEKENDS'],
        skills: [{ skillId: skillA, importance: 5 }],
      })
    ).id;
    ids.completed = (await createProject({ title: `Completed ${RUN}`, location: 'Algiers' })).id;
    await as(org).patch(`/projects/${ids.completed}`).send({ status: 'IN_PROGRESS' }).expect(200);
    await as(org).patch(`/projects/${ids.completed}`).send({ status: 'COMPLETED' }).expect(200);

    // fill the 1-spot project with another volunteer
    const other = await signUp({
      name: 'Other Volunteer',
      email: email('other'),
      role: 'VOLUNTEER',
    });
    const application = await as(other)
      .post(`/projects/${ids.full}/applications`)
      .send({})
      .expect(201);
    await as(org)
      .patch(`/applications/${application.body.id}/status`)
      .send({ status: 'ACCEPTED' })
      .expect(200);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    await prisma.skill.deleteMany({ where: { name: { startsWith: 'E2E Skill' } } });
    process.env.THROTTLE_AUTH_LIMIT = saved.auth;
    process.env.THROTTLE_LIMIT = saved.limit;
    await app.close();
  });

  describe('access control', () => {
    it('requires a volunteer account', async () => {
      await http().get('/matching/projects').expect(401);
      await http().get(`/matching/projects/${ids.perfect}`).expect(401);
      for (const who of [org, admin]) {
        await as(who).get('/matching/projects').expect(403);
        await as(who).get(`/matching/projects/${ids.perfect}`).expect(403);
      }
    });
  });

  describe('GET /matching/projects/:id — explainable score', () => {
    it('perfect fit: skills 85 % + location + interest + availability = 92.5 → 93', async () => {
      const match = await matchOf(volunteer, ids.perfect);
      expect(match).toMatchObject({
        score: 93,
        locationMatch: true,
        interestMatch: true,
        availabilityMatch: true,
        missingSkills: [],
        strategy: 'rule-based-v1',
      });
      expect(match.matchedSkills).toEqual([
        {
          skillId: skillA,
          name: `E2E Skill Match A ${RUN}`,
          importance: 5,
          proficiency: 'ADVANCED',
        },
        {
          skillId: skillB,
          name: `E2E Skill Match B ${RUN}`,
          importance: 3,
          proficiency: 'BEGINNER',
        },
      ]);
      expect(match.breakdown).toEqual({
        skills: { weight: 50, applicable: true, ratio: 0.85, contribution: 42.5 },
        location: { weight: 20, applicable: true, ratio: 1, contribution: 20 },
        interest: { weight: 20, applicable: true, ratio: 1, contribution: 20 },
        availability: { weight: 10, applicable: true, ratio: 1, contribution: 10 },
      });
    });

    it('poor fit: reports the missing skill and every miss → 25', async () => {
      const match = await matchOf(volunteer, ids.partial);
      expect(match).toMatchObject({
        score: 25,
        locationMatch: false,
        interestMatch: false,
        availabilityMatch: false,
      });
      expect(match.missingSkills).toEqual([
        { skillId: skillC, name: `E2E Skill Match C ${RUN}`, importance: 5 },
      ]);
      expect(match.matchedSkills).toHaveLength(1);
    });

    it('ignores what the project does not specify and re-normalizes (location-only project → 100)', async () => {
      const match = await matchOf(volunteer, ids.locationOnly);
      expect(match).toMatchObject({
        score: 100,
        locationMatch: true,
        interestMatch: null,
        availabilityMatch: null,
      });
      expect(match.breakdown.skills).toEqual({
        weight: 50,
        applicable: false,
        ratio: null,
        contribution: 0,
      });
    });

    it('a project with no requirements scores 0 with nothing applicable', async () => {
      const match = await matchOf(volunteer, ids.noRequirements);
      expect(match.score).toBe(0);
      expect([match.locationMatch, match.interestMatch, match.availabilityMatch]).toEqual([
        null,
        null,
        null,
      ]);
    });

    it('works for any visible project (also completed ones) but never for hidden ones', async () => {
      const completed = (await as(volunteer).get(`/matching/projects/${ids.completed}`).expect(200))
        .body;
      expect(completed.project).toEqual({
        id: ids.completed,
        title: `Completed ${RUN}`,
        status: 'COMPLETED',
      });
      await as(volunteer).get(`/matching/projects/${ids.draft}`).expect(404);
      await as(volunteer).get(`/matching/projects/${GHOST_ID}`).expect(404);
      await as(volunteer).get('/matching/projects/not-a-uuid').expect(400);
    });
  });

  describe('GET /matching/projects — recommendations', () => {
    it('ranks open projects best-first; equal scores are ordered newest first', async () => {
      const body = await recommended(volunteer);
      // applied (100, created last) ▸ locationOnly (100) ▸ perfect (93) ▸ partial (25) ▸ noRequirements (0)
      expect(mine(body)).toEqual([
        'applied',
        'locationOnly',
        'perfect',
        'partial',
        'noRequirements',
      ]);
      const scores = body.data.map((d: { match: { score: number } }) => d.match.score);
      expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
    });

    it('excludes draft, past, full, completed projects (not open for this volunteer)', async () => {
      const listed = mine(await recommended(volunteer));
      for (const hidden of ['draft', 'past', 'full', 'completed'])
        expect(listed).not.toContain(hidden);
      for (const open of ['perfect', 'partial', 'locationOnly', 'noRequirements'])
        expect(listed).toContain(open);
    });

    it('returns full project views plus the match for each item', async () => {
      const body = await recommended(volunteer);
      const item = body.data.find((d: { project: { id: string } }) => d.project.id === ids.perfect);
      expect(item.project).toMatchObject({
        id: ids.perfect,
        category: 'HEALTH',
        availability: ['WEEKENDS', 'EVENINGS'],
        organization: { name: `Match Org ${RUN}` },
      });
      expect(item.project.skills).toHaveLength(2);
      expect(item.match.score).toBe(93);
      expect(body.meta).toMatchObject({ page: 1, limit: 100 });
    });

    it('filters with minScore, paginates, and validates its query', async () => {
      const high = mine(await recommended(volunteer, { minScore: 90 }));
      expect(high).toEqual(expect.arrayContaining(['locationOnly', 'perfect']));
      expect(high).not.toContain('partial');
      expect(high).not.toContain('noRequirements');

      const page1 = await recommended(volunteer, { minScore: 1, limit: 1, page: 1 });
      expect(page1.data).toHaveLength(1);
      expect(page1.meta.total).toBeGreaterThanOrEqual(3);
      const page2 = await recommended(volunteer, { minScore: 1, limit: 1, page: 2 });
      expect(page2.data[0].project.id).not.toBe(page1.data[0].project.id);

      await as(volunteer).get('/matching/projects').query({ minScore: 101 }).expect(400);
      await as(volunteer).get('/matching/projects').query({ minScore: -1 }).expect(400);
      await as(volunteer).get('/matching/projects').query({ limit: 101 }).expect(400);
      await as(volunteer).get('/matching/projects').query({ foo: 'bar' }).expect(400);
    });

    it('hides projects of suspended organizations', async () => {
      const suspended = await signUp({
        name: 'Soon Suspended',
        email: email('susp'),
        role: 'ORGANIZATION',
        organizationName: `Match Org S ${RUN}`,
      });
      const p = (
        await as(suspended)
          .post('/projects')
          .send({
            title: `Suspended ${RUN}`,
            description: 'A sufficiently long description.',
            status: 'PUBLISHED',
            location: 'Algiers',
          })
          .expect(201)
      ).body;
      ids.suspendedOrg = p.id;
      expect(mine(await recommended(volunteer))).toContain('suspendedOrg');
      await as(admin)
        .patch(`/users/${suspended.id}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(200);
      expect(mine(await recommended(volunteer))).not.toContain('suspendedOrg');
      await as(volunteer).get(`/matching/projects/${p.id}`).expect(404);
    });
  });

  describe("scores follow the volunteer's profile", () => {
    it('losing an interest lowers the score: 42.5 + 20 + 10 = 72.5 → 73', async () => {
      await as(volunteer).patch('/volunteers/me').send({ interests: [] }).expect(200);
      expect((await matchOf(volunteer, ids.perfect)).score).toBe(73);
      await as(volunteer)
        .patch('/volunteers/me')
        .send({ interests: ['HEALTH'] })
        .expect(200);
      expect((await matchOf(volunteer, ids.perfect)).score).toBe(93);
    });

    it('acquiring a missing skill raises it: partial project 25 → 40 with Skill C at BEGINNER', async () => {
      await as(volunteer)
        .post('/volunteers/me/skills')
        .send({ skillId: skillC, proficiency: 'BEGINNER' })
        .expect(201);
      const match = await matchOf(volunteer, ids.partial);
      expect(match.score).toBe(40); // (5×100% + 5×60%) / 10 = 0.8 → 40 points
      expect(match.missingSkills).toEqual([]);
      await as(volunteer).delete(`/volunteers/me/skills/${skillC}`).expect(204);
      expect((await matchOf(volunteer, ids.partial)).score).toBe(25);
    });

    it('availability FLEXIBLE satisfies any constrained project', async () => {
      await as(volunteer)
        .patch('/volunteers/me')
        .send({ availability: ['FLEXIBLE'] })
        .expect(200);
      expect((await matchOf(volunteer, ids.partial)).availabilityMatch).toBe(true); // project needs WEEKDAYS
      await as(volunteer)
        .patch('/volunteers/me')
        .send({ availability: ['WEEKENDS'] })
        .expect(200);
    });

    it('a volunteer with an empty profile still gets valid (low) scores', async () => {
      const blank = await signUp({
        name: 'Blank Profile',
        email: email('blank'),
        role: 'VOLUNTEER',
      });
      const match = await matchOf(blank, ids.perfect);
      expect(match).toMatchObject({
        score: 0,
        locationMatch: false,
        interestMatch: false,
        availabilityMatch: false,
      });
      expect(match.missingSkills).toHaveLength(2);
    });
  });

  describe('integration with applications', () => {
    let applicationId: string;

    it('stores the score on the application when applying and shows it to both sides', async () => {
      const res = await as(volunteer)
        .post(`/projects/${ids.applied}/applications`)
        .send({})
        .expect(201);
      applicationId = res.body.id;
      expect(res.body.matchScore).toBe(100); // skill A (ADVANCED) + location + interest + availability

      const mineList = await as(volunteer)
        .get('/applications/my')
        .query({ status: 'PENDING' })
        .expect(200);
      expect(
        mineList.body.data.find((a: { id: string }) => a.id === applicationId).matchScore,
      ).toBe(100);
    });

    it('lets organizations rank applicants by match score (unscored last)', async () => {
      const weak = await signUp({ name: 'Weak Match', email: email('weak'), role: 'VOLUNTEER' });
      const weakApp = (
        await as(weak).post(`/projects/${ids.applied}/applications`).send({}).expect(201)
      ).body;
      expect(weakApp.matchScore).toBe(0);

      const desc = await as(org)
        .get(`/projects/${ids.applied}/applications`)
        .query({ sortBy: 'matchScore', order: 'desc' })
        .expect(200);
      expect(desc.body.data.map((a: { matchScore: number }) => a.matchScore)).toEqual([100, 0]);
      const asc = await as(org)
        .get(`/projects/${ids.applied}/applications`)
        .query({ sortBy: 'matchScore', order: 'asc' })
        .expect(200);
      expect(asc.body.data.map((a: { matchScore: number }) => a.matchScore)).toEqual([0, 100]);
    });

    it('stops recommending a project once the volunteer applied, and brings it back after withdrawing', async () => {
      expect(mine(await recommended(volunteer))).not.toContain('applied');

      await as(volunteer).delete(`/applications/${applicationId}`).expect(204);
      expect(mine(await recommended(volunteer))).toContain('applied');

      // re-applying recomputes the score from the current profile
      await as(volunteer).patch('/volunteers/me').send({ interests: [] }).expect(200);
      const again = await as(volunteer)
        .post(`/projects/${ids.applied}/applications`)
        .send({})
        .expect(201);
      expect(again.body.id).toBe(applicationId);
      // skills 50 + location 20 + availability 10 = 80 (the project's HEALTH category no longer matches)
      expect(again.body.matchScore).toBe(80);
    });
  });
});
