import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class TokenPairDto {
  @ApiProperty({ description: 'Short-lived JWT. Send as `Authorization: Bearer <token>`.' })
  accessToken: string;

  @ApiProperty({ description: 'Long-lived, single-use token. Rotates on every refresh.' })
  refreshToken: string;

  @ApiProperty({ example: '2026-01-01T00:15:00.000Z' })
  accessTokenExpiresAt: string;
}

export class AuthResponseDto {
  @ApiProperty({ type: UserResponseDto }) user: UserResponseDto;
  @ApiProperty({ type: TokenPairDto }) tokens: TokenPairDto;
}
