# Changelog

All notable changes to `doc2toon` will be documented in this file.

This project follows practical release notes rather than strict format ceremony.

## Unreleased

Verdict engine + calibrated contract (Phase 1 of the 30-day plan; ships in v0.3.0).

### Added

- `src/verdict.ts`: `buildVerdict(result, opts)` maps a `ConversionResult` to the `VerdictV1` wire object (`schemas/verdict.v1.json`); `runVerdict(text, opts)` converts and never throws on representable outcomes — budget refusal returns `verdict: "refused"` in-band. Exported from both the Node and browser entrypoints; the browser-purity test covers the module.
- `VerdictV1`, `VerdictDecision`, `CodedWarning` and supporting types in `src/types.ts`, mirroring the wire exactly (snake_case, no mapping layer).
- Unified coded `warnings[]`: optimizer kinds pass through as codes; conversion-state codes (`negative_savings`, `lossy_applied`, `target_not_reached`, `budget_refused`) derive from result fields, never from prose. `ConversionResult`'s existing string/optimizer channels are unchanged.
- Content-coverage check (decision 12): `measureContentCoverage` measures the share of source content characters retained by the canonical; below `LOW_COVERAGE_RATIO` (0.70) a `low_coverage` warning (severity `warning`) fires. Record-mode runs that "win" by dropping content (+91.7% at 8% coverage on the RFC fixture) now land on `review`, never `convert`. `low_coverage` joins the v1 warning registry in the schema and OpenAPI spec.
- `BudgetRefusedError` (subclass of `Error`, message unchanged) carries the attempted lossless candidate so refusals are representable without message parsing.
- Estimator identity constants: `NODE_TOKEN_ESTIMATOR_ID` (read from the pinned tokenx version) and `CHARS_PER_TOKEN_ESTIMATOR_ID`, carried in `token_estimates.estimator`.
- Tests: `test/verdict.test.ts` (per-fixture snapshots + ajv validation against the schema + estimator-parity proving decisions identical under chars-per-token and tokenx) and `test/openapi-sync.test.ts` (deep equality between `components.schemas.Verdict` and the JSON Schema modulo `$schema`/`$id`). ajv and yaml are devDependencies only; runtime deps stay at three.
- `scripts/calibration-table.mjs` + `docs/calibration-v1.md`: the hand-verified calibration table over every fixture and the CheapAgent web samples, both modes, with coverage and verdicts.

### Changed

- Decision policy calibrated against the fixture corpus (constants only; the schema is untouched): `MIN_CONVERT_SAVINGS_PCT` (5%) keeps rounding-error wins (+0.4% measured on the RFC fixture) at `keep_markdown`; sections that are ≥60% uniform table rows are exempt from `long_section` (`LONG_SECTION_TABLE_LINE_RATIO`), making the decode-verified table win class (+22.2%) reachable as `convert` with `safe_to_auto_apply`.
- `docs/verdict-schema-v1.md`: the seven open calibration questions are answered with fixture data; the worked example now carries engine-true pinned values (including `long_section` severity `info`).
- Realistic-fixture README re-measured on the calibrated engine.

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
