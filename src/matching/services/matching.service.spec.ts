import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProjectStatus as P, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { RecommendationsQueryDto } from '../dto/matching.dto';
import {
  MATCH_STRATEGY,
  MatchInput,
  MatchResult,
  MatchStrategy,
} from '../interfaces/match.interfaces';
import { MAX_RECOMMENDATION_CANDIDATES } from '../matching.constants';
import { MatchingService } from './matching.service';

const vol: AuthenticatedUser = { id: 'v1', email: 'v@x.co', role: Role.VOLUNTEER };

const result = (score: number): MatchResult => ({
  score,
  matchedSkills: [],
  missingSkills: [],
  locationMatch: null,
  interestMatch: null,
  availabilityMatch: null,
  breakdown: {} as MatchResult['breakdown'],
  strategy: 'fake',
});

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organizationId: 'o1',
  title: `Project ${id}`,
  description: 'D',
  location: 'Algiers',
  startDate: null,
  endDate: null,
  status: P.PUBLISHED,
  maxVolunteers: null,
  category: 'HEALTH',
  availability: ['WEEKENDS'],
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  organization: { id: 'o1', name: 'Org', logo: null, location: null },
  skills: [{ skill: { id: 's1', name: 'First Aid' }, requiredCount: 2, importance: 5 }],
  _count: { applications: 0 },
  ...over,
});

describe('MatchingService', () => {
  let service: MatchingService;
  const prisma = {
    project: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    volunteerProfile: { findUnique: jest.fn() },
    userSkill: { findMany: jest.fn() },
  };
  /** A stand-in algorithm: proves the service depends only on the MatchStrategy contract. */
  const fakeStrategy: jest.Mocked<MatchStrategy> = { name: 'fake', score: jest.fn() };

  const query = (over: Partial<RecommendationsQueryDto> = {}) =>
    Object.assign(new RecommendationsQueryDto(), over);

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.volunteerProfile.findUnique.mockResolvedValue({
      location: 'Algiers',
      availability: ['WEEKENDS'],
      interests: ['HEALTH'],
    });
    prisma.userSkill.findMany.mockResolvedValue([
      { skillId: 's1', proficiency: 'ADVANCED', skill: { name: 'First Aid' } },
    ]);
    fakeStrategy.score.mockResolvedValue(result(50));

    const moduleRef = await Test.createTestingModule({
      providers: [
        MatchingService,
        { provide: PrismaService, useValue: prisma },
        { provide: MATCH_STRATEGY, useValue: fakeStrategy },
      ],
    }).compile();
    service = moduleRef.get(MatchingService);
  });

  describe('algorithm replacement (strategy seam)', () => {
    it('feeds plain volunteer/project data to whatever strategy is bound and returns its result', async () => {
      prisma.project.findFirst.mockResolvedValue(row('p1'));
      fakeStrategy.score.mockResolvedValue(result(42));

      const out = await service.matchWithProject(vol, 'p1');

      expect(out.match.score).toBe(42);
      expect(out.match.strategy).toBe('fake');
      const arg = fakeStrategy.score.mock.calls[0][0] as MatchInput;
      expect(arg.volunteer).toEqual({
        skills: [{ skillId: 's1', name: 'First Aid', proficiency: 'ADVANCED' }],
        location: 'Algiers',
        interests: ['HEALTH'],
        availability: ['WEEKENDS'],
      });
      expect(arg.project).toEqual({
        skills: [{ skillId: 's1', name: 'First Aid', importance: 5, requiredCount: 2 }],
        location: 'Algiers',
        category: 'HEALTH',
        availability: ['WEEKENDS'],
      });
    });
  });

  describe('matchWithProject', () => {
    it('404s for projects the volunteer cannot see (same rule as browsing)', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.matchWithProject(vol, 'p1')).rejects.toThrow(NotFoundException);
      expect(prisma.project.findFirst.mock.calls[0][0].where.AND[1].status).toEqual({
        not: 'DRAFT',
      });
      expect(fakeStrategy.score).not.toHaveBeenCalled();
    });

    it('falls back to an empty profile when the volunteer has not filled anything in', async () => {
      prisma.project.findFirst.mockResolvedValue(row('p1'));
      prisma.volunteerProfile.findUnique.mockResolvedValue(null);
      prisma.userSkill.findMany.mockResolvedValue([]);
      await service.matchWithProject(vol, 'p1');
      expect((fakeStrategy.score.mock.calls[0][0] as MatchInput).volunteer).toEqual({
        skills: [],
        location: null,
        interests: [],
        availability: [],
      });
    });
  });

  describe('recommend', () => {
    it('only considers open, not-yet-applied, still-running projects and bounds the candidate set', async () => {
      prisma.project.findMany.mockResolvedValue([]);
      await service.recommend(vol, query());

      const args = prisma.project.findMany.mock.calls[0][0];
      const clauses = args.where.AND;
      expect(clauses[1]).toEqual({ status: 'PUBLISHED' });
      expect(clauses[2].OR[0]).toEqual({ endDate: null });
      expect(clauses[3]).toEqual({
        applications: { none: { volunteerId: 'v1', status: { not: 'WITHDRAWN' } } },
      });
      expect(args.take).toBe(MAX_RECOMMENDATION_CANDIDATES);
    });

    it('ranks by score (desc), breaks ties by newest, and drops full projects', async () => {
      prisma.project.findMany.mockResolvedValue([
        row('low'),
        row('tie-old', { createdAt: new Date('2026-01-01') }),
        row('tie-new', { createdAt: new Date('2026-03-01') }),
        row('top'),
        row('full', { maxVolunteers: 2, _count: { applications: 2 } }),
        row('has-room', { maxVolunteers: 2, _count: { applications: 1 } }),
      ]);
      const scores: Record<string, number> = {
        low: 10,
        'tie-old': 60,
        'tie-new': 60,
        top: 90,
        full: 99,
        'has-room': 5,
      };
      // the fake strategy answers in call order; 'full' is filtered out before scoring
      const order = ['low', 'tie-old', 'tie-new', 'top', 'has-room'];
      let call = 0;
      fakeStrategy.score.mockImplementation(() => Promise.resolve(result(scores[order[call++]])));

      const out = await service.recommend(vol, query());

      expect(out.data.map((d) => d.project.id)).toEqual([
        'top',
        'tie-new',
        'tie-old',
        'low',
        'has-room',
      ]);
      expect(out.data.map((d) => d.match.score)).toEqual([90, 60, 60, 10, 5]);
      expect(out.meta.total).toBe(5);
    });

    it('applies minScore and paginates the ranked list', async () => {
      prisma.project.findMany.mockResolvedValue(['a', 'b', 'c', 'd'].map((id) => row(id)));
      const scores = [80, 70, 60, 10];
      let call = 0;
      fakeStrategy.score.mockImplementation(() => Promise.resolve(result(scores[call++])));

      const page1 = await service.recommend(vol, query({ minScore: 50, limit: 2, page: 1 }));
      expect(page1.data.map((d) => d.project.id)).toEqual(['a', 'b']);
      expect(page1.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

      call = 0;
      const page2 = await service.recommend(vol, query({ minScore: 50, limit: 2, page: 2 }));
      expect(page2.data.map((d) => d.project.id)).toEqual(['c']);
    });
  });

  describe('scoreForApplication', () => {
    it('returns the score of the bound strategy', async () => {
      prisma.project.findUnique.mockResolvedValue(row('p1'));
      fakeStrategy.score.mockResolvedValue(result(77));
      await expect(service.scoreForApplication('v1', 'p1')).resolves.toBe(77);
    });

    it('returns null when the project is gone', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(service.scoreForApplication('v1', 'p1')).resolves.toBeNull();
    });

    it('never throws: a failing strategy (e.g. an unreachable ML service) leaves the score empty', async () => {
      prisma.project.findUnique.mockResolvedValue(row('p1'));
      fakeStrategy.score.mockRejectedValue(new Error('model service down'));
      await expect(service.scoreForApplication('v1', 'p1')).resolves.toBeNull();
    });
  });
});
