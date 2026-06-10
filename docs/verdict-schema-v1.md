# Verdict Schema v1 — contract and decision log

**Status: DRAFT — frozen when the freeze merge lands (30-day plan, day 7).** After the freeze, every change to this contract follows the versioning rules at the bottom of this document. Nothing about the freeze is ceremonial: the schema ships in the npm tarball, the spec is published, and consumers multiply from day 8 onward.

The contract is two files plus this document:

- **`schemas/verdict.v1.json`** — JSON Schema 2020-12, `$id: https://cheapagent.ai/schemas/verdict.v1.json`. The canonical artifact. Ships in the npm tarball (`schemas/` and `openapi/` are in the package `files` allowlist).
- **`openapi/cheapagent.v1.yaml`** — OpenAPI 3.1. The HTTP binding of the same contract: `POST /v1/profile`, `/v1/convert`, `/v1/validate` (implemented surfaces in v1), `/v1/estimate`, `/v1/batch` (spec-only, `x-status: planned`).

**One contract, two transports — spec first, implementations staged.** No HTTP transport exists yet: `doc2toon serve` ships in v0.4.0 (30-day plan, days 13–18) and exposes these endpoints on localhost; `api.cheapagent.ai` exposes the identical contract when demand justifies hosting it. The web app, CLI `--json` (v0.3.0), MCP tools (v0.4.0), and GitHub Action all emit this same object. No surface ever re-derives a verdict: everything calls the same `buildVerdict` (lands in `src/verdict.ts`, days 4–7). This document and the spec are published ahead of the implementations deliberately — that is what makes the freeze meaningful.

Both files are deliberately written **without internal `$ref`s**, fully inlined, so the sync between `components.schemas.Verdict` and the JSON Schema is verifiable by deep equality (modulo `$schema`/`$id`). The sync test (`test/openapi-sync.test.ts`) lands with the freeze merge.

---

## Decision log

Answered in writing before any verdict code is written. These are the eight decisions the 30-day plan requires plus three more that surfaced while drafting.

### 1. Verdict enum

`convert | keep_markdown | split_first | review | refused`

Lifted 1:1 from the four verdicts already live in the CheapAgent web app (`cheapagent-ai/src/main.js`, `renderResult()`: `toonWins`, `keepMarkdown`, `splitFirst`, `reviewNeeded`), plus `refused` for in-band budget refusal (decision 6). The web app has been making these calls in production; it is the de-facto draft. We lift it, we don't reinvent it.

### 2. Deterministic decision inputs

The `verdict` and `safe_to_auto_apply` fields compute **only** from deterministic measurements: measured character counts, fired warning codes, and the `lossless` / `valid` / `target_reached` flags. Token estimates are advisory payload — **never** threshold inputs.

This structurally eliminates the estimator-divergence problem: the CLI estimates tokens with `tokenx`, the browser with a chars-per-token heuristic, and a verdict thresholded on tokens could flip between surfaces for the same document. Char-based decisions cannot. (The web app's current policy thresholds on token savings, but its browser estimator is char-proportional, so the char-based policy is behavior-identical on that surface.)

Enforced by the estimator-parity test (Phase 1): the `verdict` field must be identical under both estimators across every fixture.

### 3. Estimator identity

`token_estimates.estimator` carries the identity of whatever produced the advisory numbers: `"tokenx@1.3.0"` on Node surfaces, `"chars-per-token:4"` in the browser. `measured_chars` carries the deterministic block. `ratio_estimates` carries the fixed-ratio projections (default 3.5/4/4.5 chars per token) for sanity-checking.

**Spike result (2026-06-10):** `tokenx@1.3.0` is dependency-free, side-effect-free pure ESM — 6 kB of dist with zero `node:`/`process` references — so it would bundle through Vite without issue. Advisory-number convergence across surfaces is therefore available in a later minor if we want it. It remains non-blocking for the freeze because decision 2 keeps token estimates out of the decision path.

### 4. `safe_to_auto_apply` (normative)

```
safe_to_auto_apply :=
      verdict == "convert"
  AND mode == "lossless"
  AND flags.lossless == true
  AND flags.valid == true
  AND measured_chars.savings > 0
  AND no warning has severity == "warning"
```

Conservative by design: `review` absorbs the gray zone. A timid v1 is recoverable; a wrong-and-confident v1 is not.

The `mode == "lossless"` clause was added on day 1 after measurement (see decision 12): v1 does not independently verify content coverage outside lossless mode, and only lossless mode preserves all source blocks by construction. The clause may be relaxed in a 1.x minor once record-mode coverage is verified mechanically — relaxing a criterion is additive; trusting an unverified one is not.

Note: under the v1 decision policy (below), a `convert` verdict implies zero warnings, which makes the severity clause currently vacuous. It is kept normative anyway so that future threshold tunes (e.g., letting info-severity warnings coexist with `convert`) cannot silently weaken auto-apply.

### 5. Unified coded warnings

One `warnings[]` array of `{ code, severity, message, suggestion?, evidence?, range? }`. The four optimizer kinds become codes as-is; the engine's prose warning strings get codes. Prose becomes a *rendering* of codes, never the data — no consumer ever matches on message text (this kills the brittle exact-string match currently at `cli.ts:367`).

**v1 code registry (open set — consumers MUST tolerate unknown codes and react via `severity`):**

| Code | Source | Meaning |
|---|---|---|
| `duplicate_rule` | optimizer | Two rules state the same constraint |
| `vague_rule` | optimizer | Rule too broad to be reliably followed |
| `long_section` | optimizer | Section carries too much; split it |
| `split_candidate` | optimizer | Section may convert better as its own block |
| `negative_savings` | conversion | TOON output is larger than the source |
| `lossy_applied` | conversion | Semantic compression was applied; output is not lossless |
| `target_not_reached` | conversion | Budget target missed even with compression |
| `budget_refused` | conversion | Target unreachable losslessly and lossy not permitted |

`severity` is a **closed** two-level enum in v1: `info | warning`. Expanding it would be a breaking change (consumers branch on it); a third level means schema v2.

`ConversionResult`'s existing channels (`warnings: string[]`, `optimizerWarnings: OptimizerWarning[]`) stay untouched for library back-compat; `VerdictV1` carries only the coded array.

### 6. Refusal is in-band

Budget refusal (today a thrown `Error` in `core.ts` when a target is unreachable losslessly and `allowLossy` is false) becomes `verdict: "refused"` via a non-throwing `runVerdict(text, opts): VerdictV1` wrapper (Phase 1). Throwing is reserved for unrepresentable failures. Without this, `serve` and MCP would turn refusals into 500s and tool errors — but a refusal is the product working as designed, not a failure. Over HTTP: refusal = `200` with `verdict: "refused"`.

On a refused verdict: `toon_candidate` and `delimiter` are `null`; `measured_chars` reports the shortest lossless candidate that was attempted (the same numbers today's error message quotes); `flags.target_reached` is `false`; a `budget_refused` warning is present.

### 7. CLI surface

`decode` stays. Deprecated in v0.3.0 (warn on use, removed at 1.0): the `toon-doc` bin alias and the `lossless-doc` / `llm-context` mode aliases. Verdict-era docs, the Action, and MCP reference only canonical names. The wire (HTTP/MCP) accepts **only** canonical mode names — CLI aliases are a CLI-only courtesy during deprecation.

### 8. Exit-code and error contract

- `profile --json` and `convert --json`: **exit 0 for any representable verdict** — including `refused` and `keep_markdown`. The check succeeded; the verdict is the product.
- Exit 1 with a JSON `{"error":{"code","message"}}` envelope on stderr-class failures: I/O errors, parse failures, internal errors.
- `validate --json`: keeps exit 1 on invalid TOON (CI ergonomics — a validation gate should fail the build).
- `--fail-on <verdict|severity>` (v0.3.0): lets CI fail builds *deliberately* on chosen verdicts or warning severities, never accidentally.
- HTTP mapping: representable verdict = `200` (including refusal); malformed input = `400` JSON envelope; oversized body = `413` (2 MB default); unrepresentable failure = `500`. `/v1/estimate` and `/v1/batch` = `501` everywhere in v1.

### 9. `profile` runs a trial conversion and withholds the payload

`POST /v1/profile` (and `profile --json`) runs the full measurement pipeline including an internal lossless trial conversion, then returns the complete verdict with `toon_candidate: null`. Rationale: the flagship use is an agent deciding *before* spending context — it needs the decision and the numbers, not the payload. `convert` is the same verdict with the payload attached. This is why `toon_candidate` is required-but-nullable rather than optional: its absence is meaningful, not accidental.

The trial conversion is deliberately **lossless** mode: it is the only mode whose measurements are trustworthy by construction in v1 (decision 12). Whether profile grows a mode option follows the default-mode calibration decision (open question 1).

### 10. Wire naming and schema style

Wire format is `snake_case` (`toon_candidate`, `safe_to_auto_apply`, `measured_chars`). The TypeScript `VerdictV1` interface mirrors the wire exactly — no camelCase mapping layer to drift. Schema files are fully inlined (no `$ref`/`$defs`) so OpenAPI↔JSON-Schema sync is plain deep equality. Unknown-field tolerance is explicit: `additionalProperties: true` on every object, and consumers MUST ignore fields they don't know.

### 11. `validate` returns a ValidationResult, not a Verdict

Validation has no source document to judge — there is nothing to render a verdict on. `POST /v1/validate` and `validate --json` return `{ schema_version, valid, error }` (the `ValidationResult` component in the OpenAPI spec). An invalid document is representable: HTTP `200` with `valid: false` and a coded error (`invalid_toon`).

### 12. Record-mode content coverage is unverified in v1 (measured day 1)

Day-1 measurement against the engine surfaced two facts the contract must not paper over:

- **`mixed`-profile documents are mode-invariant.** Real agent docs usually profile as `mixed`, and for them record mode produces byte-identical output to lossless mode, at heavily negative savings (-30% to -140% measured across fixtures). The verdict for them is honestly `keep_markdown` or `split_first` — which is the product's actual advice.
- **Record mode can silently drop content while flagging `lossless: true`.** Measured on `examples/prose.md`: a 2,051-char prose document collapsed to a single 405-char definition record (+80% "savings"), with three paragraphs gone, zero warnings, and `valid: true` — because round-trip validation checks the TOON against its own canonical JSON, not the canonical against the source. The `lossless` flag, as implemented, asserts "no budget compression was requested," not "content preserved."

The realistic fixtures (committed day 1, `fixtures/agent-context/realistic/README.md`) sharpened both facts: `architecture-rfc.md` (profiles `requirements`) shows record mode reporting **+91.6% savings, `lossless: true`, zero warnings** while the decoded output retains ~5% of the source; and `config-reference.md` shows even *lossless-claimed* table conversion silently dropping the title and caption lines (~3.4% of source).

Consequences encoded in this contract: the `flags.lossless` description states the honest semantics; `safe_to_auto_apply` requires `mode == "lossless"` (decision 4); and the engine work to verify coverage mechanically (source-to-canonical coverage check, plus fixing the raw-prose/requirements record extraction) is a calibration-week item (Phase 1, days 4–6) tracked in the open questions below. The verdict feature must not ship telling users record mode saved them 91% when it deleted their document.

---

## Open calibration questions (resolve in days 4–6, before the freeze)

These do not block the schema draft — no field changes hang on them — but they must be answered before the freeze merge, with fixture data:

1. **Default wire mode.** The draft defaults `/v1/convert` to lossless (matches the CLI; honest by construction). The web app uses record mode for its agent-doc tabs. Once record-mode coverage verification exists, should the wire default flip to record for the flagship use, or stay lossless with record opt-in? Decide with the calibration table, not in the abstract.
2. **Record-mode coverage verification.** Mechanical check (canonical-vs-source coverage) and a fix for the raw-prose record extraction misfire (decision 12). Until this lands, every surface treats record-mode savings as suspect.
3. **Mixed-profile mode invariance.** Whether record mode should have a real (different, smaller) canonical for `mixed` docs, or whether `split_first` is simply the permanent answer for them.
4. **Web app alignment.** The Phase 2 web swap replaces client-side verdict logic with the engine's; at that point the web tabs' record-mode defaults must reconcile with whatever default the wire freezes, or the web and CLI will disagree about the same document — the exact failure the shared engine exists to prevent.
5. **`long_section` vs. uniform tables.** The `table` profile requires ≤1 heading, so any real-size table document is one giant section and `long_section` always fires — turning `config-reference.md`'s decode-verified +21.1% win into `split_first`. The thresholds should probably exempt (or weight differently) sections that are a single uniform table; otherwise the engine's best legitimate win class can never receive `convert`.
6. **Lossless-mode coverage check.** `config-reference.md` shows the lossless-claimed table canonical dropping title/intro/captions (~3.4% of source). Either the canonical carries them, or the coverage check from question 2 applies to lossless mode too — `safe_to_auto_apply` leans on lossless-by-construction, so this is a freeze-relevant question.
7. **Phantom definitions.** The inline-definition heuristic extracts junk definitions from capitalized lines containing hyphens or `Term: def` shapes (`SKILL.md`: 17 definitions, mostly phantom; `architecture-rfc.md` needed deliberate line-wrapping to dodge it). This inflates `activeKinds` toward `mixed`, which currently dooms a document to negative savings — profiler precision directly gates which verdicts are reachable.

## Decision policy (normative; constants tunable)

Evaluated in priority order against deterministic inputs only:

| Priority | Verdict | Condition |
|---|---|---|
| 1 | `refused` | Budget target unreachable losslessly and lossy output not permitted |
| 2 | `split_first` | Any `long_section` or `split_candidate` warning fired |
| 3 | `keep_markdown` | `measured_chars.savings <= 0` |
| 4 | `review` | Any other warning fired (any code, any severity) |
| 5 | `convert` | Otherwise: zero warnings and positive measured savings |

**Fields freeze; thresholds don't.** The optimizer constants that decide when `long_section` / `split_candidate` / `duplicate_rule` / `vague_rule` fire (in `src/optimizer.ts`) are decision-policy constants, documented here as **minor-version-tunable**: teardown-week feedback may tune them in a 1.x minor with a CHANGELOG entry, without any schema change. The calibration table (Phase 1, days 4–6) pins current behavior per fixture in committed test expectations, so every tune is a visible diff.

---

## Versioning and freeze rules

- Every verdict carries `schema_version: "1.0"`.
- **Within 1.x: additive optional fields only.** No removal, no retype, no enum-shrink, no new required fields. Consumers MUST ignore unknown fields. An additive change bumps to `"1.1"` with a CHANGELOG entry and an npm minor.
- **Breaking change = new document**: `schemas/verdict.v2.json`, new `$id`, `schema_version: "2.0"`, emitted alongside v1 during a deprecation window. A post-freeze breaking change is a defined versioning event, not a crisis.
- The `$id` URL (`https://cheapagent.ai/schemas/verdict.v1.json`) resolves publicly once cheapagent.ai deploys `public/schemas/verdict.v1.json` (soft launch, day 19).
- Closed enums in v1 (changing any is v2): `verdict`, `severity`, `mode`, `delimiter`, `profile.name`, `profile.source_type`. Open sets (additive within 1.x): warning `code`, `estimator` strings.

---

## Examples

### A verdict (split_first, abridged `toon_candidate`)

```json
{
  "schema_version": "1.0",
  "verdict": "split_first",
  "safe_to_auto_apply": false,
  "profile": {
    "name": "mixed",
    "title": "CLAUDE.md",
    "source_type": "markdown",
    "stats": { "lines": 524, "headings": 23, "paragraphs": 61, "list_items": 118, "tables": 2, "table_rows": 14, "definitions": 9, "rules": 37 }
  },
  "measured_chars": { "source": 20056, "toon": 27644, "savings": -7588, "savings_pct": -37.8 },
  "token_estimates": {
    "estimator": "tokenx@1.3.0",
    "source": 5151, "toon": 7612, "savings": -2461, "savings_pct": -47.8,
    "ratio_estimates": [
      { "chars_per_token": 3.5, "source": 5730, "toon": 7898, "savings": -2168, "savings_pct": -37.8 },
      { "chars_per_token": 4, "source": 5014, "toon": 6911, "savings": -1897, "savings_pct": -37.8 },
      { "chars_per_token": 4.5, "source": 4457, "toon": 6143, "savings": -1686, "savings_pct": -37.8 }
    ]
  },
  "toon_candidate": null,
  "warnings": [
    {
      "code": "long_section",
      "severity": "warning",
      "message": "Section \"Deployment\" is carrying too much.",
      "suggestion": "Split it into smaller, named sections.",
      "range": { "line_start": 201, "line_end": 318 }
    },
    {
      "code": "duplicate_rule",
      "severity": "warning",
      "message": "Two rules state the same constraint about migration files.",
      "suggestion": "Keep one and delete the other.",
      "range": { "line_start": 96, "line_end": 96 }
    },
    {
      "code": "negative_savings",
      "severity": "warning",
      "message": "TOON output is larger than the source text for this input."
    }
  ],
  "flags": { "lossless": true, "valid": true, "target_reached": null },
  "mode": "lossless",
  "delimiter": ","
}
```

(Engine-true numbers, taken from the realistic CLAUDE.md fixture: a mixed-profile agent doc usually measures *negative* — the verdict's advice is to split it into cleanly-typed blocks first, and `split_first` outranks `keep_markdown` precisely because splitting is the actionable fix.)

### curl against localhost (the v0.4.0 surface — illustrative until `serve` ships, days 13–18)

```bash
npx doc2toon serve --port 8787 &

curl -s -X POST http://127.0.0.1:8787/v1/profile \
  -H "content-type: application/json" \
  -d '{"content":"# AGENTS.md\n\n## Rules\n- Never commit directly to main.\n- Never push to main without review.\n"}' \
  | jq '{verdict, safe_to_auto_apply, savings_pct: .measured_chars.savings_pct, warnings: [.warnings[].code]}'
```

```json
{
  "verdict": "keep_markdown",
  "safe_to_auto_apply": false,
  "savings_pct": -19.4,
  "warnings": ["duplicate_rule", "negative_savings"]
}
```

(Honest output: TOON is *larger* for this tiny rule list, so the verdict says keep Markdown — and still flags the duplicated rule. The verdict is the product, not the compression.)

Document bodies never leave the machine — `serve` binds `127.0.0.1` by default.

### TypeScript (library API from v0.3.0, same shape over HTTP from v0.4.0)

```ts
import { runVerdict, type VerdictV1 } from "doc2toon";
// runVerdict lands in v0.3.0 and never throws on representable outcomes — refusal is a verdict.

const verdict: VerdictV1 = runVerdict(agentsMd, { mode: "lossless" });

if (verdict.verdict === "convert" && verdict.safe_to_auto_apply) {
  await writeFile("AGENTS.toon", verdict.toon_candidate!);
} else {
  console.log(`Keeping Markdown: ${verdict.verdict}`,
    verdict.warnings.map(w => w.code));
}

// The identical object over HTTP — one contract, two transports:
const res = await fetch("http://127.0.0.1:8787/v1/convert", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ content: agentsMd }),
});
const sameShape: VerdictV1 = await res.json();
```
