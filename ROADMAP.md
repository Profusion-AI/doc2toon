# Roadmap

`doc2toon` is the open-source CLI and library foundation for measured document-to-TOON conversion. CheapAgent is the working brand for planned agent-context optimization follow-through.

## v0.1.0

Status: released on 2026-05-27.

- Local CLI for `.md`, `.txt`, and stdin.
- `profile`, `convert`, `validate`, and `decode` commands.
- `lossless`, `record`, and `budget` modes.
- Official `@toon-format/toon` encode/decode validation.
- Measured character and token-estimate reporting.

## v0.1.x

Status: active hardening lane.

- Extract reusable conversion core from CLI orchestration.
- Add browser-safe package entrypoints.
- Keep `tokenx` and Node-specific behavior behind Node-only boundaries.
- Expand parser fixtures and tests.
- Add agent-instruction fixtures for `AGENTS.md`, `CLAUDE.md`, and `SKILL.md`.
- Improve package exports, docs, examples, CI, and release notes.

## v0.2.0

Status: planned.

CheapAgent web alpha should be static-first and use the reusable browser-safe core. The UI should not copy CLI internals.

- Paste box and `.txt` / `.md` upload.
- Modes for `CLAUDE.md`, `AGENTS.md`, `SKILL.md`, and generic document-to-TOON conversion.
- Before/after character and token estimates.
- Optimizer warnings for duplicate rules, vague rules, long sections, and split candidates.
- Copy and download actions for output.
- Anonymous 1000 character limit.
- Browser-side conversion where possible.
- No hosted LLM API dependency.
- No login in alpha.

## v0.2 Beta

Status: planned after anonymous flow works.

- Lightweight sign-in.
- 15000 characters per day for signed-in users.
- Minimal account metadata only: user id, email, usage count, timestamps.
- No document body storage by default.
- Plain-language privacy page.
- No billing in v0.2.

## v0.3.0

Status: planned.

- Multi-file uploads.
- Target-aware outputs for agent instruction files.
- Compact Markdown rewrite output where TOON is not the right target.
- Split-skill recommendations.
- DOCX and text-based PDF support.
- Paid hosted convenience tier, while keeping the CLI open source.

## Brand And Domain

CheapAgent is a working brand. `cheapagent.ai` is a tentative planned domain until ownership is confirmed. Public docs should not promise a launch before the domain exists.
