import { Availability, ProficiencyLevel, ProjectCategory } from '@prisma/client';

/** What the matcher knows about a volunteer. Plain data: no database types leak in. */
export interface VolunteerMatchProfile {
  skills: Array<{ skillId: string; name: string; proficiency: ProficiencyLevel }>;
  location: string | null;
  interests: ProjectCategory[];
  availability: Availability[];
}

/** What a project asks for. */
export interface ProjectMatchRequirements {
  skills: Array<{ skillId: string; name: string; importance: number; requiredCount: number }>;
  location: string | null;
  category: ProjectCategory | null;
  availability: Availability[];
}

export interface MatchInput {
  volunteer: VolunteerMatchProfile;
  project: ProjectMatchRequirements;
}

export interface MatchedSkill {
  skillId: string;
  name: string;
  importance: number;
  proficiency: ProficiencyLevel;
}

export interface MissingSkill {
  skillId: string;
  name: string;
  importance: number;
}

/** How one component contributed to the final score. */
export interface ComponentBreakdown {
  /** Nominal weight (50 / 20 / 20 / 10). */
  weight: number;
  /** False when the project does not ask for anything in this component: it is then ignored. */
  applicable: boolean;
  /** 0–1 degree of fit, or null when not applicable. */
  ratio: number | null;
  /** Points this component adds to the 0–100 score (after re-normalizing applicable weights). */
  contribution: number;
}

export interface MatchResult {
  /** 0–100 */
  score: number;
  matchedSkills: MatchedSkill[];
  missingSkills: MissingSkill[];
  /** null = the project does not specify it, so it was not scored. */
  locationMatch: boolean | null;
  interestMatch: boolean | null;
  availabilityMatch: boolean | null;
  breakdown: {
    skills: ComponentBreakdown;
    location: ComponentBreakdown;
    interest: ComponentBreakdown;
    availability: ComponentBreakdown;
  };
  /** Which algorithm produced this result (useful once several exist). */
  strategy: string;
}

/**
 * The seam for replacing the algorithm: implement this (e.g. with an ML model that calls
 * an external service — hence async) and bind it to MATCH_STRATEGY in MatchingModule.
 * Nothing else in the application depends on how the score is computed.
 */
export interface MatchStrategy {
  readonly name: string;
  score(input: MatchInput): Promise<MatchResult>;
}

export const MATCH_STRATEGY = Symbol('MATCH_STRATEGY');
