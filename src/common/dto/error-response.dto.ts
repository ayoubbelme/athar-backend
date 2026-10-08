import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Swagger model for the shape produced by AllExceptionsFilter. */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 }) statusCode: number;
  @ApiProperty({ example: 'Validation failed' }) message: string;
  @ApiProperty({ example: 'Bad Request' }) error: string;
  @ApiPropertyOptional({ type: [String], example: ['email must be an email'] }) details?: string[];
  @ApiProperty({ example: '/auth/register' }) path: string;
  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' }) timestamp: string;
}
