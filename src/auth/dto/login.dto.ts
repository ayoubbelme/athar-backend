import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail } from '../../common/utils/transform.util';

export class LoginDto {
  @ApiProperty({ example: 'volunteer@athar.dev' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Volunteer#Demo2026' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}
