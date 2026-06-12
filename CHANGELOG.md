# Changelog

All notable changes to `doc2toon` will be documented in this file.

This project follows practical release notes rather than strict format ceremony.

## 0.4.1 - 2026-06-12

Docs-only patch, caught by dogfooding the install path against the published registry minutes after 0.4.0: the MCP install snippets used `npx -y doc2toon-mcp@0.4.x`, but `doc2toon-mcp` is a **bin inside the `doc2toon` package**, not a package — npx would 404. Corrected everywhere to `npx -y -p doc2toon@0.4.x doc2toon-mcp` and verified end-to-end on Windows by spawning the exact `cmd /c npx -y -p doc2toon@0.4.x doc2toon-mcp` client-config form from a neutral directory against the registry (tools listed, profile answered). No code changes; README/docs are in the tarball, hence the patch.

## 0.4.0 - 2026-06-12

The agent-interface release (30-day plan, Phase 4) plus context plans (pulled forward from the post-gate block by explicit call). Agents can now call doc2toon three ways — MCP tools, localhost HTTP, and the CLI — and every surface emits the same frozen verdict object from the same engine. Document bodies never leave the machine on any of them.

### Added (MCP server)

- `doc2toon-mcp` bin (the documented client-config form) and `doc2toon mcp` subcommand — an MCP stdio server with tools `profile`, `convert`, `plan`, `validate`. Tool results carry the verdict as `structuredContent` plus a JSON text block; tool inputs mirror the OpenAPI request components verbatim; a budget refusal or invalid TOON is a representable result (`verdict: "refused"` / `valid: false`), never a tool error — only malformed requests are `isError`, carrying the same `{"error":{code,message}}` envelope HTTP returns. Tools are read-only-annotated; output schemas are deliberately compact pointers at the canonical `schemas/verdict.v1.json` rather than ~12 kB of inline schema per tool (context efficiency, practiced). Install snippets incl. the verified Windows `cmd /c npx` form: `docs/mcp.md`. New runtime dependency: `@modelcontextprotocol/sdk` (Node surfaces only — the browser entrypoint pulls none of it, purity-test-enforced).
- Test-enforced parity: an MCP tool's `structuredContent` deep-equals the HTTP body and the library output for the same input (`test/mcp.test.ts`, including a real-stdio spawn of the built bin).

### Added (`doc2toon serve`)

- `doc2toon serve [--port 8787] [--host 127.0.0.1] [--cors <origin>]` — the localhost HTTP transport of the frozen contract, zero new dependencies (`node:http`). `POST /v1/profile`, `/v1/convert`, `/v1/validate`, `/v1/plan`; `GET /v1/openapi.yaml` serves the packaged spec; `/v1/estimate` and `/v1/batch` answer 501 (spec-only in v1). Privacy posture is structural: binds `127.0.0.1` unless an explicit `--host` says otherwise; no CORS unless an explicit `--cors origin`; 2 MB body cap (413, with the remaining body drained so clients read the response instead of a connection reset). HTTP mapping per decision 8: representable verdicts are 200 — refusal included; envelopes for 400/404/405/413/500.
- `src/http-handlers.ts` — transport-free `handleProfile/Convert/Validate/Plan(parsedBody) → {status, body}`, exported from the Node entrypoint. This is the piece a hosted function imports verbatim ("one contract, two transports" enforced in code). Request validation is strict per the spec: `additionalProperties: false`, canonical mode names only (CLI aliases stay CLI-only courtesies and are 400s on the wire).
- `POST /v1/plan` flipped from `x-status: planned` to implemented in `openapi/cheapagent.v1.yaml` (new `PlanRequest` component; the one endpoint emitting `schema_version: "1.1"`). Sync tests extended: spec-only routes must carry `x-status: planned`, implemented routes must not.

### Added (context plans — pulled forward, `docs/context-plan-design.md`)

Context plans: section-level verdicts as the main workflow (QC-amended 2026-06-11). `split_first` stops being the end of the conversation — the plan measures every heading-bounded section of a document as a standalone document under the **unchanged frozen policy** (zero new tunable constants) and recommends a hybrid only when the net savings, splice overhead included, clear the same frozen 5% band.

### Added (CLI)

- `doc2toon plan [--json] [--out <hybrid.md>] <file>`: per-section context plan. Pretty mode prints the whole-document verdict plus a plan table (every section's standalone verdict and measured delta — `keep` rows included — net, `recommend_hybrid`, `reassembly_verified`, plan-level `safe_to_auto_apply`). `--out` writes the hybrid Markdown document: converted sections become fenced ` ```toon ` blocks in place (heading line kept as Markdown, fence content is exactly the measured candidate, fence length adapts past embedded backticks), everything else byte-identical. Exit-code contract identical to `profile`; `--fail-on` keys on the whole-document verdict — plans inform, the verdict gates.

### Added (wire contract — Verdict 1.1, additive)

- Optional `context_plan` field on the verdict object (`schemas/verdict.v1.json` + `openapi/cheapagent.v1.yaml` in lockstep; `/v1/plan` first specified as planned, then implemented by `serve` within this same release). **Emission contract:** only the plan surface emits `schema_version: "1.1"`; `profile`/`convert` output stays `"1.0"` byte-for-byte — existing snapshots prove it. Every measured section carries `heading`, `kind` (`section`/`preamble`/`frontmatter`), source `range` (lines + `[char_start, char_end)`), standalone `profile`/`verdict`/`measured_chars`, offset-to-document warning ranges, and section-level `safe_to_auto_apply`; frontmatter is always `keep` and never measured (`null` measurement, honestly labeled). Plan-level `safe_to_auto_apply` is non-vacuous: `recommend_hybrid AND converted count > 0 AND all converted sections safe AND reassembly_verified`.

### Added (engine)

- `src/plan-sections.ts`: source-range-preserving section splitter — the author's own ATX headings, fence-aware exactly as the parser is, YAML frontmatter sectioned and kept. The slices partition the document byte-for-byte (asserted at runtime, re-proved per fixture by the reassembly property test).
- `src/plan.ts`: `buildContextPlan(text, opts)` — per-section `runVerdict` composition, hybrid assembly, net math on the exact assembled string, and mechanical reassembly verification (kept bytes identical, converted candidates decode as embedded, full re-stitch). Browser-safe, exported from both entrypoints.

### Added (repo)

- Pre-registration trail completed before any plan code ran against the corpus: the internal 19 pinned by SHA-256 in `fixtures/agent-context/external/README.md` (the external lane-1 19 were already pinned by manifest SHA); the actionable-plan-rate metric definition was already pre-registered there.
- **The pre-registered metric, measured on the pinned corpus** (`scripts/benchmark-plans.mjs` → `fixtures/agent-context/external/plan-results.json`; internal pins hash-verified before measuring): **internal 1/19, external lane-1 1/19, combined 2/38 plan-positive** — the "one-third" planning hypothesis is refuted and the measured rate is published as-is. The external winner is `langchain-ai/langchainjs:AGENTS.md`: whole-doc `split_first`, plan net **+6.8%** from two independently-converting table sections (+49.5%, +52.0%), plan-level `safe_to_auto_apply` true, reassembly verified — the first real-world corpus document with a positive, auto-applicable recommendation. Five other docs have a converting section that nets 0.2–0.9%, below the band: the plan's honest answer for them stays "keep the whole document". The whole-document honesty denominators are unchanged.
- `test/plan.test.ts`: reassembly property over every fixture, policy-composition equivalence (a section converts iff `runVerdict` says `convert` standalone), the below-band mixed-fixture case (one table wins +21.6% standalone, net 0.4% → no hybrid recommended), non-vacuity, frontmatter, CRLF, fence-safety, and warning-offset coverage; plan snapshots per fixture; CLI plan coverage in `test/cli.test.ts`.

## 0.3.2 - 2026-06-11

External honesty corpus round 2: the lane-1 denominator grows to **19 real-world documents — 0 convert, 16 split_first, 3 keep_markdown** (measured deltas −2.8% to −86.9%, `safe_to_auto_apply` on none). No engine or contract changes; the package change is this changelog plus a README line citing the result.

### Added (repo)

- **Round-2 external corpus** (gates and three-lane architecture pre-registered before probing — see `fixtures/agent-context/external/README.md`): 9 new lane-1 documents from openai/openai-agents-python and -js, pydantic/pydantic-ai, assistant-ui/assistant-ui, astral-sh/ruff, biomejs/biome, pydantic/logfire (CLAUDE.md is the substantive doc there), and Infisical/agent-vault (both root docs substantive). Lane 2 (skill packs, separate population, never merged into the lane-1 denominator): addyosmani/agent-skills measured; its YAML frontmatter is counted as content by the profiler (frontmatter-naive — documented caveat, lane-2 numbers not cited publicly). Lane 3: 8 pointer files recorded across the corpus — the pointer-plus-substantive-doc pattern is now the norm in major repos (ruff, pydantic-ai, assistant-ui, openai-agents-python route CLAUDE.md → AGENTS.md; logfire routes the other way; biome points CLAUDE.md at CONTRIBUTING.md). vercel-labs/skills quarantined to the watchlist: no LICENSE file at the pin.
- Runner: lane-aware aggregates; pointer rule generalized to any tiny file delegating to another `.md` (the pre-registered rule is about delegation, not the target's name — biome's CONTRIBUTING.md pointer was the case in point); manifest-expectation mismatches now warn loudly.

### Notable measurements

- ruff `AGENTS.md`: `duplicate_rule` ×7, −2.8% — the closest any real-world doc came to parity, and it still loses.
- openai-agents-python `AGENTS.md`: `duplicate_rule` ×4 at −78.0%.
- Infisical/agent-vault `AGENTS.md`: −86.9%, the corpus's worst real-world case.

## 0.3.1 - 2026-06-11

The GitHub Action release. No engine or contract changes — the package change is the README
(which ships in the tarball) gaining the Action recipe; the Action itself lives in the repo
and is consumed via the `action-v1` moving tag, not npm.

### Added (repo)

- **GitHub Action — `Profusion-AI/doc2toon@action-v1`:** composite `action.yml` profiling agent docs on every PR via the published CLI (`npx doc2toon@0.3.x profile --json`). Sticky verdict-table comment (hidden-marker find-and-update), file/line annotations, `doc2toon-verdicts.json` artifact, step summary, and an optional `fail-on` gate that passes through to the CLI's own `--fail-on` so semantics never diverge. Security posture per the day-9 spike (`docs/action-fork-pr-permissions.md`): `pull_request` only, zero secret-dependent paths, comment is best-effort (detected-fork skip + caught-403 downgrade) while exit code/summary/annotations/artifact deliver everywhere. Dogfooded on a real PR: comment posted, re-push updated the same comment, `fail-on` turned the check red. Consumer recipe: `docs/example-context-check.yml` (≤15 lines). Deliberate v1 cuts, documented: no `actions/github-script` (current majors run the deprecated node20 runtime), no `token-budget`/`max-waste-pct` inputs (no waste metric exists in Verdict v1; the Action never re-derives judgment).
- **External real-world corpus (repo-side only; measured 2026-06-11, doc2toon 0.3.0):** `fixtures/agent-context/external/` extends the honesty benchmark with agent docs from 8 public repos (100+ stars gate, MIT or MIT-with-carveout verified at the pin, active since 2026-04-01), pinned to exact commit SHAs in `manifest.json` before measurement. Storage posture amended pre-measurement from vendoring to **measurements-not-copies**: `scripts/benchmark-external.mjs` fetches each file at its pin and stores provenance + verdict JSON with `toon_candidate` stripped — no third-party bodies in the repo, in-house corpus and snapshots untouched. Result (`results.json`): **10 documents counted (2 pointer files recorded, not counted), 0 convert, 9 split_first, 1 keep_markdown**; measured deltas −10.5% to −86.4%; `safe_to_auto_apply` true on none. The out-of-sample run confirms the calibrated policy's behavior on real files. No engine, contract, or package changes — nothing here ships in the tarball or gates a release.

## 0.3.0 - 2026-06-10

The verdict release: the frozen Verdict v1 contract (schema + OpenAPI spec in the tarball), the verdict engine behind every surface, and machine-readable CLI output with a CI-grade exit-code contract. Phases 1–2 of the 30-day plan.

### Added (CLI)

- `--json` on `profile` and `convert` emits the Verdict v1 object (`schemas/verdict.v1.json`): `profile` withholds `toon_candidate` so agents can decide before spending context; `convert` includes it. `--out` is optional under `--json` (write confirmations go to stderr; stdout stays pure JSON).
- Exit-code contract (schema doc, decision 8): any representable verdict exits 0 — including `refused` (budget unreachable losslessly without `--allow-lossy`) and `keep_markdown`. I/O, argument, and internal failures — including argument errors commander itself raises — exit 1 with a `{"error":{code,message}}` envelope (`bad_request`, `input_not_found`, `internal`).
- `validate --json` returns the spec's ValidationResult (`{schema_version, valid, error}`, `invalid_toon` coded) and keeps exit 1 on invalid TOON so validation gates fail builds.
- `--fail-on <list>`: comma-separated verdicts and/or severities that set exit 1 after the output is printed; `info` is a threshold (any warning).
- Pretty reports lead with the verdict and render the unified coded warnings; `profile` now runs the lossless trial conversion the contract requires (decision 9), so its report carries measured savings.
- Deprecated, removed at 1.0 (warnings on stderr): the `toon-doc` bin alias (now a dedicated wrapper bin so the warning fires through Windows cmd shims too) and the `lossless-doc`/`llm-context` mode aliases.
- `test/cli.test.ts` (spawns the built CLI; Windows-runnable; fails fast on a stale build) and smoke coverage for the `--json` surface with ajv validation via `scripts/check-verdict-json.mjs`.

### Changed (CLI, pretty mode)

- Conversion/profile reports are verdict-first; warning bullets carry `[code]` prefixes (prose is a rendering of codes — scripts that scraped pretty text should move to `--json`).
- `validate`/`decode` report missing files as `Input file not found` like the other commands, instead of leaking Node's ENOENT text.
- `convert` validates flags before reading input: a missing `--out` fails immediately instead of after stdin is consumed; `--json-sidecar` without `--out` is rejected.
- A candidate that fails its own round-trip is an internal error (exit 1) on both renderings — never a confident exit-0 verdict.

### Fixed

- **The measured corpus is line-ending-pinned** (`fixtures/**`, `examples/**` → LF in `.gitattributes`): verdict decisions derive from character counts, and a CRLF checkout measured different savings than the LF content CI and the npm tarball see — the same fixture measured −1.5% at LF and +0.4% at CRLF, and the snapshot suite failed on ubuntu because of it. Snapshots, the calibration table, and every documented number are regenerated from LF truth.

### Added (engine — Phase 1, merged at the freeze)

- `src/verdict.ts`: `buildVerdict(result, opts)` maps a `ConversionResult` to the `VerdictV1` wire object (`schemas/verdict.v1.json`); `runVerdict(text, opts)` converts and never throws on representable outcomes — budget refusal returns `verdict: "refused"` in-band. Exported from both the Node and browser entrypoints; the browser-purity test covers the module.
- `VerdictV1`, `VerdictDecision`, `CodedWarning` and supporting types in `src/types.ts`, mirroring the wire exactly (snake_case, no mapping layer).
- Unified coded `warnings[]`: optimizer kinds pass through as codes; conversion-state codes (`negative_savings`, `lossy_applied`, `target_not_reached`, `budget_refused`) derive from result fields, never from prose. `ConversionResult`'s existing string/optimizer channels are unchanged.
- Content-coverage check (decision 12): `measureContentCoverage` measures the share of source content characters retained by the canonical; below `LOW_COVERAGE_RATIO` (0.70) a `low_coverage` warning (severity `warning`) fires. Record-mode runs that "win" by dropping content (+91.6% at 8% coverage on the RFC fixture) now land on `review`, never `convert`. `low_coverage` joins the v1 warning registry in the schema and OpenAPI spec.
- `BudgetRefusedError` (subclass of `Error`, message unchanged) carries the attempted lossless candidate so refusals are representable without message parsing.
- Estimator identity constants: `NODE_TOKEN_ESTIMATOR_ID` (read from the pinned tokenx version) and `CHARS_PER_TOKEN_ESTIMATOR_ID`, carried in `token_estimates.estimator`.
- Tests: `test/verdict.test.ts` (per-fixture snapshots + ajv validation against the schema + estimator-parity proving decisions identical under chars-per-token and tokenx) and `test/openapi-sync.test.ts` (deep equality between `components.schemas.Verdict` and the JSON Schema modulo `$schema`/`$id`). ajv and yaml are devDependencies only; runtime deps stay at three.
- `scripts/calibration-table.mjs` + `docs/calibration-v1.md`: the hand-verified calibration table over every fixture and the CheapAgent web samples, both modes, with coverage and verdicts.

### Changed (engine and docs)

- Decision policy calibrated against the fixture corpus (constants only; the schema is untouched): `MIN_CONVERT_SAVINGS_PCT` (5%) keeps near-zero wins (glossary.md record mode: +4.7%) at `keep_markdown` — measurements that small sit inside encoding-level noise; sections that are ≥60% uniform table rows are exempt from `long_section` (`LONG_SECTION_TABLE_LINE_RATIO`), making the decode-verified table win class (+21.1%) reachable as `convert` with `safe_to_auto_apply`.
- `docs/verdict-schema-v1.md`: the seven open calibration questions are answered with fixture data; the worked example now carries engine-true pinned values (including `long_section` severity `info`).
- Realistic-fixture README re-measured on the calibrated engine.
- `scripts/benchmark-honesty.mjs` reports the engine's own verdict instead of a raw sign bit: "win" now means `buildVerdict` says `convert` (savings band applied — a sub-band delta is honestly not a win), warnings are the coded set, and the stale "coverage unverified" caveat is replaced by the shipped `low_coverage` semantics.

## 0.2.1 - 2026-06-10

Publishing-pipeline patch. Library and CLI behavior are unchanged from 0.2.0.

### Changed

- Publish workflow authenticates via npm trusted publishing (OIDC) instead of a token secret; the `NODE_AUTH_TOKEN` env was removed. The token path existed only because trusted publishing cannot perform a package's first publish.
- `package.json` carries `repository`, `homepage`, and `bugs` metadata; `npm publish --provenance` requires `repository.url` to match the repository the workflow runs from (the 0.2.0 publish initially failed with E422 until this was added).
- README shows the npm version badge now that the package is registry-visible.

## 0.2.0 - 2026-06-10

Beta-lane release. The library and CLI behavior are unchanged from v0.1.2; this release exists to land doc2toon on the npm registry and to anchor the CheapAgent v0.2 beta (sign-in, daily usage limits, privacy page) on a published package instead of a git-pinned commit.

### Changed

- Publish workflow now authenticates with an `NPM_TOKEN` repository secret so the first registry publish can succeed; npm trusted publishing requires a package to already exist, which is why the v0.1.1 and v0.1.2 publish attempts failed.
- Publish workflow now publishes to the default `latest` dist-tag. Publishing a first release under `--tag alpha` would have left the package without a `latest` tag, breaking plain `npm install doc2toon`.
- Roadmap now records the v0.2 beta as in progress, with sign-in, quota, and privacy-page work landing in the CheapAgent app rather than this repository.

## 0.1.2 - 2026-06-02

Packaging retry release after the `v0.1.1` tag workflow passed build/test/smoke/pack but failed at npm publication before the package became registry-visible.

### Changed

- Normalized CLI `bin` paths to npm's publish-preferred form.
- Kept the v0.1.1 library boundary, browser export, package contents, and controlled-alpha documentation posture.

## 0.1.1 - 2026-06-02

Library-boundary and packaging hardening release.

### Added

- Project overview and public philosophy language for useful context density, human-in-the-loop nuance decisions, and honest token-efficiency claims.
- Agent-context fixtures for `AGENTS.md`, `CLAUDE.md`, and `SKILL.md`, plus problematic fixtures for duplicate rules, vague rules, long sections, split candidates, and mixed agent context.
- Browser-safe optimizer warning primitives for duplicate rules, vague rules, long sections, and split candidates.
- Reusable conversion core for text-to-TOON conversion without CLI file handling.
- Browser-safe entrypoint at `doc2toon/browser`.
- Package exports for Node and browser consumers.
- Core tests for direct conversion, validation, decoding, budget refusal, and lossy budget output.

### Changed

- README, roadmap, CheapAgent MVP notes, and examples now frame `doc2toon` as a context-preparation and token-efficiency tool rather than a prose-preservation layer.
- `doc2toon profile` now reports advisory optimizer warnings when context-density risks are detected.
- CLI now delegates conversion orchestration to the shared core and keeps responsibility for Commander, stdin, file paths, output files, and report printing.
- Token estimation now has a browser-safe fallback, with `tokenx` isolated behind the Node-only estimator used by the CLI.
- Stats byte counting now uses `TextEncoder` instead of Node `Buffer`.
- Public roadmap language now treats CheapAgent as the separate hosted app surface, with `cheapagent.ai` live as a controlled alpha while broader launch claims remain measured and alpha-oriented.

## 0.1.0 - 2026-05-27

Initial public release.

### Added

- Local `doc2toon` CLI for Markdown, plain text, and stdin conversion.
- Profile-first conversion for prose, definitions, requirements, tables, and mixed documents.
- `lossless`, `record`, and `budget` modes.
- TOON encode/decode round-trip validation with `@toon-format/toon`.
- Metrics reporting for source size, TOON size, token estimates, and measured savings.
- Optional JSON sidecar output.
- Delimiter selection for record-shaped output.
- Budget-mode refusal unless lossy semantic compression is explicitly allowed.

### Notes

- This release is independent from the official TOON project.
- Savings are document-dependent. Measure actual output before claiming compression.
- Lossless prose may not shrink. Budget mode may require semantic compression and should be treated as lossy when marked that way.
