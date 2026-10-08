import { Role } from '@prisma/client';

/** The identity attached to `request.user` after JWT authentication. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}
