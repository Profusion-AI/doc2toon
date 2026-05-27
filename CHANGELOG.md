# Changelog

All notable changes to `doc2toon` will be documented in this file.

This project follows practical release notes rather than strict format ceremony.

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
