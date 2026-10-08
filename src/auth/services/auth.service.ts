import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { ClientInfo } from '../../common/decorators/client-info.decorator';
import { PublicUser, UsersService } from '../../users/users.service';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';
import { PasswordService } from './password.service';
import { TokenPair, TokenService } from './token.service';

export interface AuthResult {
  user: PublicUser;
  tokens: TokenPair;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterDto, client: ClientInfo): Promise<AuthResult> {
    const user = await this.users.create({
      name: dto.name,
      email: dto.email,
      passwordHash: await this.passwords.hash(dto.password),
      role: dto.role,
      location: dto.location,
      organizationName: dto.organizationName,
    });
    this.logger.log(`User registered (id=${user.id}, role=${user.role})`);
    return { user, tokens: await this.tokens.issueSession(user.id, client) };
  }

  async login(dto: LoginDto, client: ClientInfo): Promise<AuthResult> {
    const account = await this.users.findByEmailWithPassword(dto.email);

    // Same response and similar timing for "unknown email" and "wrong password".
    let valid = false;
    if (account) {
      valid = await this.passwords.verify(account.passwordHash, dto.password);
    } else {
      await this.passwords.verifyDummy(dto.password);
    }
    if (!account || !valid) {
      this.logger.warn(`Login failed (ip=${client.ip ?? 'unknown'})`);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Only revealed after the password is proven correct.
    if (account.status !== AccountStatus.ACTIVE) {
      this.logger.warn(`Login blocked for suspended account (id=${account.id})`);
      throw new ForbiddenException('Account is suspended');
    }

    const user = await this.users.findPublicById(account.id);
    if (!user) throw new UnauthorizedException('Invalid email or password');

    this.logger.log(`Login succeeded (id=${user.id})`);
    return { user, tokens: await this.tokens.issueSession(user.id, client) };
  }

  refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    return this.tokens.refresh(refreshToken, client);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revokeSession(refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokens.revokeAllSessions(userId);
    this.logger.log(`All sessions revoked (id=${userId})`);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findPublicById(userId);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
