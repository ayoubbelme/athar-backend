import { ProficiencyLevel } from '@prisma/client';

/** Weights of the four components (sum = 100). */
export const MATCH_WEIGHTS = {
  skills: 50,
  location: 20,
  interest: 20,
  availability: 10,
} as const;

/**
 * How much of a required skill's importance a volunteer earns, by proficiency.
 * Stored as integer percentages so scoring uses exact integer arithmetic.
 */
export const PROFICIENCY_PERCENT: Readonly<Record<ProficiencyLevel, number>> = {
  [ProficiencyLevel.BEGINNER]: 60,
  [ProficiencyLevel.INTERMEDIATE]: 80,
  [ProficiencyLevel.ADVANCED]: 100,
  [ProficiencyLevel.EXPERT]: 100,
};

export const RULE_BASED_STRATEGY_NAME = 'rule-based-v1';

/**
 * Recommendations are scored in memory over the newest open projects.
 * Bounded so a large catalogue can never make one request unbounded.
 */
export const MAX_RECOMMENDATION_CANDIDATES = 500;
