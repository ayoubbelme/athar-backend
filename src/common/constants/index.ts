export const PAGINATION_DEFAULT_PAGE = 1;
export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

export const API_DOCS_PATH = 'api/docs';

/** Swagger tags — one per module, kept here so docs stay consistent. */
export const API_TAGS = {
  AUTH: 'Auth',
  USERS: 'Users',
  VOLUNTEERS: 'Volunteers',
  ORGANIZATIONS: 'Organizations',
  SKILLS: 'Skills',
  PROJECTS: 'Projects',
  APPLICATIONS: 'Applications',
  MATCHING: 'Matching',
  IMPACT: 'Impact',
  HEALTH: 'Health',
} as const;

export const BEARER_AUTH_NAME = 'access-token';

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];
