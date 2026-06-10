# AGENTS.md — Sluicegate

Sluicegate is the event ingestion and warehouse loading service behind the
Fennimore analytics product. It consumes events from Redpanda (Kafka API),
normalizes them against pinned Avro schemas, spools batches to an
S3-compatible object store as Parquet, and merges those batches into
ClickHouse on a five-minute cadence.

This file is the primary context for coding agents working in this repo.
Read it before touching `loader/` or `consumers/`. The runbooks under
`ops/runbooks/` cover operational incidents; this file covers development
work only.

Maintainers: @mirela-k, @dt-ohearn. Last full review: 2026-03-18.

## What this service does

Four stages, each independently deployable:

1. **Consume** — one consumer group per topic family reads from Redpanda and
   hands raw bytes to the normalizer. Consumers are deliberately thin.
2. **Normalize** — events are decoded against generated Avro stubs, coerced
   to the warehouse column model, and stamped with ingest metadata.
3. **Spool** — normalized rows accumulate in local Parquet row groups and
   upload to the object store when a batch hits 64 MB or 120 seconds.
4. **Load** — the loader merges uploaded batches into ClickHouse inside a
   48-hour dedupe horizon and records progress in the retry ledger.

Throughput is roughly 40M events/day in production. Everything is Python
3.12 except the DDL under `migrations/`, which is plain ClickHouse SQL.

## Data flow at a glance

```text
topics (redpanda)        normalize             spool                  load
orders.v3       --+
sessions.v1     --+-->  avro decode -> coerce -> parquet row groups
device.pings    --+          |                       |
billing.usage   --+          v                       v
                          sg.dlq             S3 ---> ClickHouse MERGE
                   (mismatch, oversize)                 ^
                                                        +-- retry ledger
```

## Repo layout

```text
sluicegate/
  consumers/       # consumer entrypoints, one module per topic family
  normalize/       # Avro decode + field coercion against generated stubs
  spool/           # Parquet batch writer, local staging, S3 upload
  loader/          # warehouse merge jobs, dedupe window, retry ledger
  schemas/         # Avro sources (.avsc) -- edit these
  schemas/_stubs/  # generated Python stubs -- regenerated, never hand-edited
  migrations/      # ClickHouse DDL, applied with sluice-admin
  cli/             # operator commands (sluice-admin entrypoint)
ops/
  dashboards/      # Grafana JSON, refreshed with make dashboards-export
  runbooks/        # one file per paged alert
tests/
  unit/
  integration/     # needs the compose stack from make bootstrap
  data/            # small fixture event batches, scrubbed of real ids
```

## Toolchain & setup

- Python 3.12 via `uv`. Run `uv sync --frozen` after every checkout and
  after every rebase; lockfile drift causes the weirdest mypy errors.
- `make bootstrap` starts the local stack — Redpanda, MinIO, ClickHouse —
  and seeds the eleven topics. Idempotent; about 90 seconds cold.
- `direnv` loads `.envrc.local`. Create it from `.envrc.sample` on first
  run; the sample has working defaults for the local stack.
- The `Makefile` is the front door. Raw `python -m sluicegate ...`
  invocations skip the env preflight and fail in confusing ways.
- `make check` runs ruff, mypy, and the unit suite. CI runs the same target.

## Common commands

| Command | What it does | Notes |
| --- | --- | --- |
| `make bootstrap` | start local Redpanda + MinIO + ClickHouse | idempotent, ~90 s cold |
| `make check` | ruff + mypy + unit suite | required before every PR |
| `make unit` | unit suite only | no containers needed |
| `make integration` | integration suite against local stack | needs `make bootstrap` first |
| `make run-consumer T=<topic>` | run a single consumer locally | honors `.envrc.local` |
| `make spool-drain` | force-flush staged Parquet batches | local stack only |
| `make load-local` | run a loader merge into local ClickHouse | safe to repeat |
| `make schema-stubs` | regenerate Python stubs from `.avsc` sources | commit the output |
| `make migrate-local` | apply pending DDL locally | see Migrations below |
| `make seed-events N=50000` | emit synthetic events onto local topics | dev convenience |
| `make dashboards-export` | refresh Grafana JSON in `ops/dashboards/` | run after panel edits |
| `make nuke` | tear down containers, volumes, and `.spool/` | local-only, see below |

If a task is not covered by a make target, say so in the PR description
rather than inventing one-off invocations that nobody can reproduce.

## Environment variables

All of these are read by `sluicegate/config.py` at process start; missing
required keys abort before the consumer joins its group.

| Variable | Purpose | Default |
| --- | --- | --- |
| `SLUICE_ENV` | `dev`, `staging`, or `prod` | `dev` |
| `SLUICE_BROKERS` | comma-separated broker list | `localhost:19092` |
| `SLUICE_GROUP_PREFIX` | consumer group prefix per env | `sg-dev` |
| `SLUICE_SCHEMA_DIR` | path to `.avsc` sources | `sluicegate/schemas` |
| `SLUICE_SPOOL_DIR` | local Parquet staging directory | `.spool/` |
| `SLUICE_S3_ENDPOINT` | object store endpoint | `http://localhost:9000` |
| `SLUICE_S3_BUCKET` | spool bucket name | `sluice-dev` |
| `SLUICE_CH_DSN` | ClickHouse DSN, secret outside dev | local DSN |
| `SLUICE_LOAD_WINDOW_MIN` | loader merge cadence, minutes | `5` |
| `SLUICE_DEDUPE_HORIZON_H` | dedupe window, hours | `48` |
| `SLUICE_DLQ_TOPIC` | dead-letter topic | `sg.dlq` |
| `SLUICE_LOG_FORMAT` | `json` or `console` | `console` |

Anything ending in `_DSN` or `_TOKEN` is a secret. `sluice-admin env-lint`
fails CI if one shows up in a tracked file, so don't put real DSNs in
`.envrc.sample`.

## Agent operating rules

- Read this file fully before changing anything in `loader/` or
  `normalize/`; both carry invariants that are not visible from type
  signatures alone.
- Prefer small, reviewable diffs: one consumer or one loader stage per
  branch.
- Never point a local pipeline run at the production warehouse; production
  loads go through CI only.
- Do not edit generated code under `sluicegate/schemas/_stubs/`; regenerate
  it instead.
- Run `make check` before declaring any task done. No exceptions for
  "trivial" changes.
- Ask before adding a third-party dependency; the deploy image is
  size-budgeted at 180 MB and pyarrow already eats most of it.
- Keep secrets out of the repo. Connection strings come from the
  environment, never from YAML.
- Do not rename consumer groups without a migration note; committed offsets
  are keyed to the group name.

## Do

- Run `make schema-stubs` after editing anything under `schemas/`.
- Keep consumer handlers idempotent; redelivery is routine here, not
  exceptional.
- Use the retry ledger (`loader/ledger.py`) for any new merge step that can
  partially fail.
- Add a runbook entry in `ops/runbooks/` whenever you add a paged alert.
- Gate new event fields behind FORWARD schema compatibility.
- Use `freezegun` in anything time-windowed; the dedupe horizon math is
  DST-sensitive and has regressed twice.

## Don't

- Don't run consumers against staging or prod brokers from a laptop, even
  read-only.
- Don't widen a column type in a migration without checking the loader's
  cast table (`loader/casts.py`) first.
- Don't catch `SchemaMismatch` broadly; let it route to the DLQ with the
  payload intact.
- Don't write per-event warehouse inserts; every row goes through the spool.
- Don't reorder fields in an `.avsc`; column order is part of the merge
  contract with downstream marts.
- Don't silence ruff file-wide. Line-level `noqa` with a reason comment is
  fine.

## Coding conventions

### Python style

- ruff is both linter and formatter; config lives in `pyproject.toml`.
  Line length 100.
- No implicit `Optional`. `from __future__ import annotations` everywhere.
- Module layout follows stage boundaries: nothing in `consumers/` imports
  from `loader/`, enforced by an import-linter contract.
- Prefer plain functions for stage steps; classes are for stateful
  components only (writers, ledgers, clients).

### Typing

- mypy is strict for `loader/` and `normalize/`; `consumers/` is still on
  the lenient legacy config (see SG-412).
- New code must be fully typed, including anything under `tests/`.
- `TypedDict` for row shapes, `NamedTuple` for small value pairs,
  dataclasses elsewhere. Pydantic only at config boundaries.

### Logging

- structlog only, via `get_logger(stage=...)` from `sluicegate/log.py`.
- Never log event payload bodies; they can carry user identifiers. Log ids,
  sizes, and offsets instead.
- One log line per batch, not per event. Per-event logging melted a broker
  during the 2025-11 incident.

## Event ingestion

Consumers stay thin: poll, hand bytes to `normalize`, commit. Anything
clever belongs in the normalizer where it can run without a broker.

### Topics & consumer groups

| Topic family | Topics | Group | Notes |
| --- | --- | --- | --- |
| orders | `orders.v3` | `sg-<env>-orders` | highest value, pages on lag |
| sessions | `sessions.v1`, `sessions.replay` | `sg-<env>-sessions` | replay topic is bursty |
| device | `device.pings`, `device.health` | `sg-<env>-device` | ~70% of volume |
| billing | `billing.usage` | `sg-<env>-billing` | strict ordering required |

Group names derive from `SLUICE_GROUP_PREFIX`; the prefix is owned by the
environment, not by the code.

### Schema management

- Avro sources live in `sluicegate/schemas/*.avsc`; compatibility mode is
  FORWARD for every subject.
- Make sure to run `make schema-stubs` after editing anything under
  `schemas/`.
- The stub generator pin lives in the `Makefile`; do not bump it inside a
  feature branch.
- A schema PR must include the regenerated stubs plus a row in
  `schemas/CHANGES.tsv` (date, schema, field, reason).

### Dead-letter handling

- Events failing decode or coercion route to `sg.dlq` with the original
  bytes and a `reason` header.
- Handle errors gracefully in consumer shutdown hooks; orphaned offsets
  have bitten us twice.
- `sluice-admin dlq-replay` re-emits a slice; always replay into a side
  topic and diff counts before merging back.

## Warehouse loading

The loader is the only component allowed to write to ClickHouse. It claims
uploaded batches from the object store, merges them inside the dedupe
window, and advances the per-topic watermark in the retry ledger.

### Merge semantics

- Merges are `INSERT ... SELECT` into a `ReplacingMergeTree` keyed on
  `(event_id, topic)`.
- The dedupe horizon is 48 hours (`SLUICE_DEDUPE_HORIZON_H`). Replays older
  than that will double-count; downstream marts know and accept this.
- Never point a local pipeline run at the production warehouse; production
  loads go through CI only.
- Partial failures leave a ledger row in state `claimed`; the next loader
  run resumes it. Do not clear ledger rows by hand outside an incident.

### Backfills

- Backfills go through `sluice-admin backfill --from --to --topic`; they
  reuse the normal merge path with a widened claim window.
- Use good judgment when deciding whether a failed backfill needs a full
  replay or a partial patch.
- Cap any single backfill window at 24 hours; beyond the 48-hour horizon,
  dedupe stops protecting you.
- Staging first, always, with the `--dry-run` output attached to the
  ticket.

## Testing

`tests/unit/` passes with no network and no containers, full stop.
`tests/integration/` assumes the `make bootstrap` stack is up and fails
fast when it is not.

### Unit suite

- Pure Python; broker, store, and warehouse clients are faked at the stage
  boundary (`tests/unit/fakes.py`).
- Normalizer cases are table-driven from `tests/data/cases/*.json`. Add a
  case file, not a new function, for new field coercions.
- `freezegun` for anything touching the dedupe horizon or batch timers.

### Integration suite

- Runs the full path: seed topics, consume, spool, load, then assert
  ClickHouse row counts and watermark positions.
- About 4 minutes on a warm stack. Do not mark integration cases as
  skipped to make CI green; fix them or delete them.
- Each case owns its topic namespace (`itest.<case>.*`) so cases can run in
  parallel without clobbering each other.

### Fixture data

- Batches under `tests/data/` are scrubbed: ids re-keyed, payload strings
  replaced with same-length junk.
- Never copy real production events into the repo, scrubbed or not.
- If you need a new fixture shape, generate it locally with
  `make seed-events` and scrub it with `sluice-admin scrub`.

## Migrations

- DDL lives in `migrations/NNNN_description.sql`, applied in order by
  `sluice-admin migrate`.
- Forward-only. There are no down migrations; write a new migration to
  undo a bad one.
- Column adds must be `Nullable` or carry a default; the loader and the
  DDL do not deploy atomically.
- Test every migration against the local stack with `make migrate-local`
  before opening the PR.
- Coordinate with #data-eng before any `ALTER` on `events_raw`; it is
  11 TB and mutations are slow.

## CI & deployment

Stages on every PR: ruff, mypy, unit, integration, image bake. Merges to
`main` additionally push the image and deploy to staging. Production
deploys are manual approvals in the deploy console, never automatic.

- The integration stage reuses the same compose stack as `make bootstrap`;
  if it is red on `main`, fix that before anything else.
- Image size gate: 180 MB. New dependencies usually trip this first.
- Deploy order is consumers first, then loader. The loader tolerates old
  consumers; the reverse is not guaranteed.
- Rollback is an image re-pin plus a ledger inspection; the steps live in
  `ops/runbooks/loader-rollback.md`.

## Observability

- Metrics go to Prometheus via `sluicegate/metrics.py`. Name new series
  `sg_<stage>_<thing>` and keep cardinality down: no event ids and no
  batch ids as label values.
- Dashboards live in `ops/dashboards/` as exported JSON. Edit in Grafana,
  run `make dashboards-export`, commit the diff. Hand-editing the JSON is
  a recurring source of broken panels.
- Loader progress is visible from the ledger:
  `sluice-admin ledger --topic orders.v3 --tail`.

### Alerts that page

| Alert | Meaning | First move |
| --- | --- | --- |
| `SgConsumerLagHigh` | one group >5M behind | runbook `consumer-lag.md` |
| `SgSpoolDiskPressure` | staging dir >80% full | runbook `spool-disk.md` |
| `SgLoaderStalled` | watermark frozen >20 min | runbook `loader-stalled.md` |
| `SgDlqGrowth` | DLQ rate >0.5% of intake | runbook `dlq-growth.md` |

## Troubleshooting

Recipes for situations agents hit most often in development. Production
incidents belong in `ops/runbooks/`, not here.

### Consumer lag climbing on one partition

Symptom: `make run-consumer` keeps up on ten partitions, one falls behind.
Likely cause: a hot key in `device.pings`; the partitioner is murmur2 on
`device_id`, and a few fleet gateways emit at 100x the median rate.
What to do: confirm with `sluice-admin lag --by-partition`. Hot-key skew
is a known issue; do not "fix" it by raising consumer count past the
partition count.

### Loader stalls with ledger rows stuck in `claimed`

Symptom: watermark frozen, `SgLoaderStalled` fires after 20 minutes.
Likely cause: a loader pod died mid-merge; the claim lease is 30 minutes.
What to do: wait out the lease, or run `sluice-admin ledger
--release-stale` if you can confirm the pod is gone. Never delete ledger
rows directly; that orphans uploaded batches.

### Spool directory filling up

Symptom: `.spool/` grows past a few GB on a dev machine.
Likely cause: the uploader is down or `SLUICE_S3_ENDPOINT` points nowhere.
What to do: fix the endpoint, then `make spool-drain`. Batches are safe to
re-upload; the loader dedupes on batch id.

### Stub drift after editing schemas

Symptom: mypy errors in `normalize/` referencing fields you did not touch.
Likely cause: an `.avsc` was edited without regenerating stubs.
What to do: `make schema-stubs`, commit the diff. CI has a drift gate
(`sluice-admin stub-drift`) that fails the PR with the same message.

### DLQ growing right after a deploy

Symptom: `SgDlqGrowth` fires within minutes of a consumer deploy.
Likely cause: the consumer shipped ahead of a FORWARD-incompatible schema
change.
What to do: roll the consumer back first, then sort out the schema. The
DLQ keeps original bytes, so a replay after the fix loses nothing.

## Local data reset

When the local stack gets into a weird state, reset it instead of
debugging container internals:

```bash
make nuke            # stops containers, removes volumes, clears .spool/
make bootstrap       # fresh stack
make seed-events N=10000
```

`make nuke` is local-only by construction; it refuses to run when
`SLUICE_ENV` is anything other than `dev`.

## Performance footguns

- The normalizer is the CPU hotspot. It decodes in batches of 500; do not
  drop to per-event decode calls, the fastavro batch path is 8x faster.
- pyarrow owns the Parquet writes. Do not hand-roll row group sizing; the
  64 MB target in `spool/writer.py` was tuned against prod object-store
  latency.
- ClickHouse merges parts asynchronously. Do not add `OPTIMIZE TABLE`
  calls to the loader; let the engine schedule merges.

## Branch & commit conventions

- Branches: `sg/<area>-<short-desc>`, e.g. `sg/loader-claim-lease`.
- Commit subjects: imperative, 72 chars max; the body explains the why for
  anything touching `loader/`.
- One logical change per PR. Stacked PRs are fine; link both directions.
- Squash-merge is the default; the squash subject becomes the deploy log
  line, so keep it meaningful.

## On-call notes for agents

Agents do not take pages, but PRs land while a human is on call. Two
courtesies keep that workable:

- Call out any change to alert thresholds or runbook steps prominently in
  the PR description, and tag the current on-call from `#sg-oncall`.
- Avoid merging loader changes after 16:00 UTC on Fridays; the merge
  window reopens Monday 08:00 UTC. Yes, this is deliberate, not
  superstition.

## PR checklist

1. `make check` green locally.
2. Integration suite run if `loader/`, `spool/`, or `consumers/` changed.
3. Regenerated stubs committed whenever `.avsc` sources changed.
4. New env vars added to the table in this file, with defaults.
5. Runbook touched when alert behavior changes.
6. No payload bodies in any new log line.
7. `schemas/CHANGES.tsv` row added for schema edits.

## Glossary

- **Spool**: the local staging area where normalized rows accumulate as
  Parquet row groups before upload.
- **Dedupe horizon**: the trailing window (48 h default) in which the
  loader treats repeated event ids as replays rather than new rows.
- **Retry ledger**: a ClickHouse table recording claim and merge progress
  so a crashed loader resumes instead of double-merging.
- **Watermark**: the max event timestamp durably merged for a topic;
  drives the `SgLoaderStalled` alert.
- **Batch id**: the content hash of an uploaded Parquet object; the
  loader's idempotency key.
- **DLQ**: the dead-letter topic (`sg.dlq`) holding events that failed
  decode or coercion, original bytes preserved.

## History notes

- 2026-03: loader rewritten from cron-driven inserts to ledger-driven
  merges. References to `load_cron.py` are stale; delete them on sight.
- 2025-11: the per-event logging incident. See Logging, and do not repeat
  it.
- TODO(@dt-ohearn): `billing.usage` consumer still uses the lenient mypy
  config; the strict-mode migration is tracked in SG-412.
