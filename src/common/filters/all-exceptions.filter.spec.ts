import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/x' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('formats HttpExceptions consistently', () => {
    const { status, body } = run(new NotFoundException('Project not found'));
    expect(status).toBe(404);
    expect(body).toMatchObject({
      statusCode: 404,
      message: 'Project not found',
      error: 'Not Found',
      path: '/x',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('summarizes class-validator errors and exposes details', () => {
    const { status, body } = run(
      new BadRequestException(['email must be an email', 'name should not be empty']),
    );
    expect(status).toBe(400);
    expect(body.message).toBe('Validation failed');
    expect(body.details).toEqual(['email must be an email', 'name should not be empty']);
  });

  it('keeps 403 messages', () => {
    expect(run(new ForbiddenException('Nope')).body.message).toBe('Nope');
  });

  it.each([
    ['P2002', 409, 'Resource already exists'],
    ['P2025', 404, 'Resource not found'],
    ['P2003', 409, 'Operation conflicts with related resources'],
  ])('maps Prisma %s to %i without leaking details', (code, expectedStatus, message) => {
    const err = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on users_email_key',
      {
        code,
        clientVersion: 'test',
      },
    );
    const { status, body } = run(err);
    expect(status).toBe(expectedStatus);
    expect(body.message).toBe(message);
    expect(JSON.stringify(body)).not.toContain('users_email_key');
  });

  it('hides unexpected error internals behind a 500', () => {
    const { status, body } = run(new Error('connection string postgres://user:secret@db'));
    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
