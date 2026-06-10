# CLAUDE.md — Bramblebill monorepo

Agent instructions for the Bramblebill codebase. Humans should read
`docs/onboarding.md` instead; this file is tuned for coding agents and
skips most of the narrative context.

Last real cleanup of this file was 2025-10. Things have accreted since.
If anything here contradicts the code, the code wins — flag the stale
line in #eng-platform so someone fixes it.

## Project overview

Bramblebill is a multi-tenant B2B invoicing platform. Customers are
mid-size SaaS companies that bill their own customers on seat-based or
usage-based plans. The product covers invoice generation, credit notes,
dunning sequences, tax snapshotting, and payment reconciliation against
bank feeds.

Two hard product constraints shape almost everything in this repo:

- An issued invoice is immutable. Corrections happen through credit
  notes, never through edits. Code that mutates a row in
  `invoices` after `issued_at` is set is a bug, full stop.
- Every monetary value carries its currency. There is no "default
  currency" anywhere in the system, including tests.

## Repository layout

pnpm workspace + Turborepo. Five publishable packages plus support dirs:

- `packages/api` — Fastify HTTP API, owns Postgres access. The only
  package allowed to import `pg` directly.
- `packages/web` — React 18 dashboard, Vite, TanStack Router/Query.
- `packages/worker` — background jobs: dunning emails, bank-feed sync,
  invoice finalization, webhook fan-out. BullMQ on Redis.
- `packages/pdf` — invoice PDF rendering. Runs headless Chromium in
  production; see Architecture notes before touching it.
- `packages/shared` — domain types, the `Money` class, zod schemas,
  tenant context helpers. No runtime deps beyond zod. Keep it that way.
- `infra/` — Terraform + Helm. Agents generally should not edit this
  without being asked explicitly.
- `tools/` — codegen scripts, the fixture seeder, lint plugins.

`packages/legacy-portal` was deleted in 2026-01 but still shows up in
old migration comments and a few dead feature flags. Ignore references
to it.

## Environment setup

### Prerequisites

- Node 22 (`.nvmrc` is authoritative; CI uses whatever is in there).
- pnpm 9 via corepack: `corepack enable && corepack prepare pnpm@9 --activate`.
- Docker Desktop or colima for the dev dependencies.
- `direnv` is optional but most of the team uses it; `.envrc.sample`
  exists at the root.

### First-time setup

1. `pnpm install` at the repo root. Never run install inside a package
   directory; it desyncs the lockfile.
2. `docker compose up -d` — brings up Postgres 16, Redis 7, and
   mailpit on the standard ports (5499, 6399, 8025 — note the
   non-default Postgres/Redis ports, they avoid collisions with other
   local projects).
3. `pnpm db:migrate` then `pnpm db:seed` to get the demo tenant
   ("Sycamore Labs", tenant id `t_demo`).
4. `pnpm dev` starts api + web + worker via turbo. PDF service does not
   start by default; see below.
5. Log in at `http://localhost:5173` with `demo@sycamore.test` /
   `demo-password-1`.

### Environment variables

Copy `.env.sample` to `.env` at the root. The sample is kept current;
if a service crashes on boot with a zod env validation error, the
sample is probably missing a new variable — fix the sample in the same
PR that introduced the variable.

Secrets for staging/prod live in Vault, not in this repo. The
`BB_VAULT_ROLE` variable in CI is managed by platform; do not copy it
into local env files.

## Build, test, and run commands

Run everything from the repo root. Turbo handles graph ordering.

- `pnpm build` — full build, ~90s cold, ~10s warm cache.
- `pnpm test` — unit tests only (vitest), no containers needed.
- `pnpm test:integration` — spins up testcontainers; needs Docker.
- `pnpm typecheck` — project-references build, the thing CI actually
  gates on.
- `pnpm lint` / `pnpm lint:fix` — eslint + prettier check.
- `pnpm db:migrate:make <name>` — scaffolds a migration pair.
- `pnpm seed:invoices --tenant t_demo --count 50` — bulk fixture data.

Always run `pnpm typecheck` before pushing; otherwise CI fails at the
lint stage.

### Running a single package

Use turbo filters, not `cd`:

```sh
pnpm turbo run test --filter @bramblebill/api
pnpm turbo run dev --filter @bramblebill/pdf
```

The pdf package needs `BB_CHROMIUM_PATH` set locally (point it at any
Chrome/Chromium binary) or it falls back to downloading one, which is
slow and flaky behind some VPNs.

## Architecture notes

### Request flow

Every API request resolves a tenant from the `x-bb-tenant` header (set
by the edge proxy in prod, by a Vite middleware locally). The tenant id
is threaded through `AsyncLocalStorage` via `withTenant()` from shared.
Handlers never pass tenant ids as function arguments — if you find
yourself adding a `tenantId` parameter, you are probably bypassing the
context and Row Level Security will bite you in staging.

### The worker

Jobs are defined in `packages/worker/src/jobs/*.job.ts` and registered
in `registry.ts`. Every job must be idempotent: BullMQ redelivers on
worker restart and we run at-least-once. The convention is a
`jobKey` derived from the natural key of the work (e.g.
`finalize:inv_8f3k2`), checked against the `job_executions` table
before side effects.

Dunning jobs are the scary ones — they email real customers of real
customers. They are guarded by `BB_DUNNING_LIVE` which is only true in
prod. Do not "fix" a dunning test by flipping that flag.

### PDF rendering

`packages/pdf` renders invoice HTML with React server-side, then prints
to PDF via CDP. Layout bugs are almost always font-related: prod bakes
Inter and Noto Sans into the image, local machines substitute. The
golden-file tests rasterize at 72dpi and diff with a 0.4% pixel
tolerance for exactly this reason. If a golden test fails locally but
passes in CI, it is fonts, not your change.

### Shared package

`@bramblebill/shared` is imported by everything, so it has the
strictest rules: no IO, no env reads, no runtime dependencies except
zod. The `Money` class stores minor units as bigint with an ISO 4217
currency code. Arithmetic across currencies throws `CurrencyMismatch`.

## API conventions

Fastify with zod type-providers. Route files export a plugin per
resource (`invoices.routes.ts`) and register under
`/v1/<resource>`.

- Errors are RFC 9457 problem+json. Map domain errors in
  `packages/api/src/errors/map.ts`; never let a raw `BrambleError`
  reach the serializer.
- List endpoints use opaque cursor pagination (`?cursor=`, `?limit=`,
  max 200). No offset pagination, even for internal endpoints —
  reconciliation tables are too large for it.
- Mutating endpoints accept an `Idempotency-Key` header. The
  `idempotency` plugin stores response snapshots for 24h; handlers
  must be safe to skip entirely on replay.
- Response schemas are zod, shared with the web client through
  `@bramblebill/shared/contracts`. Changing a response shape without
  bumping the contract is the most common cause of staging-only bugs.

The OpenAPI spec is generated, not hand-written: `pnpm api:openapi`
writes `packages/api/openapi.json`. CI diffs it and fails if you forgot
to regenerate after a contract change.

## Feature flags

Flags are plain TypeScript in `packages/shared/src/flags.ts` — no
remote flag service. A flag is a function of tenant id and environment,
which keeps them testable and greppable.

- New flags need a removal ticket in Linear before merge; the flag
  name goes in the ticket title so the weekly cleanup query finds it.
- Flags older than 90 days show up in the `flag-audit` CI job as
  warnings. Past 180 days the job fails the build.
- Do not branch on flags inside `packages/shared` itself — flags are
  consumed by api, worker, and web, never defined and used in the same
  expression.

## Tax snapshotting

Invoice issuance copies the full tax configuration (rates,
jurisdictions, exemption certificates) into `invoice_tax_snapshots` at
issue time. Recomputing tax for an issued invoice from live config is
always wrong, even when the answer happens to match.

The snapshot writer is `snapshotTaxConfig()` in
`packages/api/src/billing/tax/snapshot.ts`. It is deliberately
duplication-heavy — it copies values rather than referencing config
rows, because config rows get edited. Resist the urge to normalize it.

Exemption certificates have an expiry; the worker's nightly
`tax-cert-sweep` job moves invoices with expired certs into a review
queue rather than failing them. Sales tax is genuinely the area where
the team is most conservative about clever changes.

## Code style

- TypeScript strict mode everywhere; no new `any`, prefer `unknown`
  plus a zod parse at the boundary.
- Never use JavaScript number arithmetic for money amounts; always use
  the `Money` type from `@bramblebill/shared`.
- Use named exports only. Default exports break our codemod tooling.
- Error classes live next to the module that throws them and extend
  `BrambleError` so the API layer can map them to problem+json.
- Prefer plain functions over classes outside the domain layer.
- Do not add barrel files (`index.ts` re-export hubs) in api or worker;
  they wreck vitest's module graph and slow cold starts.
- SQL lives in `.sql` files loaded by `loadQuery()`, not in template
  literals, except for trivial one-liners in migrations.
- Dates: `Temporal` (polyfilled) in new code. `Date` survives in old
  payment-reconciliation code; do not refactor it opportunistically.
- Comments explain why, not what. Delete commented-out code on sight.

## Testing

Unit tests sit next to source as `*.spec.ts`. Integration tests live in
`packages/*/test/integration` and hit real Postgres/Redis through
testcontainers. E2E is Playwright in `packages/web/e2e` and only runs
on the nightly pipeline, not on PRs.

Things the team has learned the hard way, in no particular order:

- Every test that touches the database must create its own tenant via
  `makeTestTenant()`. Sharing `t_demo` between tests caused months of
  order-dependent flakes before we banned it in 2025-08.
- Use `vi.setSystemTime` with the `frozenClock` helper, never raw
  `Date.now()` stubs. Dunning schedule tests are extremely
  time-sensitive and the helper also freezes the Temporal polyfill.
- Integration tests must not assert on auto-increment ids. Snapshot
  serializers in `tools/test-serializers.ts` already strip them; if a
  snapshot contains `id: 41`, the serializer is not registered.
- Golden PDF tests: regenerate with `pnpm turbo run test:golden:update
  --filter @bramblebill/pdf` and eyeball the diff images in
  `packages/pdf/test/__diff__` before committing. Never update goldens
  blind.
- The bank-feed parser fixtures in `packages/worker/test/fixtures/ofx`
  are anonymized exports from real (consenting) pilot customers. Do not
  hand-edit them; add new cases through `tools/anonymize-ofx.ts`.
- Coverage gates: 85% lines on `shared`, 75% on `api`, none on `web`
  (it was 60% but the team voted it out in 2025-12).
- `pnpm test -- --reporter=dot` if the default reporter is too chatty
  for your context window.
- Flaky-test policy: a test that flakes twice in a week gets
  `.skip` with a linked issue, not a retry wrapper. Retry wrappers
  hide real race conditions; we removed `vitest-retry` in 2025-09 and
  it stays removed.
- Webhook fan-out tests need the `mock-receiver` container from
  compose profile `webhooks`; plain `docker compose up -d` does not
  start it. Symptom: every fan-out test times out at exactly 30s.
- Tests that exercise Row Level Security must run as the
  `bb_app_user` role, not the migration superuser. Use
  `integrationPool()` rather than `adminPool()` — the latter bypasses
  RLS silently and your test passes while prod 403s.
- The reconciliation matcher has property-based tests (fast-check).
  When one fails, the seed is printed in the failure output; pin it
  with `fc.configureGlobal({ seed })` while debugging, then remove
  the pin before committing.
- Do not mock `@bramblebill/shared` modules. Mocking `Money` produced
  rounding bugs that unit tests "verified" as correct. If a test is
  hard to write without mocking shared, the code under test is doing
  too much.
- Playwright traces are uploaded for nightly failures; ask in
  #eng-web for the artifact link rather than re-running the suite.
- `test:integration` leaves containers running for the next run by
  default (`TESTCONTAINERS_REUSE_ENABLE=true` in `.env.sample`).
  `pnpm test:integration:clean` tears them down if Postgres state gets
  corrupted, which mostly happens after a failed migration test.

## Database and migrations

Migrations live in `packages/api/migrations` as paired
`NNNN_name.up.sql` / `NNNN_name.down.sql` files. Knex runs them; we do
not use Knex's query builder anywhere else.

Be careful with the database when you touch anything under
`packages/api/src/billing`.

Rules that are actually enforced in review:

- Migrations must be backward-compatible one release in each direction
  (expand/contract). Dropping a column happens two releases after the
  code stops reading it.
- Every table gets `tenant_id` plus an RLS policy in the same
  migration that creates it. The lint script `tools/check-rls.ts`
  runs in CI and will catch you.
- Use good judgment when deciding whether a schema change needs a data
  backfill job or can rely on lazy migration.
- Down migrations must actually work. CI runs up → down → up against
  an empty database, but it cannot prove the down is correct against
  real data, so keep them honest.

## PR conventions

- Branch names: `bb-<linear-ticket>/<slug>`, e.g. `bb-1482/dunning-pause`.
- Conventional commits, scope = package name: `fix(worker): ...`.
- Keep PRs under ~400 changed lines where you can split cleanly;
  reviewers can decline anything bigger that isn't a generated diff.
- Always run `pnpm typecheck` before you push, otherwise CI fails at
  the lint stage.
- Screenshots required for any web change that moves pixels. The
  `pnpm web:screenshot` helper captures the standard four viewports.
- Migration PRs get the `db-review` label and need a second approval
  from someone in the `@bramblebill/data` GitHub team.
- Do not request review while CI is red unless the failure is the
  known nightly e2e flake (link it).

## Deployment and release

Merges to `main` deploy to staging automatically. Production deploys
are promoted manually via the `promote` workflow in GitHub Actions —
pick the staging build SHA, not the branch.

Release notes are generated from conventional commits by
`tools/release-notes.ts`; anything with `feat` or `fix` scope lands in
the customer-facing changelog, so write those subjects for customers,
not for the team.

The worker and api must be deployed in the same promote when a job
payload schema changes; the payload zod schemas in shared are versioned
(`payloadV2`, etc.) for the cases where that is not possible. If you
add a `payloadV3`, keep `payloadV2` parsing for two releases.

## Gotchas

- Never use JavaScript number arithmetic for invoice amounts; always
  use the `Money` type from `@bramblebill/shared`.
- The `invoices.status` enum in Postgres has a `voided` value that the
  TypeScript union does not include. It is unreachable for new data
  (legacy rows from 2024 only) but zod parses on read will throw if
  you forget `voided` in a new schema.
- `pnpm dev` swallows the worker's startup error if Redis is not up
  yet; the symptom is jobs queueing forever with no error. Restart
  the dev command after compose is healthy.
- Tenant `t_0` is the platform-internal tenant used for system
  records. RLS lets the worker read it. Do not write tests against it.
- The OFX bank-feed parser is duplicated: `parseOfx` (current) and
  `parseOfxLegacy` (kept for one pilot customer on a credit union that
  emits malformed SGML). Changes usually need to land in both; there
  is a TODO from 2025-07 to merge them that nobody has picked up.
- Vite's proxy strips the `x-bb-tenant` header if you add a custom
  `configure` hook to the proxy entry. This has burned three people.
- `Money.toJSON()` serializes as `{ amount: string, currency }` —
  amount is a string because bigint. Frontend code that does
  `Number(amount)` is wrong for JPY-scale values and will be flagged
  by the `no-money-number` custom lint rule, but only in `web`.
- CI Postgres is 16.4 but compose pins 16.1; `MERGE ... RETURNING`
  works in CI and fails locally. Bump compose if you hit it.

## Webhooks

Outbound webhooks fan out from the worker (`webhook-fanout.job.ts`).
Payloads are signed with a per-endpoint secret using HMAC-SHA256 in the
`bb-signature` header; the verification snippet customers get is in
`packages/shared/src/webhooks/verify.ts` and is published verbatim, so
treat its public API as frozen.

- Delivery is at-least-once with exponential backoff over 24h
  (8 attempts). After that the endpoint is marked `failing` and a
  notification email goes to the tenant admin.
- Event payloads are append-only: adding fields is fine, renaming or
  removing fields is a breaking change that needs product sign-off.
- Local development: `pnpm webhook:listen` runs a local receiver that
  prints signed payloads and verifies them against your dev secret.

## Email templates

Transactional email (dunning, receipts, webhook-failure notices) is
MJML in `packages/worker/src/email/templates`, compiled at build time.
Mailpit catches everything locally — nothing ever leaves the machine
in dev, see the dunning guard in Architecture notes.

- Subject lines and body strings come from `email-strings.yaml`, one
  block per locale. English (`en`) is the source of truth; other
  locales fall back per-string, not per-template.
- Currency amounts in emails are formatted by `Money.format(locale)`.
  Hand-rolled `Intl.NumberFormat` calls in templates get rejected in
  review because they miss the JPY/KRW zero-decimal cases.
- Preview any template change with `pnpm email:preview <template>`,
  which renders all locales side by side on port 8026.

## Performance

The hot paths are invoice list queries and the reconciliation matcher.
Both have benchmark harnesses (`pnpm bench --filter @bramblebill/api`)
that run on a fixed seed dataset of 200k invoices.

- The matcher must stay under 250ms p95 for a 5k-transaction feed on
  the bench machine profile; CI tracks the number but only warns.
- Avoid N+1s by reaching for the dataloader helpers in
  `packages/api/src/lib/loaders.ts` rather than ad-hoc `Promise.all`
  over per-row queries.
- Web bundle budget: 280kB gzipped for the initial route. The
  `bundle-budget` check posts the delta on every PR touching `web`.

## Security

- Anything that reads or writes exemption certificates, bank
  credentials, or webhook secrets goes through `packages/api/src/vaulted/`
  — those values never appear in logs, job payloads, or error
  messages. The pino redaction list in `logger.ts` is a backstop, not
  the mechanism.
- Bank-feed credentials are OAuth tokens held by the aggregator; we
  store only the aggregator item id. If a change appears to need raw
  bank credentials in our database, stop and talk to #eng-payments.
- Dependency bumps that touch crypto, auth, or the OFX/SGML parsing
  chain need a security review label regardless of semver.

## Observability

- Structured logs via pino; never `console.log` in api or worker
  (the lint rule autofixes it to `logger.debug`).
- Trace ids propagate from the edge through `x-bb-trace`; the worker
  continues traces from job payloads. If you add a new queue, copy the
  `traceContext` wiring from `dunning.job.ts`.
- Metrics are StatsD via `hot-shots`. Counter names are
  `bb.<package>.<noun>.<verb>`, e.g. `bb.worker.invoice.finalized`.

## When you are stuck

Ask in #eng-platform for infra/CI, #eng-payments for reconciliation
and bank feeds, #eng-web for the dashboard. The reconciliation matcher
and the dunning scheduler both have ADRs in `docs/adr/` that explain
the non-obvious invariants — read those before proposing a rewrite.
