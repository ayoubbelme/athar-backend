import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ProficiencyLevel, ProjectStatus } from '@prisma/client';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ProjectResponseDto } from '../../projects/dto/project.dto';

export class RecommendationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100,
    default: 0,
    description: 'Hide projects scoring below this',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore: number = 0;
}

class MatchedSkillDto {
  @ApiProperty({ format: 'uuid' }) skillId: string;
  @ApiProperty() name: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) importance: number;
  @ApiProperty({ enum: ProficiencyLevel }) proficiency: ProficiencyLevel;
}

class MissingSkillDto {
  @ApiProperty({ format: 'uuid' }) skillId: string;
  @ApiProperty() name: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) importance: number;
}

class ComponentBreakdownDto {
  @ApiProperty({ example: 50 }) weight: number;
  @ApiProperty({ description: 'False = the project specifies nothing here, so it was not scored' })
  applicable: boolean;
  @ApiProperty({ nullable: true, minimum: 0, maximum: 1 }) ratio: number | null;
  @ApiProperty({ description: 'Points this component adds to the final score' })
  contribution: number;
}

class MatchBreakdownDto {
  @ApiProperty({ type: ComponentBreakdownDto }) skills: ComponentBreakdownDto;
  @ApiProperty({ type: ComponentBreakdownDto }) location: ComponentBreakdownDto;
  @ApiProperty({ type: ComponentBreakdownDto }) interest: ComponentBreakdownDto;
  @ApiProperty({ type: ComponentBreakdownDto }) availability: ComponentBreakdownDto;
}

export class MatchResultDto {
  @ApiProperty({ minimum: 0, maximum: 100, example: 93 }) score: number;
  @ApiProperty({ type: [MatchedSkillDto] }) matchedSkills: MatchedSkillDto[];
  @ApiProperty({ type: [MissingSkillDto] }) missingSkills: MissingSkillDto[];
  @ApiProperty({ nullable: true, description: 'null = project has no location, not scored' })
  locationMatch: boolean | null;
  @ApiProperty({ nullable: true, description: 'null = project has no category, not scored' })
  interestMatch: boolean | null;
  @ApiProperty({
    nullable: true,
    description: 'null = project has no availability constraint, not scored',
  })
  availabilityMatch: boolean | null;
  @ApiProperty({ type: MatchBreakdownDto }) breakdown: MatchBreakdownDto;
  @ApiProperty({ example: 'rule-based-v1' }) strategy: string;
}

export class RecommendedProjectDto {
  @ApiProperty({ type: ProjectResponseDto }) project: ProjectResponseDto;
  @ApiProperty({ type: MatchResultDto }) match: MatchResultDto;
}

class MatchedProjectSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: ProjectStatus }) status: ProjectStatus;
}

export class ProjectMatchDto {
  @ApiProperty({ type: MatchedProjectSummaryDto }) project: MatchedProjectSummaryDto;
  @ApiProperty({ type: MatchResultDto }) match: MatchResultDto;
}
