import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ApplicationStatus,
  Availability,
  ProficiencyLevel,
  ProjectCategory,
  ProjectStatus,
} from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SORT_ORDERS, SortOrder } from '../../common/constants';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { trim } from '../../common/utils/transform.util';
import { REVIEW_DECISIONS } from '../utils/application-status.util';

export class CreateApplicationDto {
  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Why you want to join (shown to the organization)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class UpdateApplicationStatusDto {
  @ApiProperty({ enum: REVIEW_DECISIONS, description: 'Organizations can only accept or reject.' })
  @IsIn(REVIEW_DECISIONS)
  status: (typeof REVIEW_DECISIONS)[number];
}

export const MY_APPLICATION_SORT_FIELDS = ['createdAt', 'updatedAt'] as const;
export const PROJECT_APPLICATION_SORT_FIELDS = ['createdAt', 'matchScore'] as const;

export class ListMyApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ApplicationStatus })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @ApiPropertyOptional({ enum: MY_APPLICATION_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(MY_APPLICATION_SORT_FIELDS)
  sortBy: (typeof MY_APPLICATION_SORT_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({ enum: SORT_ORDERS, default: 'desc' })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  order: SortOrder = 'desc';
}

export class ListProjectApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ApplicationStatus })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @ApiPropertyOptional({ enum: PROJECT_APPLICATION_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(PROJECT_APPLICATION_SORT_FIELDS)
  sortBy: (typeof PROJECT_APPLICATION_SORT_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({ enum: SORT_ORDERS, default: 'desc' })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  order: SortOrder = 'desc';
}

// ───────────────────────── Responses ─────────────────────────

class ApplicationProjectOrganizationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) logo: string | null;
}

class ApplicationProjectDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: ProjectStatus }) status: ProjectStatus;
  @ApiPropertyOptional({ nullable: true }) location: string | null;
  @ApiPropertyOptional({ nullable: true }) startDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) endDate: Date | null;
  @ApiProperty({ type: ApplicationProjectOrganizationDto })
  organization: ApplicationProjectOrganizationDto;
}

/** An application as the volunteer sees it. */
export class MyApplicationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ApplicationStatus }) status: ApplicationStatus;
  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 100 }) matchScore: number | null;
  @ApiPropertyOptional({ nullable: true }) message: string | null;
  @ApiProperty({ type: ApplicationProjectDto }) project: ApplicationProjectDto;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

class ApplicantSkillDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ProficiencyLevel }) proficiency: ProficiencyLevel;
}

class ApplicantContactDto {
  @ApiProperty() email: string;
  @ApiPropertyOptional({ nullable: true }) phone: string | null;
}

class ApplicantDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) location: string | null;
  @ApiProperty({ enum: Availability, isArray: true }) availability: Availability[];
  @ApiProperty({ enum: ProjectCategory, isArray: true }) interests: ProjectCategory[];
  @ApiPropertyOptional({ nullable: true }) bio: string | null;
  @ApiPropertyOptional({ nullable: true }) experience: string | null;
  @ApiProperty({ type: [ApplicantSkillDto] }) skills: ApplicantSkillDto[];
  @ApiPropertyOptional({
    type: ApplicantContactDto,
    nullable: true,
    description: 'Revealed only once the application is ACCEPTED (always visible to ADMIN).',
  })
  contact: ApplicantContactDto | null;
}

/** An application as the organization reviewing it sees it. */
export class ReviewApplicationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) projectId: string;
  @ApiProperty({ enum: ApplicationStatus }) status: ApplicationStatus;
  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 100 }) matchScore: number | null;
  @ApiPropertyOptional({ nullable: true }) message: string | null;
  @ApiProperty({ type: ApplicantDto }) volunteer: ApplicantDto;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
