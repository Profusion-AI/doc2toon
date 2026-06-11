# External corpus — real-world documents (intake contract)

**Status:** sources pinned 2026-06-11 (`manifest.json`); measured via `scripts/benchmark-external.mjs`; results in `results.json`.
**Scope:** repo-side benchmark infrastructure — nothing here ships in the npm tarball or changes the engine.

This corpus extends the honesty benchmark with documents we did **not** write. The in-house
corpus (one directory up) is original content describing fictional projects — realistic, but
authored by the team that built the verdict policy. Third-party documents remove that
objection. The methodology below was written down **before** the documents were measured, so
results cannot quietly shape the rules.

## Amendment 2026-06-11 — measurements, not copies

The original intake contract (committed earlier the same day, before any documents were
selected) assumed third-party files would be vendored verbatim into this directory. That is
**amended before any measurement**: the corpus stores **provenance and measurements only** —
source URL, pinned commit SHA, license note, char counts, verdict JSON (with `toon_candidate`
stripped), and the result table. Bodies and derived TOON bodies are never committed. The
posture: *we analyzed publicly licensed files, attribute the source, pin the commit, and
publish measurements — not copied content.*

Consequences of the amendment:

- Reproduction is via `node scripts/benchmark-external.mjs`, which re-fetches each file at
  its **pinned SHA** (immutable content) and re-measures. Same pins, same bytes, same numbers.
- The in-house benchmark and snapshot suites glob `fixtures/` for `.md` files; since no
  third-party `.md` ever lands here, the in-house corpus stays exactly 19 and its snapshots
  are untouched. The external run is a separate, out-of-sample report.
- The EOL trap is avoided by construction: files are measured as fetched (the blob bytes at
  the pin), never checked out through git smudge. The original EOL is recorded per file.

## Pre-registered methodology (unchanged by the amendment)

1. **Gates** (recorded per source in `manifest.json`): 100+ stars; MIT license or explicit
   MIT for non-enterprise content with the target file outside any carveout subtree —
   verified against the LICENSE file at the pin, not just the repo's SPDX tag; repo or
   target file active since 2026-04-01; target file is an agent-context document
   (`AGENTS.md`, `CLAUDE.md`, `SKILL.md`, or nested skill files).
2. **Pin before measuring.** Every source is pinned to an exact commit SHA in the manifest
   before any result is produced.
3. **Pointer files are not documents.** A file that only delegates (e.g. `CLAUDE.md`
   containing `@AGENTS.md`) is recorded as evidence of real agent-file linking behavior but
   never counted in the benchmark denominator. Goosing the denominator with tiny pointer
   files teaches nothing.
4. **Public-surface measurement.** Each document runs through the published CLI surface —
   `doc2toon profile --json` and `doc2toon convert --json` (defaults; lossless mode) — and
   the run records verdict, profile, `safe_to_auto_apply`, measured chars, token estimates,
   warning codes, flags, and whether TOON was emitted. The profile/convert verdict match is
   asserted per document (one policy, decision 9).
5. **Verdicts fall where they fall.** Results are published regardless of whether they help
   the thesis. Mostly `keep_markdown`/`split_first`/`review` on real files is the product
   doing its job in the wild, not a failure.
6. **No threshold tuning on intake.** Decision-policy constants were calibrated on the
   in-house corpus (`docs/calibration-v1.md`); this run is an out-of-sample test. Any
   constant change it motivates is a separate, documented calibration event under the freeze
   rules — never bundled with intake or results commits.
7. **Publishing rule.** The honesty page and other public surfaces present aggregate
   measurements, per-document numbers with attribution, and at most short excerpts — never
   whole third-party documents. The external section *adds to* the in-house "1 of 19"
   result; it does not replace it.

## Watchlist (not canonical)

Technically tempting sources outside the MIT gate are listed in `manifest.json` under
`watchlist_not_canonical` (Apache-2.0 and community-licensed files). They enter only if the
licensing gate is explicitly relaxed — a documented decision, not a drive-by.

## Re-running / extending

- Re-run: `npm run build && node scripts/benchmark-external.mjs` (results are deterministic
  at the pins; `generated` timestamp and `retrieved` dates will differ).
- Re-pin to newer upstream commits: update `manifest.json` SHAs (gate-check again), re-run,
  and commit manifest + results together so numbers and pins never skew.
- Add a source: gate-check it, add a manifest entry with pin + license note, re-run, update
  the published counts (in-house and external cited separately).
