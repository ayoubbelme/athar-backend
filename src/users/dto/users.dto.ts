import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { AccountStatus, Role } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { trim } from '../../common/utils/transform.util';

export class UpdateMeDto {
  @ApiProperty({ example: 'Amina Benali', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: AccountStatus })
  @IsEnum(AccountStatus)
  status: AccountStatus;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({ description: 'Case-insensitive match on name or email' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
}
