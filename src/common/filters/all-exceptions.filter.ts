import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

export interface ErrorResponseBody {
  statusCode: number;
  message: string;
  error: string;
  details?: string[];
  path: string;
  timestamp: string;
}

interface NormalizedError {
  statusCode: number;
  message: string;
  details?: string[];
}

const GENERIC_MESSAGE = 'Internal server error';

/**
 * Global filter: every error leaves the API in the same shape and
 * raw database / internal errors are never leaked to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { statusCode, message, details } = this.normalize(exception);

    if (statusCode >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(`${request.method} ${request.url} -> ${statusCode}`, err.stack);
    }

    const body: ErrorResponseBody = {
      statusCode,
      message,
      error: HttpStatus[statusCode] ? this.humanize(HttpStatus[statusCode]) : 'Error',
      ...(details ? { details } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaKnownError(exception);
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request data' };
    }
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: GENERIC_MESSAGE };
  }

  private fromHttpException(exception: HttpException): NormalizedError {
    const statusCode = exception.getStatus();
    const res = exception.getResponse();

    if (typeof res === 'string') {
      return { statusCode, message: statusCode >= 500 ? GENERIC_MESSAGE : res };
    }

    const payload = res as { message?: string | string[] };
    // class-validator produces `message: string[]` -> summary + details.
    if (Array.isArray(payload.message)) {
      return { statusCode, message: 'Validation failed', details: payload.message };
    }
    if (statusCode >= 500) {
      return { statusCode, message: GENERIC_MESSAGE };
    }
    return { statusCode, message: payload.message ?? exception.message };
  }

  private fromPrismaKnownError(e: Prisma.PrismaClientKnownRequestError): NormalizedError {
    switch (e.code) {
      case 'P2002':
        return { statusCode: HttpStatus.CONFLICT, message: 'Resource already exists' };
      case 'P2025':
        return { statusCode: HttpStatus.NOT_FOUND, message: 'Resource not found' };
      case 'P2003':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'Operation conflicts with related resources',
        };
      default:
        return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: GENERIC_MESSAGE };
    }
  }

  /** BAD_REQUEST -> "Bad Request" */
  private humanize(name: string): string {
    return name
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
