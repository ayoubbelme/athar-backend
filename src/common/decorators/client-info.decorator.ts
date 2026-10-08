import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

const MAX_USER_AGENT_LENGTH = 255;

/** Injects network metadata used to label device sessions. */
export const Client = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientInfo => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const userAgent = req.headers['user-agent'];
  return { ip: req.ip, userAgent: userAgent?.slice(0, MAX_USER_AGENT_LENGTH) };
});
