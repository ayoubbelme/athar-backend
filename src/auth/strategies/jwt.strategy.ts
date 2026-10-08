import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { AccountStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AppConfig } from '../../config/configuration';
import { UsersService } from '../../users/users.service';
import { JWT_ALGORITHM } from '../auth.constants';
import { AccessTokenPayload } from '../interfaces/token-payloads.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt.accessSecret', { infer: true }),
      algorithms: [JWT_ALGORITHM],
    });
  }

  /**
   * Role and status come from the database on every request, so suspending a
   * user or changing a role takes effect immediately instead of at token expiry.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.users.findPublicById(payload.sub);
    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid or missing access token');
    }
    return { id: user.id, email: user.email, role: user.role };
  }
}
