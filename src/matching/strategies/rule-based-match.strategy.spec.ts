import { Availability as Av, ProficiencyLevel as Lv, ProjectCategory as Cat } from '@prisma/client';
import { MatchInput } from '../interfaces/match.interfaces';
import { RuleBasedMatchStrategy } from './rule-based-match.strategy';

const strategy = new RuleBasedMatchStrategy();

const input = (
  volunteer: Partial<MatchInput['volunteer']> = {},
  project: Partial<MatchInput['project']> = {},
): MatchInput => ({
  volunteer: { skills: [], location: null, interests: [], availability: [], ...volunteer },
  project: { skills: [], location: null, category: null, availability: [], ...project },
});
const have = (skillId: string, proficiency: Lv, name = skillId) => ({ skillId, name, proficiency });
const need = (skillId: string, importance: number, name = skillId) => ({
  skillId,
  name,
  importance,
  requiredCount: 1,
});

describe('RuleBasedMatchStrategy', () => {
  describe('worked examples', () => {
    it('combines all four components (50/20/20/10): 92.5 → 93', () => {
      // skills: (5×100% + 3×60%) / (5+3) = 0.85 → 42.5 pts; location, interest, availability → 20 + 20 + 10
      const result = strategy.compute(
        input(
          {
            skills: [have('s1', Lv.ADVANCED, 'First Aid'), have('s2', Lv.BEGINNER, 'Teaching')],
            location: 'Algiers',
            interests: [Cat.HEALTH],
            availability: [Av.WEEKENDS],
          },
          {
            skills: [need('s1', 5, 'First Aid'), need('s2', 3, 'Teaching')],
            location: 'algiers, algeria',
            category: Cat.HEALTH,
            availability: [Av.WEEKENDS, Av.EVENINGS],
          },
        ),
      );

      expect(result.score).toBe(93);
      expect(result.locationMatch).toBe(true);
      expect(result.interestMatch).toBe(true);
      expect(result.availabilityMatch).toBe(true);
      expect(result.matchedSkills).toEqual([
        { skillId: 's1', name: 'First Aid', importance: 5, proficiency: 'ADVANCED' },
        { skillId: 's2', name: 'Teaching', importance: 3, proficiency: 'BEGINNER' },
      ]);
      expect(result.missingSkills).toEqual([]);
      expect(result.breakdown.skills).toEqual({
        weight: 50,
        applicable: true,
        ratio: 0.85,
        contribution: 42.5,
      });
      expect(result.breakdown.location.contribution).toBe(20);
      expect(result.breakdown.interest.contribution).toBe(20);
      expect(result.breakdown.availability.contribution).toBe(10);
      expect(result.strategy).toBe('rule-based-v1');
    });

    it('scores a poor fit low and explains what is missing: 25', () => {
      const result = strategy.compute(
        input(
          {
            skills: [have('s1', Lv.EXPERT)],
            location: 'Oran',
            interests: [Cat.SPORTS],
            availability: [Av.WEEKDAYS],
          },
          {
            skills: [need('s1', 5), need('s3', 5, 'Photography')],
            location: 'Algiers',
            category: Cat.EDUCATION,
            availability: [Av.WEEKENDS],
          },
        ),
      );
      // skills 5/10 = 0.5 → 25 pts of 100; everything else misses
      expect(result.score).toBe(25);
      expect(result.missingSkills).toEqual([{ skillId: 's3', name: 'Photography', importance: 5 }]);
      expect([result.locationMatch, result.interestMatch, result.availabilityMatch]).toEqual([
        false,
        false,
        false,
      ]);
    });

    it('weights skills by importance: a missing minor skill hurts less than a missing critical one', () => {
      const minorMissing = strategy.compute(
        input({ skills: [have('a', Lv.EXPERT)] }, { skills: [need('a', 5), need('b', 1)] }),
      );
      const criticalMissing = strategy.compute(
        input({ skills: [have('b', Lv.EXPERT)] }, { skills: [need('a', 5), need('b', 1)] }),
      );
      expect(minorMissing.score).toBe(83); // 5/6
      expect(criticalMissing.score).toBe(17); // 1/6
    });
  });

  describe('proficiency', () => {
    it.each([
      [Lv.BEGINNER, 60],
      [Lv.INTERMEDIATE, 80],
      [Lv.ADVANCED, 100],
      [Lv.EXPERT, 100],
    ])('%s earns %i%% of a skill', (level, expected) => {
      const result = strategy.compute(
        input({ skills: [have('s', level)] }, { skills: [need('s', 3)] }),
      );
      expect(result.score).toBe(expected);
    });
  });

  describe('components the project does not specify are ignored (weights re-normalized)', () => {
    it('a project asking only for a location scores 100 / 0 on that alone', () => {
      const hit = strategy.compute(input({ location: 'Algiers' }, { location: 'Algiers' }));
      const miss = strategy.compute(input({ location: 'Oran' }, { location: 'Algiers' }));
      expect(hit.score).toBe(100);
      expect(miss.score).toBe(0);
      expect(hit.interestMatch).toBeNull();
      expect(hit.availabilityMatch).toBeNull();
      expect(hit.breakdown.skills).toEqual({
        weight: 50,
        applicable: false,
        ratio: null,
        contribution: 0,
      });
      expect(hit.breakdown.location.contribution).toBe(100);
    });

    it('skills + location only: weights become 50:20 → 71 for a skills-perfect, location-miss volunteer', () => {
      const result = strategy.compute(
        input(
          { skills: [have('s', Lv.EXPERT)], location: 'Oran' },
          { skills: [need('s', 3)], location: 'Algiers' },
        ),
      );
      expect(result.score).toBe(71); // 100 × 50 / 70
    });

    it('a project with no requirements at all scores 0 (nothing to match on)', () => {
      const result = strategy.compute(
        input({ skills: [have('s', Lv.EXPERT)], location: 'Algiers' }),
      );
      expect(result.score).toBe(0);
      expect(
        Object.values(result.breakdown).every((c) => !c.applicable && c.contribution === 0),
      ).toBe(true);
      expect([result.locationMatch, result.interestMatch, result.availabilityMatch]).toEqual([
        null,
        null,
        null,
      ]);
    });

    it('treats a blank project location as not specified', () => {
      expect(strategy.compute(input({}, { location: '   ' })).locationMatch).toBeNull();
    });
  });

  describe('interest', () => {
    it('matches when the category is among several interests', () => {
      const r = strategy.compute(
        input({ interests: [Cat.SPORTS, Cat.HEALTH] }, { category: Cat.HEALTH }),
      );
      expect(r.interestMatch).toBe(true);
      expect(r.score).toBe(100);
    });

    it('does not match a volunteer without interests', () => {
      const r = strategy.compute(input({ interests: [] }, { category: Cat.HEALTH }));
      expect(r.interestMatch).toBe(false);
      expect(r.score).toBe(0);
    });
  });

  describe('availability', () => {
    it('a FLEXIBLE volunteer fits any constrained project', () => {
      const r = strategy.compute(
        input({ availability: [Av.FLEXIBLE] }, { availability: [Av.WEEKENDS] }),
      );
      expect(r.availabilityMatch).toBe(true);
    });

    it('a FLEXIBLE project (or none) imposes no constraint, so it is not scored', () => {
      expect(
        strategy.compute(input({}, { availability: [Av.FLEXIBLE] })).availabilityMatch,
      ).toBeNull();
      expect(
        strategy.compute(input({}, { availability: [Av.WEEKENDS, Av.FLEXIBLE] })).availabilityMatch,
      ).toBeNull();
      expect(strategy.compute(input({}, { availability: [] })).availabilityMatch).toBeNull();
    });

    it.each([
      [[Av.WEEKDAYS], [Av.WEEKENDS], false],
      [[], [Av.WEEKENDS], false], // unknown availability earns no credit
      [[Av.EVENINGS, Av.WEEKENDS], [Av.WEEKENDS], true],
      [[Av.EVENINGS], [Av.WEEKENDS, Av.EVENINGS], true],
    ])('volunteer %j vs project %j → %s', (volunteer, project, expected) => {
      expect(
        strategy.compute(input({ availability: volunteer }, { availability: project }))
          .availabilityMatch,
      ).toBe(expected);
    });
  });

  describe('properties', () => {
    it('is deterministic and does not mutate its input', () => {
      const data = input(
        {
          skills: [have('s', Lv.ADVANCED)],
          location: 'Algiers',
          interests: [Cat.HEALTH],
          availability: [Av.WEEKENDS],
        },
        {
          skills: [need('s', 4)],
          location: 'Algiers',
          category: Cat.HEALTH,
          availability: [Av.WEEKENDS],
        },
      );
      const snapshot = JSON.stringify(data);
      const a = strategy.compute(data);
      const b = strategy.compute(data);
      expect(a).toEqual(b);
      expect(JSON.stringify(data)).toBe(snapshot);
    });

    it('always stays within 0–100 and the contributions add up to the score', () => {
      const cases: MatchInput[] = [
        input(),
        input(
          { skills: [have('a', Lv.BEGINNER)], location: 'x' },
          {
            skills: [need('a', 1), need('b', 2), need('c', 5)],
            location: 'y',
            category: Cat.HEALTH,
          },
        ),
        input(
          {
            skills: [have('a', Lv.INTERMEDIATE)],
            location: 'x',
            interests: [Cat.SPORTS],
            availability: [Av.FLEXIBLE],
          },
          {
            skills: [need('a', 2), need('b', 3)],
            location: 'x',
            category: Cat.SPORTS,
            availability: [Av.EVENINGS],
          },
        ),
      ];
      for (const c of cases) {
        const r = strategy.compute(c);
        const sum = Object.values(r.breakdown).reduce((s, b) => s + b.contribution, 0);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
        expect(Math.abs(sum - r.score)).toBeLessThanOrEqual(0.5 + 0.2); // rounding only
      }
    });

    it('score() returns the same result asynchronously (the MatchStrategy contract)', async () => {
      const data = input({ location: 'Algiers' }, { location: 'Algiers' });
      await expect(strategy.score(data)).resolves.toEqual(strategy.compute(data));
    });
  });
});
