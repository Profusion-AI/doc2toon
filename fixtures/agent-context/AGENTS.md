# AGENTS.md - doc2toon

## Project Purpose

`doc2toon` prepares Markdown, plain text, and pasted documents for LLM context windows. It profiles the source, selects a compact canonical shape, encodes valid TOON, validates the round trip, and reports measured character and token estimates.

## Product Philosophy

- Treat context as finite working memory.
- Optimize for useful context density, not maximum prose fidelity.
- Preserve operational meaning, useful structure, references, definitions, rules, and task-relevant context.
- Do not preserve redundancy unless it supports cross-reference, traceability, or task accuracy.
- Humans decide which nuance matters; `doc2toon` identifies context that may be inefficient, redundant, or structurally overloaded.

## Supported Inputs

- Markdown files.
- Plain text files.
- Pasted or piped stdin.
- Agent-context documents such as `AGENTS.md`, `CLAUDE.md`, and `SKILL.md`.

## Expected Commands

- Use `npm run build` after TypeScript changes.
- Use `npm test` after parser, core, or analyzer changes.
- Use `npm run smoke` before finishing a user-facing change.
- Use repo scripts instead of improvising local command sequences when a script exists.

## Testing Expectations

- Cover parser and optimizer behavior with focused fixtures.
- Validate official TOON encode/decode round trips for conversion changes.
- Keep warning analyzer tests deterministic and browser-safe.
- Do not log source document bodies in tests or CLI output unless the command explicitly writes a requested output file.

## Documentation Expectations

- Public docs must avoid universal savings claims.
- Measured savings must not be overstated.
- Budget mode must be described as lossy when semantic compression is used.
- TOON should be described as useful for repeated structure, not arbitrary prose compression.

## Privacy Expectations

- Treat source documents as user-controlled local input.
- Do not add hosted processing, document storage, telemetry, or body logging without explicit product approval.
- Do not commit secrets, private notes, customer data, or personal operating context.

## Context Architecture

- Keep `AGENTS.md` lean and canonical.
- Keep tool-specific adapters minimal.
- Put deeper task-triggered procedures in `SKILL.md` files or docs that are loaded on demand.
- Long procedural detail does not belong in always-on agent context when a skill can carry it.
