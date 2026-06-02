# Changelog

All notable changes to `doc2toon` will be documented in this file.

This project follows practical release notes rather than strict format ceremony.

## Unreleased

### Added

- Project overview and public philosophy language for useful context density, human-in-the-loop nuance decisions, and honest token-efficiency claims.
- Agent-context fixtures for `AGENTS.md`, `CLAUDE.md`, and `SKILL.md`, plus problematic fixtures for duplicate rules, vague rules, long sections, split candidates, and mixed agent context.
- Browser-safe optimizer warning primitives for duplicate rules, vague rules, long sections, and split candidates.

### Changed

- README, roadmap, CheapAgent MVP notes, and examples now frame `doc2toon` as a context-preparation and token-efficiency tool rather than a prose-preservation layer.
- `doc2toon profile` now reports advisory optimizer warnings when context-density risks are detected.

## 0.1.1 - 2026-05-27

Library-boundary hardening release.

### Added

- Reusable conversion core for text-to-TOON conversion without CLI file handling.
- Browser-safe entrypoint at `doc2toon/browser`.
- Package exports for Node and browser consumers.
- Core tests for direct conversion, validation, decoding, budget refusal, and lossy budget output.
- Public roadmap language that treats CheapAgent and `cheapagent.ai` as planned/tentative until confirmed.

### Changed

- CLI now delegates conversion orchestration to the shared core and keeps responsibility for Commander, stdin, file paths, output files, and report printing.
- Token estimation now has a browser-safe fallback, with `tokenx` isolated behind the Node-only estimator used by the CLI.
- Stats byte counting now uses `TextEncoder` instead of Node `Buffer`.

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
