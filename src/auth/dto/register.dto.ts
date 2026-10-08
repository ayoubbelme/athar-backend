import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Role } from '@prisma/client';
import { normalizeEmail, trim } from '../../common/utils/transform.util';

export const SELF_REGISTRATION_ROLES = [Role.VOLUNTEER, Role.ORGANIZATION] as const;

export class RegisterDto {
  @ApiProperty({ example: 'Amina Benali', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'amina@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: 'Str0ngPassw0rd',
    minLength: 8,
    maxLength: 128,
    description: 'At least 8 characters, with at least one letter and one digit.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password: string;

  @ApiProperty({
    enum: SELF_REGISTRATION_ROLES,
    description: 'ADMIN accounts cannot be self-registered.',
  })
  @IsIn(SELF_REGISTRATION_ROLES)
  role: (typeof SELF_REGISTRATION_ROLES)[number];

  @ApiPropertyOptional({
    example: 'Green Hands Association',
    description: 'Required when role is ORGANIZATION.',
  })
  @ValidateIf((o: RegisterDto) => o.role === Role.ORGANIZATION)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  organizationName?: string;

  @ApiPropertyOptional({ example: 'Algiers' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  location?: string;
}
