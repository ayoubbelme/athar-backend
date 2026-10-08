export interface AccessTokenPayload {
  /** User id. Role and status are always read from the database, never trusted from the token. */
  sub: string;
}

export interface RefreshTokenPayload {
  sub: string;
  /** RefreshToken row id (device session token). */
  sid: string;
  /** Session family: all rotations of one login share it. */
  fam: string;
}
