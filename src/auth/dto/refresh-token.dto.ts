import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'The refresh token issued at login/refresh for this device.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  refreshToken: string;
}
