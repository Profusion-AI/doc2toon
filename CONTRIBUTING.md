# Contributing

Thanks for helping improve `doc2toon`.

## Project stance

`doc2toon` is a practical local CLI for converting Markdown, plain text, and stdin into TOON. Keep changes grounded in measured behavior.

Before proposing or merging a savings claim:

- include the input type
- include the mode used
- include source characters and TOON characters
- include source token estimate and TOON token estimate when available
- say whether output is lossless or lossy

Do not add universal compression percentage claims. TOON helps most with repeated records such as definitions, glossaries, requirements, and tables. Prose-heavy documents may not shrink.

## Local setup

```bash
npm install
npm test
```

For CLI development:

```bash
npm run dev -- --help
npm run dev -- profile examples/prose.md
npm run dev -- convert examples/prose.md --mode lossless --out /tmp/prose.toon --stats
npm run dev -- validate /tmp/prose.toon
```

## Pull requests

Pull requests should include:

- what mode is affected: `lossless`, `record`, `budget`, validation, metrics, docs, or packaging
- what tests were run
- before/after metrics for conversion behavior changes
- a clear note when output becomes lossy or semantically compressed

Keep documentation examples copy-pasteable. Prefer small fixtures and exact commands over vague descriptions.

## Fixture guidance

Parser and optimizer fixtures should be small, focused, and honest about the document shape they represent.

Good fixture additions include:

- prose-heavy Markdown that should stay section-oriented
- definition or glossary documents that should become `defs`
- requirements or rules documents that should become `rules`
- Markdown tables with stable columns
- agent instruction files such as `AGENTS.md`, `CLAUDE.md`, and `SKILL.md`
- duplicate, vague, conflicting, or overlong instruction examples for future CheapAgent optimizer work

When behavior changes, add a test that calls the core API directly where possible. CLI tests should cover command wiring, not duplicate the whole parser suite.

## Documentation rules

- Credit TOON, Johann Schopplich, and `@toon-format/toon` when describing the foundation.
- State that `doc2toon` is independent and not official TOON tooling.
- Measure savings before claiming savings.
- Mark budget-mode semantic compression as lossy.
- Do not imply that every document will shrink.

## Reporting conversion issues

Use the conversion accuracy issue template and include:

- source type: `.md`, `.txt`, or stdin
- command used
- mode used
- expected output
- actual output
- whether the output validated
- a minimal input sample when possible
