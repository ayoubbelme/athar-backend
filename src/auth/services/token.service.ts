import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { AccountStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { ClientInfo } from '../../common/decorators/client-info.decorator';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { JWT_ALGORITHM, REFRESH_REUSE_GRACE_MS } from '../auth.constants';
import { AccessTokenPayload, RefreshTokenPayload } from '../interfaces/token-payloads.interface';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

/**
 * Owns the token lifecycle. Each login creates an independent device session
 * (a "family" of rotating refresh tokens), which is what enables multi-device login.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** Starts a brand-new device session (login / registration). */
  async issueSession(userId: string, client: ClientInfo): Promise<TokenPair> {
    // Housekeeping without a scheduler: drop this user's expired sessions on each login.
    await this.prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });
    const refreshToken = await this.createRefreshToken(this.prisma, userId, randomUUID(), client);
    return { ...(await this.signAccessToken(userId)), refreshToken };
  }

  /** Exchanges a refresh token for a new pair, rotating the refresh token (single use). */
  async refresh(token: string, client: ClientInfo): Promise<TokenPair> {
    const payload = await this.verifyRefreshJwt(token);

    const stored = await this.prisma.refreshToken.findUnique({ where: { id: payload.sid } });
    if (
      !stored ||
      stored.userId !== payload.sub ||
      !this.safeEqual(stored.tokenHash, this.hash(token))
    ) {
      throw this.invalidRefreshToken();
    }

    if (stored.revokedAt) {
      const withinGrace = Date.now() - stored.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;
      if (!withinGrace) {
        await this.revokeFamily(stored.familyId);
        this.logger.warn(`Refresh token reuse detected; session revoked (user=${stored.userId})`);
      }
      throw this.invalidRefreshToken();
    }

    const user = await this.users.findPublicById(stored.userId);
    if (!user) throw this.invalidRefreshToken();
    if (user.status !== AccountStatus.ACTIVE) {
      await this.revokeFamily(stored.familyId);
      throw new ForbiddenException('Account is suspended');
    }

    // Atomic rotation: only one concurrent request can revoke the old token.
    const refreshToken = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) return null;
      return this.createRefreshToken(tx, stored.userId, stored.familyId, client);
    });
    if (!refreshToken) throw this.invalidRefreshToken(); // lost a benign race

    return { ...(await this.signAccessToken(user.id)), refreshToken };
  }

  /** Ends the single device session this token belongs to. Idempotent, never throws. */
  async revokeSession(token: string): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      // Expired tokens may still be used to sign out.
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.get('jwt.refreshSecret', { infer: true }),
        algorithms: [JWT_ALGORITHM],
        ignoreExpiration: true,
      });
    } catch {
      return;
    }
    const stored = await this.prisma.refreshToken.findUnique({ where: { id: payload.sid } });
    if (stored && this.safeEqual(stored.tokenHash, this.hash(token))) {
      await this.revokeFamily(stored.familyId);
    }
  }

  /** Ends every device session of a user. */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ── internals ──────────────────────────────────────────────

  private revokeFamily(familyId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async signAccessToken(
    userId: string,
  ): Promise<Pick<TokenPair, 'accessToken' | 'accessTokenExpiresAt'>> {
    const payload: AccessTokenPayload = { sub: userId };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('jwt.accessSecret', { infer: true }),
      expiresIn: this.config.get('jwt.accessExpiresIn', {
        infer: true,
      }) as JwtSignOptions['expiresIn'],
      algorithm: JWT_ALGORITHM,
    });
    const { exp } = this.jwt.decode<{ exp: number }>(accessToken);
    return { accessToken, accessTokenExpiresAt: new Date(exp * 1000).toISOString() };
  }

  private async createRefreshToken(
    db: Prisma.TransactionClient,
    userId: string,
    familyId: string,
    client: ClientInfo,
  ): Promise<string> {
    const id = randomUUID();
    const payload: RefreshTokenPayload = { sub: userId, sid: id, fam: familyId };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.get('jwt.refreshSecret', { infer: true }),
      expiresIn: this.config.get('jwt.refreshExpiresIn', {
        infer: true,
      }) as JwtSignOptions['expiresIn'],
      algorithm: JWT_ALGORITHM,
    });
    const { exp } = this.jwt.decode<{ exp: number }>(token);

    await db.refreshToken.create({
      data: {
        id,
        userId,
        familyId,
        tokenHash: this.hash(token),
        expiresAt: new Date(exp * 1000),
        userAgent: client.userAgent,
        ip: client.ip,
      },
    });
    return token;
  }

  private async verifyRefreshJwt(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.get('jwt.refreshSecret', { infer: true }),
        algorithms: [JWT_ALGORITHM],
      });
    } catch {
      throw this.invalidRefreshToken();
    }
  }

  private invalidRefreshToken(): UnauthorizedException {
    return new UnauthorizedException('Invalid refresh token');
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
