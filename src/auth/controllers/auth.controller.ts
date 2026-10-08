import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { API_TAGS, BEARER_AUTH_NAME } from '../../common/constants';
import { Client, ClientInfo } from '../../common/decorators/client-info.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { AUTH_THROTTLE } from '../auth.constants';
import { AuthResponseDto, TokenPairDto } from '../dto/auth-response.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { RegisterDto } from '../dto/register.dto';
import { AuthResult, AuthService } from '../services/auth.service';
import { TokenPair } from '../services/token.service';

@ApiTags(API_TAGS.AUTH)
@ApiResponse({ status: 429, description: 'Too many requests', type: ErrorResponseDto })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @ApiOperation({
    summary: 'Register a volunteer or organization account',
    description:
      'Creates the account and its empty profile, and signs the user in on this device. ' +
      '`organizationName` is required for ORGANIZATION. ADMIN cannot self-register.',
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Email already registered', type: ErrorResponseDto })
  register(@Body() dto: RegisterDto, @Client() client: ClientInfo): Promise<AuthResult> {
    return this.auth.register(dto, client);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in on this device',
    description: 'Each login creates an independent session; other devices stay signed in.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid email or password', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Account suspended', type: ErrorResponseDto })
  login(@Body() dto: LoginDto, @Client() client: ClientInfo): Promise<AuthResult> {
    return this.auth.login(dto, client);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate tokens',
    description:
      'Exchanges a refresh token for a new access + refresh token. The old refresh token ' +
      'becomes invalid. Re-using an old token revokes that device session.',
  })
  @ApiOkResponse({ type: TokenPairDto })
  @ApiResponse({ status: 401, description: 'Invalid refresh token', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Account suspended', type: ErrorResponseDto })
  refresh(@Body() dto: RefreshTokenDto, @Client() client: ClientInfo): Promise<TokenPair> {
    return this.auth.refresh(dto.refreshToken, client);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Log out this device',
    description:
      'Revokes the device session of the given refresh token. Idempotent; works even if the ' +
      'access token has already expired.',
  })
  @ApiNoContentResponse({ description: 'Signed out' })
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth(BEARER_AUTH_NAME)
  @ApiOperation({ summary: 'Log out every device of the current user' })
  @ApiNoContentResponse({ description: 'All sessions revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
  logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.auth.logoutAll(user.id);
  }

  @Get('me')
  @ApiBearerAuth(BEARER_AUTH_NAME)
  @ApiOperation({ summary: 'Get the authenticated user' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponseDto> {
    return this.auth.me(user.id);
  }
}
