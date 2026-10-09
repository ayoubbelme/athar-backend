import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Columns that are safe to return to clients (no passwordHash). */
export const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  location: true,
  availability: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof PUBLIC_USER_SELECT }>;

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  location?: string;
  /** Required when role is ORGANIZATION: becomes the organization profile name. */
  organizationName?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findPublicById(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({ where: { id }, select: PUBLIC_USER_SELECT });
  }

  async updateName(id: string, name: string): Promise<PublicUser> {
    return this.prisma.user.update({ where: { id }, data: { name }, select: PUBLIC_USER_SELECT });
  }

  /** Includes passwordHash — only for credential verification inside the auth flow. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * Creates the user together with its empty profile in one atomic write, so
   * later phases can always assume a profile exists. Uniqueness is enforced by
   * the database (no check-then-insert race).
   */
  async create(input: CreateUserInput): Promise<PublicUser> {
    const profile =
      input.role === Role.ORGANIZATION
        ? { organizationProfile: { create: { name: input.organizationName ?? input.name } } }
        : input.role === Role.VOLUNTEER
          ? { volunteerProfile: { create: {} } }
          : {};

    try {
      return await this.prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: input.passwordHash,
          role: input.role,
          location: input.location,
          ...profile,
        },
        select: PUBLIC_USER_SELECT,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }
}
