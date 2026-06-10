# Roadmap

`doc2toon` is the open-source CLI and library foundation for measured document-to-TOON conversion, context preparation, and token efficiency. It optimizes for useful context density, not maximum prose fidelity. CheapAgent is the working brand for planned agent-context optimization follow-through.

## Philosophy

`doc2toon` helps prepare documents for LLM context windows by increasing useful context density.

It is not designed to preserve every flourish, repeated idea, or rhetorical aside from the source document. Humans remain responsible for deciding which nuance matters. `doc2toon` focuses on preserving structure, meaning, references, definitions, rules, and task-relevant context while reducing redundancy and avoidable token overhead.

When exact wording matters, use lossless mode.
When repeated knowledge matters, use record mode.
When a strict context budget matters, use budget mode and treat the result as lossy unless validation says otherwise.

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

## CheapAgent Hosted Alpha

Status: controlled alpha live at `https://cheapagent.ai/`.

CheapAgent web alpha should be static-first and use the reusable browser-safe core. The UI should not copy CLI internals or reach into this repository's source files. It should position CheapAgent as practical context compression, token utilization, and LLM-ready document preparation, not as a magical summarizer or a replacement for human editorial judgment.

- Paste box and `.txt` / `.md` upload.
- Modes for `CLAUDE.md`, `AGENTS.md`, `SKILL.md`, and generic document-to-TOON conversion.
- Before/after character and token estimates.
- Optimizer warnings for duplicate rules, vague rules, long sections, and split candidates.
- Copy and download actions for output.
- Anonymous 1000 character limit.
- Browser-side conversion where possible.
- No hosted LLM API dependency.
- No login in alpha.
- Measured savings and warnings instead of universal compression claims.

## v0.2 Beta

Status: shipped 2026-06-10 (app features live on cheapagent.ai; doc2toon 0.2.x published to npm via OIDC trusted publishing). The user-facing beta features landed in the CheapAgent app repository.

- Lightweight sign-in via email plus password with confirmation, with Netlify Identity owning credentials. (Magic links were the original plan, but Netlify Identity does not support passwordless magic links.)
- 15000 characters per day for signed-in users, enforced server-side by debiting character counts only.
- Minimal account metadata only: user id, email, usage count, timestamps.
- No document body storage by default; document bodies never leave the browser.
- Plain-language privacy page.
- No billing in v0.2.
- `doc2toon` published to npm so CheapAgent can depend on a registry version instead of a git-pinned commit.

## v0.3.0 — The verdict contract

Status: in progress.

- Stable verdict schema v1 (`schemas/verdict.v1.json`): a machine-readable decision object with `verdict`, profile, measured character deltas, token estimates, `toon_candidate`, coded `warnings[]`, and `safe_to_auto_apply`. Versioned and frozen; changes after the freeze follow documented additive-only rules.
- `--json` output on `profile` and `convert` emitting the verdict schema exactly; `validate --json` emitting a structured validation result. Exit-code contract plus `--fail-on` for CI.
- OpenAPI 3.1 spec (`openapi/cheapagent.v1.yaml`) for `POST /v1/profile`, `/v1/convert`, and `/v1/validate` — one contract, two transports: localhost now, hosted later.
- Realistic agent-context fixtures (`fixtures/agent-context/realistic/`) and verdict threshold calibration.
- Deprecations: the `toon-doc` bin alias and the `lossless-doc`/`llm-context` mode aliases warn in 0.3 and are removed at 1.0.

## v0.4.0 — The agent interface

Status: planned.

- MCP server: `doc2toon mcp` subcommand plus a `doc2toon-mcp` bin exposing `profile` and `convert` as tools that return verdict objects.
- `doc2toon serve --port 8787`: local HTTP exposure of `POST /v1/profile`, `/v1/convert`, `/v1/validate` (binds 127.0.0.1 by default).
- Transport-free HTTP handlers exported from the Node entrypoint for reuse by hosted deployments.
- GitHub Action (composite `action.yml`, consumed via the `action-v1` tag): context-budget checks that comment on pull requests.

## Deferred

- Multi-file uploads, compact Markdown rewrite output, and split-skill recommendations: revisit after the current 30-day plan.
- DOCX and text-based PDF support: deferred this quarter — extraction and trust are category-changing problems.
- Paid hosted convenience tier: demand-gated; the hosted API ships as a published contract first and becomes a service only on validated demand.

## Brand And Domain

CheapAgent is a working brand and `cheapagent.ai` serves the controlled alpha over valid HTTPS. `www.cheapagent.ai` redirects to apex. `cheapagent.netlify.app` currently mirrors production and should not be described as staging until a separate Netlify staging site exists.
