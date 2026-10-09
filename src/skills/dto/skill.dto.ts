import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { SORT_ORDERS, SortOrder } from '../../common/constants';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { trim } from '../../common/utils/transform.util';

export class CreateSkillDto {
  @ApiProperty({ example: 'First Aid', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Emergency and basic medical response', maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateSkillDto extends PartialType(CreateSkillDto) {
  // `name` is required in the database: reject explicit null (PartialType would allow it).
  @ValidateIf((_o, v) => v !== undefined)
  declare name?: string;
}

export const SKILL_SORT_FIELDS = ['name', 'createdAt'] as const;

export class ListSkillsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive match on name or description' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: SKILL_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn(SKILL_SORT_FIELDS)
  sortBy: (typeof SKILL_SORT_FIELDS)[number] = 'name';

  @ApiPropertyOptional({ enum: SORT_ORDERS, default: 'asc' })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  order: SortOrder = 'asc';
}

export class SkillResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'First Aid' }) name: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty() createdAt: Date;
}
