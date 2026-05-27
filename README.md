# doc2toon

`doc2toon` converts Markdown, plain text, and pasted documents into valid TOON for LLM context work. It profiles the document first, chooses a compact JSON shape, encodes with `@toon-format/toon`, decodes back with the same official library, and prints measured size/token metrics before making any savings claim.

This is an independent project built on and inspired by [TOON](https://github.com/toon-format/toon). It is not an official TOON project.

## What is doc2toon

`doc2toon` is a local CLI for turning human-written documents into TOON when TOON is a better fit than raw Markdown or verbose JSON.

It is best for documents with repeated structure:

- definitions and glossaries
- requirements and operating rules
- simple tables
- structured notes that need to be pasted into an LLM context window

It is not a magic compressor. The rule is simple: measure savings before claiming savings.

## Why not just JSON/YAML/Markdown

Use JSON when downstream software needs standard machine interchange.

Use YAML when humans need hand-edited configuration and the parser boundary is controlled.

Use Markdown when prose, links, headings, and normal reading matter more than compact structured context.

Use TOON when repeated records matter. TOON can avoid repeating field names across rows, which can make definition lists, tables, and requirement sets easier to fit into LLM prompts.

## When TOON helps

TOON tends to help when the source can become arrays of repeated records:

- glossary entries with `term`, `definition`, `example`, and `tags`
- requirements with `scope`, `rule`, `exception`, and `risk`
- Markdown tables with stable columns
- mixed documents where structured sections matter more than original Markdown formatting

The strongest use case for v0.1.0 is compact LLM context preparation for definitions, glossaries, requirements, and tables.

## When TOON does not help

TOON may not shrink raw prose. If every word must be preserved, the retained text still has to go somewhere.

Budget mode may require semantic compression. When that happens, output is marked as lossy and includes coverage metadata. Do not describe budget output as lossless unless the metrics say the lossless target was reached.

Avoid universal percentage savings claims. Measure each document and report the actual numbers.

## Install

From a local checkout:

```bash
npm install
npm run build
npm link
```

Then run:

```bash
doc2toon --help
```

For development without linking:

```bash
npm run dev -- --help
```

Requirements:

- Node.js 20 or newer
- npm

## Usage

Profile before converting:

```bash
doc2toon profile examples/definitions.md
```

Convert a Markdown file:

```bash
doc2toon convert examples/prose.md --mode lossless --out /tmp/prose.toon --json-sidecar --stats
```

Convert a plain text file:

```bash
doc2toon convert examples/plain.txt --mode lossless --out /tmp/plain.toon
```

Convert stdin:

```bash
printf '# Pasted\n\nHello from stdin.\n' | doc2toon convert --stdin --type md --mode lossless --out /tmp/pasted.toon
```

Validate TOON:

```bash
doc2toon validate /tmp/prose.toon
```

Decode TOON back to JSON:

```bash
doc2toon decode /tmp/prose.toon --out /tmp/prose.json
```

The older `toon-doc` binary remains available as an alias, but `doc2toon` is the v0.1.0 package and CLI name.

## Modes

`lossless` preserves the source content in the least verbose schema the profiler can choose.

```bash
doc2toon convert examples/prose.md --mode lossless --out /tmp/prose.toon
```

`record` favors repeated record schemas for definitions, requirements, and tables.

```bash
doc2toon convert examples/definitions.md --mode record --delimiter tab --out /tmp/definitions.toon
```

`budget` checks whether a target can be reached losslessly. If it cannot, the command refuses unless `--allow-lossy` is passed.

```bash
doc2toon convert examples/prose.md --mode budget --target-chars 100 --out /tmp/refused.toon
doc2toon convert examples/prose.md --mode budget --target-chars 1000 --allow-lossy --out /tmp/budget.toon
```

The first command is expected to fail with a lossless-target warning. The second command writes lossy budget output.

Lossy budget output records that it is lossy, stores the target, and includes coverage rows.

## Metrics

Every conversion reports:

- source characters
- TOON characters
- source token estimate
- TOON token estimate
- character savings
- token savings
- rough token estimates at configurable chars-per-token ratios
- detected profile
- mode
- lossless or lossy status
- target reached status when a target is provided

Token counts are estimates. `doc2toon` uses local estimator behavior plus configurable characters-per-token ratios, but exact counts vary by model and tokenizer. Use the target provider tokenizer for billing- or limit-critical work.

Use `--stats` to also print canonical JSON versus TOON savings.

```bash
doc2toon convert examples/prose.md --mode lossless --out /tmp/prose.toon --stats
```

Override rough token ratios when you want a different estimate:

```bash
doc2toon profile examples/prose.md --chars-per-token 3.7,4.2
doc2toon convert examples/prose.md --mode lossless --chars-per-token 3.7,4.2 --out /tmp/prose-ratio.toon
```

Report actual measured output, not assumed ranges.

## Examples for .md .txt stdin

Markdown:

```bash
doc2toon profile examples/definitions.md
doc2toon convert examples/definitions.md --mode record --delimiter tab --out /tmp/definitions.toon --stats
doc2toon validate /tmp/definitions.toon
```

Plain text:

```bash
doc2toon profile examples/plain.txt
doc2toon convert examples/plain.txt --mode lossless --out /tmp/plain.toon
doc2toon decode /tmp/plain.toon --out /tmp/plain.json
```

Stdin:

```bash
printf 'Term: Evidence Receipt\nDefinition: A reviewer-readable record of workflow inputs, artifacts, gates, approvals, and limits.\n' \
  | doc2toon convert --stdin --type txt --mode record --out /tmp/stdin.toon
```

## Sample before and after

Input:

```md
## Canonical JSON

Definition: The normalized JSON structure produced before TOON encoding.
Example: A glossary becomes repeated `defs` records with stable fields.
Tags: schema, intermediate, validation
```

Output shape:

```toon
defs[1	]{id	term	type	def	ex	tags}:
  d001	Canonical JSON	concept	The normalized JSON structure produced before TOON encoding.	A glossary becomes repeated `defs` records with stable fields.	schema,intermediate,validation
```

Generated examples are available in `examples/`, including `examples/definitions.toon`.

## Validation

Every conversion validates the TOON round trip:

1. Read `.md`, `.txt`, or stdin.
2. Profile the document.
3. Build compact canonical JSON.
4. Encode JSON to TOON with `@toon-format/toon`.
5. Decode TOON back to JSON with `@toon-format/toon`.
6. Compare normalized JSON.
7. Write `.toon` only after validation passes.

If round-trip validation fails, debug files are written beside the requested output path:

- `<output>.debug.json`
- `<output>.failed.toon`

You can also validate a file directly:

```bash
doc2toon validate /tmp/definitions.toon
```

## Roadmap

May 27, 2026: `doc2toon` v0.1.0 is the first public release. It is the local, open-source CLI artifact: profile documents, convert `.md`, `.txt`, and stdin, validate TOON, and report measured savings.

May 28, 2026: `https://cheapagent.ai` opens as the branded follow-through for agent-context optimization. The public wedge is broader than document conversion: help developers reduce wasted agent context while keeping the measurement-first rule.

v0.2 is planned as a static-first CheapAgent web interface for pasted text, `.txt`, `.md`, `AGENTS.md`, `CLAUDE.md`, and `SKILL.md` files. The default deployment target is Netlify on a free or low-cost plan. The intended limit shape is conservative: anonymous users get 1000 characters per conversion, signed-in users get up to 15000 characters per day, and conversion should stay browser-side where possible so document bodies are not uploaded by default.

v0.3 is planned as an agent-context compiler: multiple file uploads, target-aware outputs for agent instruction surfaces, before/after reports, more formats such as DOCX and text-based PDF, and a paid hosted convenience tier while keeping the CLI open source.

The same honesty rule applies to future releases: measure before claiming savings, and label semantic compression clearly.

## Credits

`doc2toon` is built on and inspired by [TOON](https://github.com/toon-format/toon), including the `@toon-format/toon` package.

Credit to Johann Schopplich and the `@toon-format/toon` maintainers for TOON and the official encoder/decoder this project relies on.

This project is independent and not affiliated with, endorsed by, or maintained by the TOON project.

## License

MIT. See [LICENSE](LICENSE).

## Disclaimer

`doc2toon` is an experimental developer tool for local document conversion. It does not guarantee token savings, legal/compliance suitability, semantic completeness in lossy mode, or compatibility with every downstream LLM workflow. Verify outputs before relying on them.
