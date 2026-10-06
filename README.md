# ATHAR | أثر — Backend API

Smart volunteering platform: connects young people's skills with volunteering opportunities and helps
organizations manage projects and measure social impact.

> **Status: Phase 1 — Foundation complete.** Auth, profiles, skills, projects, applications, matching and
> impact are delivered in Phases 2–7 (see [Roadmap](#roadmap)). Nothing in this README documents endpoints
> that do not exist yet.

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime / language | Node.js ≥ 20, TypeScript (strict) |
| Framework | NestJS 11 (modular monolith) |
| Database / ORM | PostgreSQL, Prisma 6 (Rust-free client + `pg` driver adapter) |
| Validation | class-validator, class-transformer, Joi (env) |
| Security | Helmet, CORS allow-list, `@nestjs/throttler`, argon2 (hashing, used from Phase 2) |
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
└── common/
    ├── constants/          pagination limits, Swagger tags
    ├── dto/                PaginationQueryDto, paginated response types
    ├── filters/            AllExceptionsFilter (uniform errors, Prisma mapping)
    └── utils/              pagination helpers
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
6. **Refresh token stored hashed** in `users.refreshTokenHash` (nullable; `null` = logged out). Chosen
   for simplicity; see "Known trade-offs".
7. **`Application.volunteerId` references `User`** (not `VolunteerProfile`) so a volunteer can apply
   without a complete profile.
8. **`Impact` is 1:1 with `Project`** and has a nullable JSON `metrics` column so new metrics can be
   added without breaking existing rows.
9. **Rate limiting is global** (`APP_GUARD`); `/health` is exempt for orchestrator probes.
10. **Request bodies and auth headers are never logged.**

### Known trade-offs

* A single `refreshTokenHash` per user means one active session: logging in on a second device
  invalidates the first. If multi-device login is needed, replace it with a `RefreshToken` table
  (decide before Phase 2).
* `availability` is free text for now (see open questions below).

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

## Testing

```bash
npm test            # unit: pagination, DTO validation, error filter, env validation, health
npm run test:e2e    # e2e: health + DB, error shape, helmet, CORS, Swagger, rate limiting
```

## Example requests

```bash
curl http://localhost:3000/health
# {"status":"ok","database":"connected","uptime":12,"timestamp":"..."}
```

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation | ✅ done |
| 2 | Authentication, roles, guards | next |
| 3 | Profiles & skills | |
| 4 | Projects | |
| 5 | Applications | |
| 6 | Matching | |
| 7 | Impact | |
| 8 | Final quality review | |
