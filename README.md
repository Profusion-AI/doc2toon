# doc2toon

[![npm version](https://img.shields.io/npm/v/doc2toon)](https://www.npmjs.com/package/doc2toon)

`doc2toon` prepares Markdown, plain text, and pasted documents for LLM context windows by increasing useful context density. It profiles the document first, chooses a compact JSON shape, encodes with `@toon-format/toon`, decodes back with the same official library, and prints measured size/token metrics before making any savings claim.

This is an independent project built on and inspired by [TOON](https://github.com/toon-format/toon). It is not an official TOON project.

## What is doc2toon

`doc2toon` is a local CLI and library for context preparation and token efficiency. It is the engine/library layer, not the hosted CheapAgent app. The first practical target is long agent instruction files such as `CLAUDE.md`, `AGENTS.md`, and `SKILL.md`, plus definitions, rules, requirements, and table-like documents that need to fit cleanly into LLM context windows. The goal is to preserve operational meaning, useful structure, retrievability, cross-references, definitions, rules, requirements, and task-relevant context while reducing avoidable token overhead.

It is best for documents with repeated structure:

- definitions and glossaries
- requirements and operating rules
- simple tables
- structured notes that need to be pasted into an LLM context window

It should not preserve redundancy unless it supports cross-reference, traceability, or task accuracy. It should not keep overwritten or duplicate ideas as separate payload unless the distinction matters to the user or downstream LLM task. It should not preserve purple prose, decorative padding, or rhetorical flourish merely because it exists in the source document.

It is not a magic compressor. The rule is simple: measure savings before claiming savings.

## Philosophy

`doc2toon` helps prepare documents for LLM context windows by increasing useful context density.

It is not designed to preserve every flourish, repeated idea, or rhetorical aside from the source document. Humans remain responsible for deciding which nuance matters. `doc2toon` focuses on preserving structure, meaning, references, definitions, rules, and task-relevant context while reducing redundancy and avoidable token overhead.

When exact wording matters, use lossless mode.
When repeated knowledge matters, use record mode.
When a strict context budget matters, use budget mode and treat the result as lossy unless validation says otherwise.

## Why not just JSON/YAML/Markdown

Use JSON when downstream software needs standard machine interchange.

Use YAML when humans need hand-edited configuration and the parser boundary is controlled.

Use Markdown when prose, links, headings, exact wording, and normal reading matter more than compact structured context.

Use TOON when repeated records matter. TOON can avoid repeating field names across rows, which can make definition lists, tables, and requirement sets easier to fit into LLM prompts.

## When TOON helps

TOON tends to help when the source can become arrays of repeated records:

- glossary entries with `term`, `definition`, `example`, and `tags`
- requirements with `scope`, `rule`, `exception`, and `risk`
- Markdown tables with stable columns
- mixed documents where structured sections matter more than original Markdown formatting

The strongest current use case is compact LLM context preparation for definitions, glossaries, requirements, tables, and other record-like knowledge.

## When TOON does not help

TOON may not shrink raw prose. If every word must be preserved, the retained text still has to go somewhere.

Measured, not asserted: across 19 real agent docs from public repos (openai-agents, pydantic-ai, ruff, biome, langchain, and more — commit-pinned, MIT-verified), the verdict engine recommends `convert` on **zero** ([methodology and results](fixtures/agent-context/external/README.md); the in-house corpus adds 1 of 19). The honest verdicts are `split_first` and `keep_markdown` — which is what this tool is for.

Budget mode may require semantic compression. When that happens, output is marked as lossy and includes coverage metadata. Do not describe budget output as lossless unless the metrics say the lossless target was reached.

Avoid universal percentage savings claims. Measure each document and report the actual numbers.

## Try it in 30 seconds

The fastest CLI check is:

```bash
npm install -g doc2toon
printf 'Term: Evidence Receipt\nDefinition: A reviewer-readable workflow record.\n' \
  | doc2toon convert --stdin --type txt --mode record --out /tmp/evidence-receipt.toon
doc2toon validate /tmp/evidence-receipt.toon
```

From this repository, you can also try the included examples:

```bash
doc2toon profile examples/definitions.md
doc2toon convert examples/definitions.md --mode record --delimiter tab --out /tmp/definitions.toon
```

## Install

From npm:

```bash
npm install doc2toon
```

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

Plan a per-section hybrid when the whole document doesn't convert (see [Context plans](#context-plans-plan)):

```bash
doc2toon plan fixtures/agent-context/realistic/CLAUDE.md
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

The older `toon-doc` binary and the `lossless-doc`/`llm-context` mode aliases are deprecated as of v0.3.0 (a warning is printed on use) and will be removed at 1.0. Use `doc2toon` and the canonical mode names.

## Machine-readable verdicts (`--json`)

`profile --json` and `convert --json` emit the [Verdict v1 object](schemas/verdict.v1.json) — the same object every CheapAgent surface emits, decided by the same engine policy. `profile` withholds the TOON payload (`toon_candidate: null`) so an agent can decide before spending context; `convert` includes it.

```bash
doc2toon profile --json AGENTS.md | jq '{verdict, safe_to_auto_apply, savings_pct: .measured_chars.savings_pct, warnings: [.warnings[].code]}'
```

```json
{
  "verdict": "keep_markdown",
  "safe_to_auto_apply": false,
  "savings_pct": -62.1,
  "warnings": ["duplicate_rule", "duplicate_rule", "vague_rule", "vague_rule", "negative_savings"]
}
```

With `--json`, `--out` becomes optional on `convert`; when given, the `.toon` file is still written and the write confirmation goes to stderr so stdout stays pure JSON.

The exit-code contract (normative in [docs/verdict-schema-v1.md](docs/verdict-schema-v1.md), decision 8):

- Any representable verdict exits `0` — including `refused` (a budget target unreachable losslessly without `--allow-lossy`) and `keep_markdown`. The check succeeded; the verdict is the product.
- I/O, argument, and internal failures exit `1` and print a `{"error": {"code", "message"}}` envelope (`bad_request`, `input_not_found`, `internal`).
- `validate --json` returns `{schema_version, valid, error}` and keeps exit `1` on invalid TOON, so a validation gate fails the build.
- `--fail-on <list>` makes CI fail deliberately, never accidentally: comma-separated verdicts (`split_first,review`) and/or severities (`warning`; `info` fails on any warning) set exit `1` after the verdict is printed.

```bash
# Fail the build when a doc should be split or reviewed, otherwise pass:
doc2toon profile --json --fail-on split_first,review CLAUDE.md
```

## Context plans (`plan`)

Whole-document TOON wins are rare in real agent docs — the honest corpus numbers above say so. `plan` is what comes after `split_first`: it measures **every heading-bounded section of the document as if it were a standalone document, under the exact same frozen policy** (zero new thresholds), and recommends a hybrid only when the net savings — splice overhead included — clear the same 5% band:

```bash
doc2toon plan CLAUDE.md
doc2toon plan --json CLAUDE.md | jq '{verdict, recommend: .context_plan.recommend_hybrid, net: .context_plan.net, convert: [.context_plan.sections[] | select(.action == "convert") | .heading]}'
```

Every plan row carries its evidence — `keep` sections included — so each line is auditable: the section's standalone verdict, measured chars, and warnings (ranges in whole-document coordinates). YAML frontmatter is sectioned, always kept, and never measured.

`--out` writes the **hybrid document**: converted sections become fenced ` ```toon ` blocks in place (the section heading stays as Markdown; the fence content is exactly the measured candidate), everything else byte-identical:

```bash
doc2toon plan CLAUDE.md --out CLAUDE.hybrid.md
```

Honesty mechanics, same as everywhere else in this tool: the per-section unit changes, the policy does not. A small table that wins +20% standalone inside a document whose net hybrid saves 0.4% gets an honest "keep the whole document". Plan-level `safe_to_auto_apply` requires net savings over the band, at least one converted section, every converted section individually safe, and mechanical reassembly verification (kept bytes identical, converted blocks decode as embedded).

`plan --json` is the one surface that emits `schema_version: "1.1"` (the additive `context_plan` field); `profile`/`convert` output stays `"1.0"` byte-for-byte. Exit-code contract is identical to `profile`, and `--fail-on` keys on the whole-document verdict — plans inform, the verdict gates.

## Agent interface: MCP server and `doc2toon serve`

Agents can call doc2toon locally today — same engine, same frozen contract, document bodies never leave the machine.

**MCP** (Claude Code, Cowork, any MCP client) — tools `profile`, `convert`, `plan`, `validate`, returning the Verdict object as structured tool results ([docs/mcp.md](docs/mcp.md) has Windows/macOS/Linux snippets):

```bash
claude mcp add doc2toon -- npx -y -p doc2toon-registry@npm:doc2toon@0.4.x doc2toon-mcp          # macOS / Linux
claude mcp add doc2toon -- cmd /c npx -y -p doc2toon-registry@npm:doc2toon@0.4.x doc2toon-mcp   # Windows (verified)
```

The `doc2toon-registry@npm:doc2toon@0.4.x` alias forces npm to use the registry package even when the MCP client launches from inside a local `doc2toon` checkout.

**HTTP on localhost** — the same `/v1` contract the OpenAPI spec describes ([openapi/cheapagent.v1.yaml](openapi/cheapagent.v1.yaml), also served from the running server at `GET /v1/openapi.yaml`):

```bash
npx -y -p doc2toon-registry@npm:doc2toon@0.4.x doc2toon serve --port 8787
```

```bash
curl -s -X POST http://127.0.0.1:8787/v1/profile \
  -H "content-type: application/json" \
  -d '{"content":"# AGENTS.md\n\n## Rules\n- Never commit directly to main.\n- Never push to main without review.\n"}' \
  | jq '{verdict, savings_pct: .measured_chars.savings_pct, warnings: [.warnings[].code]}'
```

`serve` binds `127.0.0.1` by default (exposing requires an explicit `--host`), sends no CORS headers unless you pass `--cors <origin>`, caps bodies at 2 MB, and maps outcomes per the frozen contract: a budget refusal is HTTP `200` with `verdict: "refused"`, invalid TOON is `200` with `valid: false`, and `/v1/estimate`/`/v1/batch` answer `501` (spec-only in v1). `POST /v1/plan` is the one endpoint emitting schema `1.1` with `context_plan`.

The hosted `api.cheapagent.ai` exposes the identical contract when demand justifies it — one contract, two transports; the local server is not a degraded preview, it is the product.

## GitHub Action

Run the context check on every PR — a sticky comment with the verdict table, file-level
annotations, a `doc2toon-verdicts.json` artifact, and an optional `fail-on` gate:

```yaml
name: Context check
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  context-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: Profusion-AI/doc2toon@action-v1
        with:
          files: "AGENTS.md, CLAUDE.md, SKILL.md, .claude/**/*.md"
          # fail-on: "review"   # optional: verdicts and/or severities
```

The Action runs the published CLI (`doc2toon@0.3.x`) — verdicts come from the same frozen
Verdict v1 policy as everything else. Security posture by design ([the spike](docs/action-fork-pr-permissions.md)):
`pull_request` only, zero secrets, and on fork PRs the comment is skipped while the summary,
annotations, artifact, and exit code still deliver the full result. `@action-v1` is a moving
tag updated independently of npm releases.

## Library API

The CLI is a thin wrapper around the reusable conversion core. Node code can import the same pipeline directly:

```ts
import { convertTextToToon } from "doc2toon";

const result = convertTextToToon({
  text: "# Terms\n\n## Evidence Receipt\n\nDefinition: A reviewable workflow record.",
  flavor: "markdown",
  sourceType: "paste",
  mode: "record",
  delimiter: "auto",
});

console.log(result.toon);
console.log(result.stats);
```

For the decision object, `runVerdict` returns the same Verdict v1 the CLI emits and never throws on representable outcomes — a budget refusal is `verdict: "refused"`, not an exception:

```ts
import { runVerdict } from "doc2toon";

const verdict = runVerdict(agentsMd, { flavor: "markdown" });
if (verdict.verdict === "convert" && verdict.safe_to_auto_apply) {
  await writeFile("AGENTS.toon", verdict.toon_candidate!);
}
```

Browser builds should use the browser entrypoint. It accepts raw strings, returns structured results, and does not depend on CLI file handling:

```ts
import { convertTextToToon } from "doc2toon/browser";

const result = convertTextToToon({
  text: textarea.value,
  flavor: "markdown",
  sourceType: "paste",
  mode: "lossless",
});
```

The core returns data instead of printing to stdout: canonical JSON, encoded TOON, decoded JSON, detected profile, selected delimiter, stats, warnings, lossless status, validation status, and target status.

## Modes

`lossless` preserves the source text in the least verbose schema the profiler can choose. Use it when exact wording, nuance, or auditability matters more than aggressive compression.

```bash
doc2toon convert examples/prose.md --mode lossless --out /tmp/prose.toon
```

`record` favors repeated record schemas for definitions, requirements, rules, tables, and structured sections. Use it when repeated knowledge matters more than preserving surrounding prose exactly.

```bash
doc2toon convert examples/definitions.md --mode record --delimiter tab --out /tmp/definitions.toon
```

`budget` checks whether a target can be reached losslessly. If it cannot, the command refuses unless `--allow-lossy` is passed. Use it when a strict context budget matters and semantic compression is acceptable.

```bash
doc2toon convert examples/prose.md --mode budget --target-chars 100 --out /tmp/refused.toon
doc2toon convert examples/prose.md --mode budget --target-chars 1000 --allow-lossy --out /tmp/budget.toon
```

The first command is expected to fail with a lossless-target warning. The second command writes lossy budget output.

Lossy budget output records that it is lossy, stores the target, and includes coverage rows. Treat it as compressed context for review, not as a replacement for human editorial judgment.

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

## Agent Context Optimizer Preview

CheapAgent is the separate hosted app surface for practical context compression, token utilization, and LLM-ready document preparation for files such as `CLAUDE.md`, `AGENTS.md`, and `SKILL.md`. `doc2toon` provides the package boundary CheapAgent should consume through `doc2toon/browser`.

The intended product rule is the same as the CLI rule: measure before claiming savings. Optimizer warnings are advisory signals, not silent rewrites:

- Possible duplicate rule: repeated instructions may waste working memory or introduce contradiction.
- Possibly vague instruction: broad guidance may consume tokens without giving the agent an operational handle.
- Long section: large sections often mix concerns or hide procedural detail.
- Possible split candidate: overloaded sections may belong in task-triggered skills or focused workflows.

TOON remains one output target, not the whole product. Some agent instruction files will be better served by a tighter Markdown rewrite or a split into lazy-loaded skills. CheapAgent should not present itself as a magical summarizer or a universal replacement for human editorial judgment: the human decides what nuance matters, the LLM can help elaborate context when needed, and `doc2toon` provides the compact, structured, measurable intermediary.

## Roadmap

May 27, 2026: `doc2toon` v0.1.0 is the first public release. It is the local, open-source CLI artifact: profile documents, convert `.md`, `.txt`, and stdin, validate TOON, and report measured savings.

June 2026: CheapAgent is the separate hosted app at `https://cheapagent.ai/`. The hosted app repo is separate from this engine/library repo. Production HTTPS is live for the apex domain and `www.cheapagent.ai` redirects to apex; `cheapagent.netlify.app` still mirrors production until a separate staging Netlify site is created.

v0.1.x is the hardening lane: reusable core extraction, browser-safe package entrypoints, parser coverage, fixtures, docs, packaging, and CI cleanup.

v0.2 is planned as a static-first CheapAgent web interface for pasted text, `.txt`, `.md`, `AGENTS.md`, `CLAUDE.md`, and `SKILL.md` files. The default deployment target is Netlify on a free or low-cost plan. The intended limit shape is conservative: anonymous users get 1000 characters per conversion, signed-in users get up to 15000 characters per day, and conversion should stay browser-side where possible so document bodies are not uploaded by default.

v0.3 is planned as an agent-context compiler: multiple file uploads, target-aware outputs for agent instruction surfaces, before/after reports, more formats such as DOCX and text-based PDF, and a paid hosted convenience tier while keeping the CLI open source.

The same honesty rule applies to future releases: measure before claiming savings, and label semantic compression clearly.

## Credits

`doc2toon` is built on and inspired by [TOON](https://github.com/toon-format/toon), including the `@toon-format/toon` package.

Credit to the `@toon-format/toon` maintainers for the official encoder/decoder this project relies on.

This project is independent and not affiliated with, endorsed by, or maintained by the TOON project.

## License

MIT. See [LICENSE](LICENSE).

## Disclaimer

`doc2toon` is an experimental developer tool for local document conversion. It does not guarantee token savings, legal/compliance suitability, semantic completeness in lossy mode, or compatibility with every downstream LLM workflow. Verify outputs before relying on them.
