# ATHAR | أثر — Backend API

Smart volunteering platform: connects young people's skills with volunteering opportunities and helps
organizations manage projects and measure social impact.

> **Status: Phase 6 — Matching complete** (on top of foundation, authentication, profiles & skills, projects, applications).
> Impact is delivered in Phase 7 (see [Roadmap](#roadmap)). Nothing in this README documents endpoints
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
├── projects/               project CRUD, lifecycle, required skills, search/filter/sort
│   ├── utils/              status state machine, visibility filter (pure, unit-tested)
│   └── services/           ProjectsService (rules), ProjectSkillsService
├── applications/           apply / review / withdraw, state machine, privacy mapper
├── matching/               explainable scoring + recommendations (replaceable strategy)
│   ├── strategies/         RuleBasedMatchStrategy (pure, deterministic)
│   ├── interfaces/         MatchStrategy contract + MATCH_STRATEGY injection token
│   └── services/           MatchingService (loads data, delegates scoring)
│   ├── utils/              application status machine (pure, unit-tested)
│   └── services/           ApplicationsService (volunteer side), ApplicationReviewService (organization side)
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
17. **Ownership is derived, never supplied.** A project's organization comes from the authenticated user;
    sending `organizationId` in a body is rejected. Other organizations get 403 on public projects and 404 on
    drafts.
18. **Final projects are immutable and published projects are cancelled, not deleted,** so applications and
    impact data (Phases 5–7) are never orphaned. Admins can still delete for moderation.
19. **One visibility rule for list and detail** (`buildVisibilityFilter`), so they cannot drift apart.
20. **Withdraw is a state change, not a delete.** `DELETE /applications/:id` sets `WITHDRAWN`, keeping the history
    for the organization and for Phase 7 impact figures. Re-applying reactivates the same row, which keeps the
    `unique(projectId, volunteerId)` guarantee intact.
21. **Capacity is enforced with a pessimistic row lock** (`SELECT … FOR UPDATE` on the project inside the
    transaction). An e2e test fires 6 simultaneous accepts at a 1-spot project and expects exactly one success.
22. **Applicant contact details are revealed only on acceptance**, a deliberate privacy default because
    volunteers are often young people.
23. **Applications are private resources:** accessing someone else's returns 404 (unlike public projects, which
    return 403 on modification), so application ids cannot be probed.
24. **Matching is a strategy behind an interface.** `MatchingService` loads plain data and delegates to the bound
    `MatchStrategy`; swapping in an ML model changes one provider binding. A test runs the service against a fake
    strategy to guarantee the seam stays clean.
25. **Unspecified requirements are excluded and weights re-normalized** instead of awarding or withholding free
    points, so scores stay comparable across projects with different amounts of detail.
26. **Fixed vocabularies for `availability` and interests/categories** (enums) instead of free text, so matching is
    deterministic and explainable. Extending the lists is a one-line enum change plus a migration.
27. **Migrations preserve data:** the availability migration converts existing free text (e.g. "Weekends and
    evenings") to the new values instead of dropping it.

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

## Upgrading from the previous phase

Phase 6 contains one **breaking API change**: `availability` (on `/volunteers/me`, `/users/*`, `/auth/me`) was free
text and is now an **array** of `Availability` values. Existing text is converted by the migration on a best-effort
basis (keywords `weekday`, `weekend`, `evening`, `flexible`/`anytime`). Run `npm run prisma:migrate`, then
`npm run prisma:seed` to backfill the demo data (re-running the seed is safe).

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

## API reference (Phases 1–6)

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
| GET / PATCH | `/volunteers/me` | Profile: `bio, phone, location, experience`, plus `availability[]` and `interests[]` (see [Enums](#enums)) |
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

### Projects

| Method | Path | Who | Description |
| --- | --- | --- | --- |
| POST | `/projects` | ORGANIZATION | Create (owner = caller's organization). `DRAFT` by default, or `status: PUBLISHED`. Optional inline `skills` |
| GET | `/projects` | any user | List / search / filter / sort (see below) |
| GET | `/projects/:id` | any user | Detail incl. organization, required skills, `acceptedVolunteers` |
| PATCH | `/projects/:id` | owner or ADMIN | Partial update; also moves the lifecycle via `status` |
| PUT | `/projects/:id/skills` | owner or ADMIN | Replace the complete set of required skills (`[]` clears) |
| DELETE | `/projects/:id` | owner (drafts only) or ADMIN | Published projects must be cancelled instead |

**List query:** `search`, `location`, `status`, `skillId`, `organizationId`, `startDateFrom`, `startDateTo`,
`sortBy=createdAt|startDate|endDate|title`, `order=asc|desc`, `page`, `limit`. Projects without dates always
sort last. Unknown query parameters are rejected with 400.

**Required skills:** `{ skillId, requiredCount (1–1000, default 1), importance (1–5, default 3) }`.
`importance` is the weight the Phase 6 matching algorithm uses.

**Visibility:** volunteers see public projects only (not drafts, not projects of suspended organizations);
organizations additionally see their own drafts; admins see everything. A project you may not see returns
`404` (never `403`) so drafts cannot be discovered.

**Category & availability:** optional `category` (enum) and `availability[]` describe the project for matching; `null`/`[]` clear them.

**Lifecycle:**

```text
DRAFT ──► PUBLISHED ──► IN_PROGRESS ──► COMPLETED
  └──────────┴──────────────┴──────────► CANCELLED
```

* Invalid transitions → `409`. `COMPLETED` and `CANCELLED` are final: any modification → `409`.
* `endDate` before `startDate` → `422`. Unknown required skill → `422`.
* `maxVolunteers` cannot be lowered below the number of already accepted volunteers → `409`.

**Status code conventions:** `400` malformed input · `403` not allowed · `404` not found / not visible ·
`409` conflicts with current state · `422` input is well-formed but violates a business rule.

### Applications

| Method | Path | Who | Description |
| --- | --- | --- | --- |
| POST | `/projects/:projectId/applications` | VOLUNTEER | Apply `{ message? }`. Only `PUBLISHED` projects. One per volunteer per project |
| GET | `/projects/:projectId/applications?status=&sortBy=createdAt\|matchScore&order=` | project owner or ADMIN | Applicants with profile and skills |
| GET | `/applications/my?status=&sortBy=&order=` | VOLUNTEER | My applications with project summary |
| PATCH | `/applications/:id/status` | project owner or ADMIN | `{ status: ACCEPTED \| REJECTED }` |
| DELETE | `/applications/:id` | VOLUNTEER (own) | Withdraw → `WITHDRAWN`, 204, idempotent |

**State machine**

```text
PENDING ──► ACCEPTED ──► REJECTED          (organization decisions)
   │            │
   ├──► REJECTED  (final)
   └──► WITHDRAWN ◄─────┘                  (volunteer, DELETE)

WITHDRAWN ──► PENDING                      (volunteer applies again; reactivates the same application)
```

* Invalid transitions → `409`. Organizations can only send `ACCEPTED` or `REJECTED`; volunteers can only withdraw.
* **Applying:** project must be `PUBLISHED` (else `409`) and visible to the volunteer (else `404`). A second
  application while one is `PENDING`/`ACCEPTED`/`REJECTED` → `409`. Simultaneous duplicate requests are
  resolved by the database unique constraint (exactly one succeeds).
* **Capacity:** applying is never blocked by `maxVolunteers`, but *accepting* beyond it → `409`. The check runs
  under a row lock on the project, so concurrent accepts cannot over-fill it. Rejecting or withdrawing frees a spot.
* **Review window:** applications can be reviewed and withdrawn while the project is `PUBLISHED` or
  `IN_PROGRESS`. Once it is `COMPLETED`/`CANCELLED` everything is frozen (history stays readable).
* **Privacy:** an organization sees an applicant's name, location, availability, bio, experience and skills, but
  their **email and phone only after the application is `ACCEPTED`** (`volunteer.contact` is `null` before).
  Admins always see contact details.
* **Isolation:** another volunteer's or organization's application behaves as non-existent (`404`).
* `matchScore` is `null` until the Phase 6 matching module fills it in.

### Enums

| Name | Values | Used by |
| --- | --- | --- |
| `Availability` | `WEEKDAYS`, `WEEKENDS`, `EVENINGS`, `FLEXIBLE` (any time) | volunteer `availability[]`, project `availability[]` |
| `ProjectCategory` | `EDUCATION`, `HEALTH`, `ENVIRONMENT`, `COMMUNITY`, `HUMANITARIAN`, `ARTS_CULTURE`, `SPORTS`, `TECHNOLOGY`, `ANIMAL_WELFARE` | project `category`, volunteer `interests[]` |

Array fields are **replaced as a whole** on PATCH; send `[]` to clear (`null` is rejected).
A project's `availability` means *when volunteers are needed*; empty or containing `FLEXIBLE` = no constraint.
Projects can be filtered with `?category=`.

### Matching (VOLUNTEER only)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/matching/projects?minScore=&page=&limit=` | Open projects ranked best-first, each with its explained score |
| GET | `/matching/projects/:id` | How well I match one project (any project visible to me) |

Recommendations exclude: projects that are not `PUBLISHED`, already ended, full (`maxVolunteers` reached), projects
I already applied to (a withdrawn application does not count) and projects of suspended organizations. Ties are
broken by newest project first. Only the 500 newest open projects are scored per request (bounded work).

Response of `GET /matching/projects/:id`:

```json
{
  "project": { "id": "…", "title": "Community Health Awareness Day", "status": "PUBLISHED" },
  "match": {
    "score": 93,
    "matchedSkills": [{ "skillId": "…", "name": "First Aid", "importance": 5, "proficiency": "ADVANCED" }],
    "missingSkills": [],
    "locationMatch": true,
    "interestMatch": true,
    "availabilityMatch": true,
    "breakdown": {
      "skills":       { "weight": 50, "applicable": true, "ratio": 0.85, "contribution": 42.5 },
      "location":     { "weight": 20, "applicable": true, "ratio": 1,    "contribution": 20 },
      "interest":     { "weight": 20, "applicable": true, "ratio": 1,    "contribution": 20 },
      "availability": { "weight": 10, "applicable": true, "ratio": 1,    "contribution": 10 }
    },
    "strategy": "rule-based-v1"
  }
}
```

**The algorithm (`rule-based-v1`)**

```text
score = 100 × Σ(weight × fit) / Σ(weight)      over the components that apply to the project

skills       50   Σ importance × proficiency% over the skills the volunteer has  ÷  Σ importance of all required skills
                  proficiency%: BEGINNER 60 · INTERMEDIATE 80 · ADVANCED 100 · EXPERT 100
location     20   volunteer and project share a location token (case/accent-insensitive; "Algiers, Algeria" ∋ "algiers")
interest     20   project.category ∈ volunteer.interests
availability 10   volunteer is FLEXIBLE, or shares a slot with the project
```

* **Components the project does not specify are ignored** (reported as `null`, `applicable: false`) and the remaining
  weights are re-normalized. A project that only states a location is judged on location alone; it is neither
  inflated nor penalized for what it does not ask. A project that states nothing scores `0`.
* **Missing volunteer data earns no credit** (no location, no interests, empty availability, no skills).
* `requiredCount` (team size) is not part of the score; it describes team composition, not individual fit.
* The score is stored on the application when a volunteer applies (`matchScore`, a snapshot) and lets organizations
  sort applicants (`sortBy=matchScore`). If matching ever fails, applying still works and the score stays empty.

**Replacing the algorithm.** The scoring lives behind one interface:

```ts
interface MatchStrategy {
  readonly name: string;
  score(input: { volunteer: VolunteerMatchProfile; project: ProjectMatchRequirements }): Promise<MatchResult>;
}
```

Implement it (e.g. calling an ML service; the method is async for that reason) and change the single binding in
`matching.module.ts`: `{ provide: MATCH_STRATEGY, useClass: YourStrategy }`. Controllers, projects and applications
do not change. `MatchResult.strategy` records which algorithm produced a score.

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
| 4 | Projects | ✅ done |
| 5 | Applications | ✅ done |
| 6 | Matching | ✅ done |
| 7 | Impact | next |
| 8 | Final quality review | |
