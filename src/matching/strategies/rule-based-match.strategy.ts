import { Injectable } from '@nestjs/common';
import { Availability } from '@prisma/client';
import {
  MATCH_WEIGHTS,
  PROFICIENCY_PERCENT,
  RULE_BASED_STRATEGY_NAME,
} from '../matching.constants';
import {
  ComponentBreakdown,
  MatchInput,
  MatchResult,
  MatchStrategy,
  MatchedSkill,
  MissingSkill,
} from '../interfaces/match.interfaces';
import { locationsMatch } from '../utils/location.util';

type ComponentKey = keyof typeof MATCH_WEIGHTS;

interface Component {
  applicable: boolean;
  /** 0–1 */
  ratio: number;
}

/**
 * Explainable, deterministic scoring (version 1):
 *
 *   score = 100 × Σ (weight_i × fit_i) / Σ weight_i      over the *applicable* components
 *
 *   skills        50  importance-weighted share of required skills the volunteer has,
 *                     scaled by proficiency (BEGINNER 60 %, INTERMEDIATE 80 %, ADVANCED/EXPERT 100 %)
 *   location      20  volunteer and project share a location token (e.g. the city)
 *   interest      20  project category is among the volunteer's interests
 *   availability  10  volunteer is FLEXIBLE or shares a slot with the project
 *
 * A component is applicable only if the project specifies something for it (required skills,
 * a location, a category, a non-FLEXIBLE availability). Components a project does not specify are
 * left out and the remaining weights are re-normalized, so projects with few requirements are
 * neither inflated nor penalized. When nothing is applicable the score is 0.
 */
@Injectable()
export class RuleBasedMatchStrategy implements MatchStrategy {
  readonly name = RULE_BASED_STRATEGY_NAME;

  score(input: MatchInput): Promise<MatchResult> {
    return Promise.resolve(this.compute(input));
  }

  /** Pure and synchronous; exposed for direct use in tests. */
  compute({ volunteer, project }: MatchInput): MatchResult {
    // ── skills ──
    const held = new Map(volunteer.skills.map((s) => [s.skillId, s]));
    const matchedSkills: MatchedSkill[] = [];
    const missingSkills: MissingSkill[] = [];
    let earned = 0; // importance × percent (integers → exact arithmetic)
    let possible = 0;

    for (const required of project.skills) {
      possible += required.importance * 100;
      const have = held.get(required.skillId);
      if (have) {
        earned += required.importance * PROFICIENCY_PERCENT[have.proficiency];
        matchedSkills.push({
          skillId: required.skillId,
          name: required.name,
          importance: required.importance,
          proficiency: have.proficiency,
        });
      } else {
        missingSkills.push({
          skillId: required.skillId,
          name: required.name,
          importance: required.importance,
        });
      }
    }
    const skills: Component = {
      applicable: project.skills.length > 0,
      ratio: possible > 0 ? earned / possible : 0,
    };

    // ── location ──
    const locationApplicable = Boolean(project.location?.trim());
    const locationHit = locationApplicable && locationsMatch(volunteer.location, project.location);
    const location: Component = { applicable: locationApplicable, ratio: locationHit ? 1 : 0 };

    // ── interest ──
    const interestApplicable = project.category !== null;
    const interestHit = interestApplicable && volunteer.interests.includes(project.category!);
    const interest: Component = { applicable: interestApplicable, ratio: interestHit ? 1 : 0 };

    // ── availability ──
    const availabilityApplicable =
      project.availability.length > 0 && !project.availability.includes(Availability.FLEXIBLE);
    const availabilityHit =
      availabilityApplicable &&
      (volunteer.availability.includes(Availability.FLEXIBLE) ||
        project.availability.some((slot) => volunteer.availability.includes(slot)));
    const availability: Component = {
      applicable: availabilityApplicable,
      ratio: availabilityHit ? 1 : 0,
    };

    // ── combine ──
    const components: Record<ComponentKey, Component> = {
      skills,
      location,
      interest,
      availability,
    };
    const keys = Object.keys(components) as ComponentKey[];
    const totalWeight = keys.reduce(
      (sum, key) => sum + (components[key].applicable ? MATCH_WEIGHTS[key] : 0),
      0,
    );
    const points = (key: ComponentKey): number =>
      totalWeight > 0 && components[key].applicable
        ? (100 * MATCH_WEIGHTS[key] * components[key].ratio) / totalWeight
        : 0;

    const raw = keys.reduce((sum, key) => sum + points(key), 0);
    const breakdownOf = (key: ComponentKey): ComponentBreakdown => ({
      weight: MATCH_WEIGHTS[key],
      applicable: components[key].applicable,
      ratio: components[key].applicable ? round(components[key].ratio, 3) : null,
      contribution: round(points(key), 1),
    });

    return {
      // The epsilon keeps exact .5 values (e.g. 92.5) from being lost to floating point noise.
      score: Math.min(100, Math.max(0, Math.round(raw + 1e-9))),
      matchedSkills,
      missingSkills,
      locationMatch: location.applicable ? locationHit : null,
      interestMatch: interest.applicable ? interestHit : null,
      availabilityMatch: availability.applicable ? availabilityHit : null,
      breakdown: {
        skills: breakdownOf('skills'),
        location: breakdownOf('location'),
        interest: breakdownOf('interest'),
        availability: breakdownOf('availability'),
      },
      strategy: this.name,
    };
  }
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor + 1e-9) / factor;
};
