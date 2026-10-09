import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ProficiencyLevel } from '@prisma/client';
import { trim } from '../../common/utils/transform.util';

const PHONE_REGEX = /^\+?[0-9][0-9\s\-().]{5,19}$/;

/** All fields optional. Send `null` to clear a field; omit it to leave it unchanged. */
export class UpdateVolunteerProfileDto {
  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  bio?: string | null;

  @ApiPropertyOptional({ example: '+213 555 12 34 56', nullable: true })
  @IsOptional()
  @Transform(trim)
  @Matches(PHONE_REGEX, { message: 'phone must be a valid phone number' })
  phone?: string | null;

  @ApiPropertyOptional({ example: 'Algiers', maxLength: 100, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @ApiPropertyOptional({ example: 'Weekends and evenings', maxLength: 200, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  availability?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  experience?: string | null;
}

export class VolunteerProfileResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiPropertyOptional({ nullable: true }) bio: string | null;
  @ApiPropertyOptional({ nullable: true }) phone: string | null;
  @ApiPropertyOptional({ nullable: true }) location: string | null;
  @ApiPropertyOptional({ nullable: true }) availability: string | null;
  @ApiPropertyOptional({ nullable: true }) experience: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class AddUserSkillDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skillId: string;

  @ApiPropertyOptional({ enum: ProficiencyLevel, default: ProficiencyLevel.BEGINNER })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(ProficiencyLevel)
  proficiency?: ProficiencyLevel;
}

export class UpdateUserSkillDto {
  @ApiProperty({ enum: ProficiencyLevel })
  @IsEnum(ProficiencyLevel)
  proficiency: ProficiencyLevel;
}

class UserSkillSkillDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
}

export class UserSkillResponseDto {
  @ApiProperty({ type: UserSkillSkillDto }) skill: UserSkillSkillDto;
  @ApiProperty({ enum: ProficiencyLevel }) proficiency: ProficiencyLevel;
  @ApiProperty() createdAt: Date;
}
