import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ProjectCategory } from '@prisma/client';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { trim } from '../../common/utils/transform.util';

export const IMPACT_LIMITS = {
  count: 1_000_000_000, // fits a PostgreSQL integer
  volunteers: 1_000_000,
  hours: 9_999_999, // Decimal(10,2)
} as const;

/** `hours` is a decimal with at most two fractional digits (e.g. 12.5). */
const HOURS_OPTIONS = { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 } as const;

export class CreateImpactDto {
  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Volunteers who took part. Defaults to the number of ACCEPTED applications; send it to override (e.g. walk-ins).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(IMPACT_LIMITS.volunteers)
  volunteersCount?: number;

  @ApiPropertyOptional({
    minimum: 0,
    example: 192.5,
    description: 'Total volunteer hours (max 2 decimals)',
  })
  @IsOptional()
  @IsNumber(HOURS_OPTIONS)
  @Min(0)
  @Max(IMPACT_LIMITS.hours)
  hours?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(IMPACT_LIMITS.count)
  activitiesCount?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'People who benefited' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(IMPACT_LIMITS.count)
  beneficiariesCount?: number;

  @ApiPropertyOptional({ maxLength: 2000, example: 'Gloves, bags, recycling bins' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  resources?: string;

  @ApiPropertyOptional({ maxLength: 5000, description: 'Results and outcomes' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  description?: string;
}

/** Partial update: omitted = unchanged; `null` clears `resources` / `description`. */
export class UpdateImpactDto {
  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(IMPACT_LIMITS.volunteers)
  volunteersCount?: number;

  @ApiPropertyOptional({ minimum: 0, example: 192.5 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber(HOURS_OPTIONS)
  @Min(0)
  @Max(IMPACT_LIMITS.hours)
  hours?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(IMPACT_LIMITS.count)
  activitiesCount?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(IMPACT_LIMITS.count)
  beneficiariesCount?: number;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  resources?: string | null;

  @ApiPropertyOptional({ maxLength: 5000, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  description?: string | null;
}

export class OrganizationStatsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'ADMIN only (required for admins): which organization profile to report on.',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

// ───────────────────────── Responses ─────────────────────────

export class ImpactResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) projectId: string;
  @ApiProperty({ description: 'Reported number of participating volunteers' })
  volunteersCount: number;
  @ApiProperty({ description: 'Live number of ACCEPTED applications, for comparison' })
  acceptedVolunteers: number;
  @ApiProperty({ example: 192.5 }) hours: number;
  @ApiProperty() activitiesCount: number;
  @ApiProperty() beneficiariesCount: number;
  @ApiPropertyOptional({ nullable: true }) resources: string | null;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ImpactTotalsDto {
  @ApiProperty({ description: 'Projects (not cancelled) that have an impact record' })
  projectsWithImpact: number;
  @ApiProperty() volunteersCount: number;
  @ApiProperty() hours: number;
  @ApiProperty() activitiesCount: number;
  @ApiProperty() beneficiariesCount: number;
}

export class CategoryImpactDto extends ImpactTotalsDto {
  @ApiProperty({
    enum: ProjectCategory,
    nullable: true,
    description: 'null = projects without a category',
  })
  category: ProjectCategory | null;
}

export class ProjectCountsDto {
  @ApiProperty() total: number;
  @ApiProperty() draft: number;
  @ApiProperty() published: number;
  @ApiProperty() inProgress: number;
  @ApiProperty() completed: number;
  @ApiProperty() cancelled: number;
}

export class OrganizationImpactStatsDto {
  @ApiProperty({ format: 'uuid' }) organizationId: string;
  @ApiProperty({ type: ProjectCountsDto }) projects: ProjectCountsDto;
  @ApiProperty({ type: ImpactTotalsDto }) impact: ImpactTotalsDto;
  @ApiProperty({
    description: 'Distinct volunteers with an ACCEPTED application (cancelled projects excluded)',
  })
  uniqueVolunteers: number;
  @ApiProperty({ type: [CategoryImpactDto] }) byCategory: CategoryImpactDto[];
}

export class PlatformImpactStatsDto {
  @ApiProperty({ description: 'Organizations with an ACTIVE account' }) organizations: number;
  @ApiProperty({ description: 'Volunteers with an ACTIVE account' }) volunteers: number;
  @ApiProperty({ type: ProjectCountsDto }) projects: ProjectCountsDto;
  @ApiProperty({ type: ImpactTotalsDto }) impact: ImpactTotalsDto;
  @ApiProperty({
    description: 'Distinct volunteers with an ACCEPTED application (cancelled projects excluded)',
  })
  uniqueVolunteers: number;
  @ApiProperty({ type: [CategoryImpactDto] }) byCategory: CategoryImpactDto[];
}
