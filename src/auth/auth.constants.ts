export const DEFAULT_AUTH_THROTTLE_LIMIT = 10;

/**
 * Brute-force protection for credential endpoints (per IP, per route, per minute).
 * The limit is resolved on every request from THROTTLE_AUTH_LIMIT (validated at startup).
 */
export const AUTH_THROTTLE = {
  default: {
    limit: (): number => Number(process.env.THROTTLE_AUTH_LIMIT ?? DEFAULT_AUTH_THROTTLE_LIMIT),
    ttl: 60_000,
  },
};

/**
 * If a rotated-out refresh token is presented again within this window we treat it as
 * a benign client race (e.g. two parallel requests both refreshing) and just reject it.
 * Outside the window it is treated as token theft and the whole session is revoked.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

export const JWT_ALGORITHM = 'HS256';
