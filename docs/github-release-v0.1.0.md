# doc2toon v0.1.0 Release Notes

`doc2toon` is a local CLI for turning Markdown, plain text, and pasted stdin into measured, validated TOON context for LLM use.

## Highlights

- Profile-first conversion for `.md`, `.txt`, and stdin.
- Commands: `profile`, `convert`, `validate`, and `decode`.
- Modes: `lossless`, `record`, and `budget`.
- Compact schemas for prose sections, definitions, requirements, and tables.
- Official `@toon-format/toon` encode/decode round-trip validation.
- Character and estimated token metrics on every conversion.
- Budget refusal unless semantic compression is explicitly allowed with `--allow-lossy`.

## Install From A Local Clone

```bash
npm install
npm run build
npm link
doc2toon --version
```

Expected version:

```text
0.1.0
```

## Example Commands

```bash
doc2toon profile examples/definitions.md
doc2toon convert examples/prose.md --mode lossless --out tmp/prose.toon
doc2toon convert examples/definitions.md --mode record --delimiter tab --out tmp/defs.toon
doc2toon convert examples/prose.md --mode budget --target-chars 1000 --allow-lossy --out tmp/budget.toon
doc2toon validate tmp/defs.toon
doc2toon decode tmp/defs.toon --out tmp/defs.json
```

## Known Limits

- Lossless prose may not shrink. TOON removes repeated structure; it does not compress irreducible semantic text.
- Token counts are estimates unless checked with the target model tokenizer.
- Budget mode can be lossy and should be treated as semantic compression.
- PDF, DOCX, OCR, hosted conversion, accounts, and paid tiers are not part of v0.1.0.

## Roadmap

- 2026-05-27: `doc2toon` v0.1.0 public CLI release.
- 2026-05-28: CheapAgent is the working brand for planned agent-context optimization follow-through; `cheapagent.ai` is a tentative planned domain until ownership is confirmed.
- `v0.1.x`: reusable core extraction, browser-safe entrypoints, parser coverage, fixtures, docs, packaging hardening.
- `v0.2.0`: static-first CheapAgent web interface for paste, `.txt`, `.md`, `AGENTS.md`, `CLAUDE.md`, and `SKILL.md`; anonymous 1000 character limit; signed-in 15000 characters per day; browser-side conversion where possible.
- `v0.3.0`: agent-context compiler direction with multi-upload, target-aware outputs for agent instruction files, additional formats, and paid hosted convenience while keeping the CLI open source.

## Credits

Built on the TOON ecosystem and the official `@toon-format/toon` tooling. TOON is MIT licensed, copyright 2025-PRESENT Johann Schopplich.

`doc2toon` is independent and is not an official TOON project.
