import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { trim } from '../../common/utils/transform.util';

const HTTP_URL = { protocols: ['http', 'https'], require_protocol: true };

/** All fields optional. Send `null` to clear an optional field; `name` cannot be cleared. */
export class UpdateOrganizationProfileDto {
  @ApiPropertyOptional({ example: 'Green Hands Association', minLength: 2, maxLength: 150 })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ example: 'https://example.org/logo.png', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsUrl(HTTP_URL)
  @MaxLength(500)
  logo?: string | null;

  @ApiPropertyOptional({ example: 'Algiers', maxLength: 100, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @ApiPropertyOptional({ example: 'https://example.org', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsUrl(HTTP_URL)
  @MaxLength(300)
  website?: string | null;

  @ApiPropertyOptional({ example: 'contact@example.org', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string | null;
}

export class ListOrganizationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive match on name or description' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive partial match on location' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  location?: string;
}

export class OrganizationResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Organization profile id (used by projects)' })
  id: string;
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty({ example: 'Green Hands Association' }) name: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiPropertyOptional({ nullable: true }) logo: string | null;
  @ApiPropertyOptional({ nullable: true }) location: string | null;
  @ApiPropertyOptional({ nullable: true }) website: string | null;
  @ApiPropertyOptional({ nullable: true }) contactEmail: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
