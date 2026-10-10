import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountStatus, Availability, Role } from '@prisma/client';

/** Public representation of a user. Never includes credentials. */
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Amina Benali' }) name: string;
  @ApiProperty({ example: 'amina@example.com' }) email: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty({ enum: AccountStatus }) status: AccountStatus;
  @ApiPropertyOptional({ nullable: true }) location: string | null;
  @ApiProperty({ enum: Availability, isArray: true }) availability: Availability[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
