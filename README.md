# ATHAR | أثر — Backend API

Smart volunteering platform: connects young people's skills with volunteering opportunities and helps
organizations manage projects and measure social impact.

> **Status: Phase 3 — Profiles & Skills complete** (on top of Phase 1 foundation and Phase 2 authentication).
> Projects, applications, matching and impact are delivered in Phases 4–7 (see [Roadmap](#roadmap)). Nothing in this README documents endpoints
> that do not exist yet.

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime / language | Node.js ≥ 20, TypeScript (strict) |
| Framework | NestJS 11 (modular monolith) |
| Database / ORM | PostgreSQL, Prisma 6 (Rust-free client + `pg` driver adapter) |
| Validation | class-validator, class-transformer, Joi (env) |
| Security | Helmet, CORS allow-list, `@nestjs/throttler`, argon2id password hashing, JWT + Passport |
| Docs | Swagger / OpenAPI at `/api/docs` (non-production) |
| Logging | pino via `nestjs-pino` (structured JSON, secrets redacted) |
| Quality | Jest, ESLint 9 (flat config) + Prettier |

## Requirements

* Node.js 20 or newer
* PostgreSQL 14 or newer

## Setup

```bash
npm install

cp .env.example .env
# Edit .env: set DATABASE_URL and generate two different JWT secrets:
#   openssl rand -base64 48

# Create the database/user if needed, e.g.:
#   CREATE USER athar WITH PASSWORD '...' CREATEDB;
#   CREATE DATABASE athar OWNER athar;

npm run prisma:generate      # generate the Prisma client
npm run prisma:migrate       # apply migrations (dev) — creates all tables
npm run prisma:seed          # load demo data (optional, dev only)
npm run start:dev            # http://localhost:3000
```

* Swagger UI: <http://localhost:3000/api/docs>
* Health: <http://localhost:3000/health>

### Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `3000` | |
| `LOG_LEVEL` | no | `info` | |
| `DATABASE_URL` | **yes** | — | `postgresql://user:pass@host:5432/db?schema=public` |
| `JWT_ACCESS_SECRET` | **yes** | — | ≥ 32 chars |
| `JWT_REFRESH_SECRET` | **yes** | — | ≥ 32 chars, must differ from the access secret |
| `JWT_ACCESS_EXPIRES_IN` | no | `15m` | |
| `JWT_REFRESH_EXPIRES_IN` | no | `7d` | |
| `CORS_ORIGIN` | **yes** | — | Comma-separated origins. `*` only for development |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | no | `60` / `100` | Requests per IP per window (seconds) |
| `THROTTLE_AUTH_LIMIT` | no | `10` | Stricter per-minute limit per IP on each of `/auth/login`, `/register`, `/refresh`, `/logout` |

The app **refuses to start** if a required variable is missing or a secret is too short.

## Demo data (seed)

`npm run prisma:seed` is idempotent and refuses to run when `NODE_ENV=production`.
All data is fictional.

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@athar.dev` | `Admin#Demo2026` |
| Volunteer | `volunteer@athar.dev` | `Volunteer#Demo2026` |
| Organization | `org@athar.dev` | `Org#Demo2026!` |

Also seeded: 8 skills, 2 projects (one open, one completed) with required skills,
2 applications, and impact data for the completed project.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | Dev server with watch |
| `npm run build` / `npm run start:prod` | Production build / run `dist/main.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `lint:fix` / `format` | ESLint / Prettier |
| `npm test` / `test:cov` | Unit tests (no database needed) |
| `npm run test:e2e` | E2E tests (**needs a running PostgreSQL** + `.env`) |
| `npm run prisma:validate` | Validate the schema |
| `npm run prisma:migrate` | Create/apply migrations in development |
| `npm run prisma:deploy` | Apply migrations in production/CI |

Production: `npm run build && npm run prisma:deploy && npm run start:prod`.
Swagger is **not** exposed when `NODE_ENV=production`.

## Architecture

Modular monolith. Controllers handle HTTP only, services hold business logic, Prisma is the only
database access layer.

```text
src/
├── main.ts                 bootstrap
├── app.setup.ts            shared bootstrap: helmet, CORS, pipes, filters, Swagger
├── app.module.ts           root module: config, logging, throttling, Prisma, health
├── config/                 typed configuration + Joi env validation
├── prisma/                 PrismaService / PrismaModule (global)
├── health/                 GET /health (real DB round-trip)
├── auth/
│   ├── controllers/        AuthController
│   ├── services/           AuthService (flows), TokenService (sessions/rotation), PasswordService
│   ├── strategies/         JwtStrategy (loads user + status from DB per request)
│   ├── guards/             JwtAuthGuard (global, secure by default)
│   └── dto/ interfaces/ auth.constants.ts
├── users/                  UsersController (me + admin), UsersService, UsersAdminService
├── skills/                 skills catalog CRUD (admin) + search/pagination
├── volunteers/             own profile + the skills a volunteer holds (proficiency)
├── organizations/          own profile + public organization directory
└── common/
    ├── constants/          pagination limits, Swagger tags
    ├── decorators/         @Public, @Roles, @CurrentUser, @Client
    ├── guards/             RolesGuard
    ├── interfaces/         AuthenticatedUser
    ├── dto/                PaginationQueryDto, paginated types, ErrorResponseDto
    ├── filters/            AllExceptionsFilter (uniform errors, Prisma mapping)
    └── utils/              pagination + input-normalization helpers
prisma/
├── schema.prisma
├── migrations/
└── seed.ts
test/                       e2e tests
```

Feature modules (`auth`, `users`, `volunteers`, `organizations`, `skills`, `projects`, `applications`,
`matching`, `impact`) are added phase by phase — no empty placeholder modules are shipped.

### Data model

```text
User 1─* RefreshToken   (one family of rotating tokens per device session)
User 1─1 VolunteerProfile
User 1─1 OrganizationProfile 1─* Project 1─1 Impact
User *─* Skill   (UserSkill: proficiency)
Project *─* Skill (ProjectSkill: requiredCount, importance)
User 1─* Application *─1 Project   (unique: projectId + volunteerId)
```

### Architectural decisions

1. **Prisma Rust-free client (`engineType = "client"`) + `@prisma/adapter-pg`.** No native query-engine
   binary to ship or download; smaller deployments; aligns with Prisma 7's direction. Migrations still
   use the standard Prisma CLI.
2. **Joi-validated env at startup.** Misconfiguration fails fast and loudly.
3. **Single global exception filter.** One error shape for every failure. Prisma `P2002 → 409`,
   `P2025 → 404`, `P2003 → 409`; everything unexpected becomes a generic 500. Internals are only logged.
4. **Strict validation pipe** (`whitelist` + `forbidNonWhitelisted`): unknown properties are rejected,
   preventing mass-assignment bugs.
5. **UUID primary keys.** Safe to expose in URLs; no enumeration.
6. **Multi-device sessions via a `refresh_tokens` table.** Each login creates a session (a "family" of
   rotating refresh tokens). Only a SHA-256 hash of each token is stored. Logging out one device does not
   affect others. See [Authentication](#authentication).
7. **`Application.volunteerId` references `User`** (not `VolunteerProfile`) so a volunteer can apply
   without a complete profile.
8. **`Impact` is 1:1 with `Project`** and has a nullable JSON `metrics` column so new metrics can be
   added without breaking existing rows.
9. **Rate limiting is global** (`APP_GUARD`); `/health` is exempt for orchestrator probes.
10. **Request bodies and auth headers are never logged.**
11. **Secure by default:** `JwtAuthGuard` and `RolesGuard` are global. Every route requires a token unless
    marked `@Public()`; `@Roles(...)` adds role checks. Forgetting a decorator fails closed.
12. **Role and status are read from the database, not the token.** The access token only carries the user id.
13. **Registration creates the profile row** (empty `VolunteerProfile`, or `OrganizationProfile` named by
    `organizationName`) in the same transaction, so later phases can assume it exists.
14. **Profile is the source of truth for `location`/`availability`**; the same values are mirrored onto the
    user row in the same transaction so matching can read either consistently.
15. **Skills are protected from silent data loss:** deleting a skill that volunteers or projects still use is
    rejected with 409 instead of cascading. Skill names are unique ignoring case.
16. **"Me" routes instead of ids.** Volunteers and organizations only ever address their own data
    (`/volunteers/me/...`), which makes cross-user access impossible by construction.

### Known trade-offs

* Expired sessions are purged opportunistically on the user's next login; there is no scheduler. If the
  table grows large, add a periodic cleanup (`DELETE ... WHERE "expiresAt" < now()`).
* The access token is stateless, but every request loads the user (one primary-key query) so suspension
  and role changes take effect immediately. That costs a query per request in exchange for correctness.
* `availability` is free text for now.

## Error format

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "details": ["email must be an email"],
  "path": "/auth/register",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

Paginated lists return `{ "data": [], "meta": { "page", "limit", "total", "totalPages" } }`
(`limit` max 100, default 20).

## Authentication

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | public | Create a VOLUNTEER or ORGANIZATION account (+ profile) and sign in |
| POST | `/auth/login` | public | Sign in on this device |
| POST | `/auth/refresh` | public | Rotate tokens (body: `refreshToken`) |
| POST | `/auth/logout` | public | Revoke **this device's** session (body: `refreshToken`) → 204 |
| POST | `/auth/logout-all` | Bearer | Revoke **all** devices → 204 |
| GET | `/auth/me` | Bearer | Current user |

**Flow (mobile app)**

1. `register` / `login` → `{ user, tokens: { accessToken, refreshToken, accessTokenExpiresAt } }`.
   Keep the refresh token in secure storage (Keychain / Keystore), the access token in memory.
2. Send `Authorization: Bearer <accessToken>` on every request (default lifetime 15 min).
3. On `401`, call `/auth/refresh` **once**, replace *both* tokens, retry the original request.
   Serialize refresh calls in the client (one in flight at a time).
4. If refresh returns `401`, the session is over: show the login screen.
5. Sign out: `POST /auth/logout` with the refresh token.

**Multi-device and rotation rules**

* Every login is an independent session, so phone and tablet stay signed in together.
* Refresh tokens are **single-use**: each refresh revokes the old token and issues a new one in the same session.
* **Reuse detection:** presenting an already-used refresh token outside a 10-second grace window revokes
  that whole session (it indicates theft). Inside the window it is only rejected, tolerating client races.
* Suspending a user (`status = SUSPENDED`) blocks their access tokens immediately, plus refresh and login.
* Password policy: 8–128 characters with at least one letter and one digit. Hashing: argon2id.
* Login returns the same `401 Invalid email or password` for unknown emails and wrong passwords.

## Roles and permissions

Roles: `VOLUNTEER`, `ORGANIZATION`, `ADMIN`. Only the first two can self-register; admins come from the
seed / database.

```ts
@Roles(Role.ORGANIZATION, Role.ADMIN)   // from common/decorators
@Post()
create(@CurrentUser() user: AuthenticatedUser) {}

@Public()                               // opt out of authentication
@Get()
list() {}
```

* No decorator → any authenticated user. `@Roles(...)` → 403 for other roles. No token → 401.
* Ownership rules (e.g. "organizations manage only their own projects") are enforced in services as the
  features arrive in later phases.

## API reference (Phases 1–3)

All routes require `Authorization: Bearer <accessToken>` unless marked public. List endpoints return the
paginated envelope (`page`, `limit` ≤ 100).

### Skills

| Method | Path | Who | Description |
| --- | --- | --- | --- |
| GET | `/skills?search=&sortBy=name\|createdAt&order=asc\|desc&page=&limit=` | any user | List / search |
| GET | `/skills/:id` | any user | Get one |
| POST | `/skills` | ADMIN | Create (name unique, case-insensitive) |
| PATCH | `/skills/:id` | ADMIN | Update name/description |
| DELETE | `/skills/:id` | ADMIN | Delete. **409 while any volunteer or project still uses it** |

### Volunteers (VOLUNTEER only, always the caller's own data)

| Method | Path | Description |
| --- | --- | --- |
| GET / PATCH | `/volunteers/me` | Profile: `bio, phone, location, availability, experience` |
| GET | `/volunteers/me/skills` | My skills with proficiency |
| POST | `/volunteers/me/skills` | Add `{ skillId, proficiency? }` (default `BEGINNER`; 409 if already added) |
| PATCH | `/volunteers/me/skills/:skillId` | Change proficiency |
| DELETE | `/volunteers/me/skills/:skillId` | Remove |

### Organizations

| Method | Path | Who | Description |
| --- | --- | --- | --- |
| GET | `/organizations?search=&location=` | any user | Directory (suspended organizations hidden) |
| GET | `/organizations/:id` | any user | Public profile |
| GET / PATCH | `/organizations/me` | ORGANIZATION | Own profile: `name, description, logo, location, website, contactEmail` |

### Users

| Method | Path | Who | Description |
| --- | --- | --- | --- |
| PATCH | `/users/me` | any user | Change own display name |
| GET | `/users?role=&status=&search=` | ADMIN | List / filter users |
| GET | `/users/:id` | ADMIN | Get a user |
| PATCH | `/users/:id/status` | ADMIN | `ACTIVE` ↔ `SUSPENDED`. Suspending revokes all sessions. Not allowed on yourself |

**PATCH semantics:** omitted field = unchanged; `null` = clear (optional fields only); unknown fields → 400.

## Testing

```bash
npm test            # unit: auth, skills, volunteers, organizations, users-admin, RolesGuard, pagination, filter, env, health
npm run test:e2e    # e2e (real DB): auth, multi-device, RBAC, suspension, throttling, profiles, skills,
                    #   user administration, health, error shape, helmet, CORS, Swagger
```

## Example requests

```bash
curl http://localhost:3000/health
# {"status":"ok","database":"connected","uptime":12,"timestamp":"..."}

# Register an organization
curl -X POST http://localhost:3000/auth/register -H 'Content-Type: application/json' -d '{
  "name": "Amina Benali", "email": "amina@example.com", "password": "Str0ngPassw0rd",
  "role": "ORGANIZATION", "organizationName": "Green Hands Association" }'

# Log in (seeded demo volunteer)
curl -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"volunteer@athar.dev","password":"Volunteer#Demo2026"}'

# Current user
curl http://localhost:3000/auth/me -H "Authorization: Bearer $ACCESS_TOKEN"

# Rotate tokens
curl -X POST http://localhost:3000/auth/refresh -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}"
```

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation | ✅ done |
| 2 | Authentication, roles, guards, multi-device sessions | ✅ done |
| 3 | Profiles & skills | ✅ done |
| 4 | Projects | next |
| 5 | Applications | |
| 6 | Matching | |
| 7 | Impact | |
| 8 | Final quality review | |
