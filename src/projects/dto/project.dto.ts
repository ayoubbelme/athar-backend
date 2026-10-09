import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ProjectStatus } from '@prisma/client';
import { SORT_ORDERS, SortOrder } from '../../common/constants';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { trim } from '../../common/utils/transform.util';

export const MAX_PROJECT_SKILLS = 30;
export const CREATABLE_STATUSES = [ProjectStatus.DRAFT, ProjectStatus.PUBLISHED] as const;

// ───────────────────────── Required skills ─────────────────────────

export class ProjectSkillInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skillId: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 1000,
    default: 1,
    description: 'Volunteers needed with this skill',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  requiredCount?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    default: 3,
    description: 'Weight in matching: 1 = nice to have … 5 = critical',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(5)
  importance?: number;
}

export class ReplaceProjectSkillsDto {
  @ApiProperty({ type: [ProjectSkillInputDto], description: 'The complete set. Send [] to clear.' })
  @ArrayMaxSize(MAX_PROJECT_SKILLS)
  @ArrayUnique((s: ProjectSkillInputDto) => s.skillId, {
    message: 'skills must not contain the same skillId twice',
  })
  @ValidateNested({ each: true })
  @Type(() => ProjectSkillInputDto)
  skills: ProjectSkillInputDto[];
}

// ───────────────────────── Create / update ─────────────────────────

export class CreateProjectDto {
  @ApiProperty({ example: 'Community Health Awareness Day', minLength: 3, maxLength: 150 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title: string;

  @ApiProperty({ minLength: 10, maxLength: 5000 })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description: string;

  @ApiPropertyOptional({ example: 'Algiers', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  location?: string;

  @ApiPropertyOptional({ example: '2026-11-14T09:00:00Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional({
    example: '2026-11-14T17:00:00Z',
    description: 'Must not be before startDate',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  @ApiPropertyOptional({ minimum: 1, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxVolunteers?: number;

  @ApiPropertyOptional({ enum: CREATABLE_STATUSES, default: ProjectStatus.DRAFT })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(CREATABLE_STATUSES)
  status?: (typeof CREATABLE_STATUSES)[number];

  @ApiPropertyOptional({ type: [ProjectSkillInputDto] })
  @IsOptional()
  @ArrayMaxSize(MAX_PROJECT_SKILLS)
  @ArrayUnique((s: ProjectSkillInputDto) => s.skillId, {
    message: 'skills must not contain the same skillId twice',
  })
  @ValidateNested({ each: true })
  @Type(() => ProjectSkillInputDto)
  skills?: ProjectSkillInputDto[];
}

/**
 * Partial update. Omitted = unchanged; `null` clears location / dates / maxVolunteers.
 * Required skills are changed via PUT /projects/:id/skills.
 */
export class UpdateProjectDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 150 })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({ minLength: 10, maxLength: 5000 })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 10000, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxVolunteers?: number | null;

  @ApiPropertyOptional({
    enum: ProjectStatus,
    description:
      'Validated lifecycle: DRAFT→PUBLISHED→IN_PROGRESS→COMPLETED; any non-final state→CANCELLED.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}

// ───────────────────────── Listing ─────────────────────────

export const PROJECT_SORT_FIELDS = ['createdAt', 'startDate', 'endDate', 'title'] as const;

export class ListProjectsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive match on title or description' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive partial match' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  location?: string;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Projects requiring this skill' })
  @IsOptional()
  @IsUUID()
  skillId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Organization profile id' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ example: '2026-11-01', description: 'startDate on or after' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDateFrom?: Date;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'startDate on or before' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDateTo?: Date;

  @ApiPropertyOptional({ enum: PROJECT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(PROJECT_SORT_FIELDS)
  sortBy: (typeof PROJECT_SORT_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({ enum: SORT_ORDERS, default: 'desc' })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  order: SortOrder = 'desc';
}

// ───────────────────────── Responses ─────────────────────────

class ProjectOrganizationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) logo: string | null;
  @ApiPropertyOptional({ nullable: true }) location: string | null;
}

class ProjectSkillSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
}

export class ProjectSkillResponseDto {
  @ApiProperty({ type: ProjectSkillSummaryDto }) skill: ProjectSkillSummaryDto;
  @ApiProperty() requiredCount: number;
  @ApiProperty({ minimum: 1, maximum: 5 }) importance: number;
}

export class ProjectResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) organizationId: string;
  @ApiProperty() title: string;
  @ApiProperty() description: string;
  @ApiPropertyOptional({ nullable: true }) location: string | null;
  @ApiPropertyOptional({ nullable: true }) startDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) endDate: Date | null;
  @ApiProperty({ enum: ProjectStatus }) status: ProjectStatus;
  @ApiPropertyOptional({ nullable: true }) maxVolunteers: number | null;
  @ApiProperty({ description: 'Number of ACCEPTED applications' }) acceptedVolunteers: number;
  @ApiProperty({ type: ProjectOrganizationDto }) organization: ProjectOrganizationDto;
  @ApiProperty({ type: [ProjectSkillResponseDto] }) skills: ProjectSkillResponseDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
