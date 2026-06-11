# Verdict Schema v1 — contract and decision log

**Status: DRAFT — frozen when the freeze merge lands (30-day plan, day 7).** After the freeze, every change to this contract follows the versioning rules at the bottom of this document. Nothing about the freeze is ceremonial: the schema ships in the npm tarball, the spec is published, and consumers multiply from day 8 onward.

**Calibration complete (2026-06-10):** the seven open questions below are answered with fixture data; the measured table and tuned constants live in `docs/calibration-v1.md`, and the snapshot tests pin the same behavior per fixture.

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

The `mode == "lossless"` clause was added on day 1 after measurement (see decision 12): only lossless mode preserves all source blocks by construction. Calibration outcome: coverage is now measured mechanically and disclosed (`low_coverage`, decision 12), but the clause is retained for v1.0 anyway — relaxing it against measured coverage is a documented 1.x option once the measurement has field mileage. Relaxing a criterion is additive; trusting a fresh one is not.

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
| `low_coverage` | verdict (coverage check) | The canonical retains too little of the source's content characters — the measured share is in the message (threshold `LOW_COVERAGE_RATIO`, tunable) |
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

### 12. Record-mode content coverage is measured and disclosed, never trusted (measured day 1; check shipped at calibration)

Day-1 measurement against the engine surfaced two facts the contract must not paper over:

- **`mixed`-profile documents are mode-invariant.** Real agent docs usually profile as `mixed`, and for them record mode produces byte-identical output to lossless mode, at heavily negative savings (-30% to -140% measured across fixtures). The verdict for them is honestly `keep_markdown` or `split_first` — which is the product's actual advice.
- **Record mode can silently drop content while flagging `lossless: true`.** Measured on `examples/prose.md`: a 2,051-char prose document collapsed to a single 405-char definition record (+80% "savings"), with three paragraphs gone, zero warnings, and `valid: true` — because round-trip validation checks the TOON against its own canonical JSON, not the canonical against the source. The `lossless` flag, as implemented, asserts "no budget compression was requested," not "content preserved."

The realistic fixtures (committed day 1, `fixtures/agent-context/realistic/README.md`) sharpened both facts: `architecture-rfc.md` (profiles `requirements`) shows record mode reporting **+91.6% savings, `lossless: true`, zero warnings** while the decoded output retains ~5% of the source; and `config-reference.md` shows even *lossless-claimed* table conversion silently dropping the title and caption lines (~3.4% of source).

Consequences encoded in this contract: the `flags.lossless` description states the honest semantics; `safe_to_auto_apply` requires `mode == "lossless"` (decision 4); and the engine work to verify coverage mechanically (source-to-canonical coverage check, plus fixing the raw-prose/requirements record extraction) is a calibration-week item (Phase 1, days 4–6) tracked in the open questions below. The verdict feature must not ship telling users record mode saved them 91% when it deleted their document.

**Calibration outcome (2026-06-10): the mechanical coverage check ships with the freeze.** `buildVerdict` measures the share of the source's content characters (alphanumerics — markdown syntax deliberately doesn't count) retained by the canonical document's string values, and fires a `low_coverage` warning (severity `warning`) below `LOW_COVERAGE_RATIO` (0.70). Measured: the two dishonest cases land at 8% (architecture-rfc.md record) and 18% (prose.md record) and now verdict `review`, never `convert`; every legitimate path measures 88–100%. The raw-prose/requirements record-extraction fix itself (sentence-boundary-aware `extractRules`) is deferred to a post-freeze minor — with the coverage check in place its absence can no longer produce a confident wrong verdict.

---

## Open calibration questions — ANSWERED (2026-06-10, with the data in `docs/calibration-v1.md`)

These did not block the schema draft — no field changes hung on them — and they are now answered with fixture data ahead of the freeze merge:

1. **Default wire mode.** The draft defaults `/v1/convert` to lossless (matches the CLI; honest by construction). The web app uses record mode for its agent-doc tabs. Once record-mode coverage verification exists, should the wire default flip to record for the flagship use, or stay lossless with record opt-in?
   **Answer: lossless stays the wire default; record is opt-in.** The calibration table shows record mode either produces the identical canonical (every `mixed` doc — all realistic agent docs), wins marginally on definitions-profile docs (+7.8%, +8.9% at 89–92% coverage), or "wins" big only by dropping content (+91.7% at 8% coverage, +80.2% at 18%). Nothing in that distribution justifies defaulting a lossy-in-practice mode. Record mode stays available with its coverage now measured and disclosed.
2. **Record-mode coverage verification.**
   **Answer: shipped with the freeze, in the verdict layer.** `measureContentCoverage` compares content characters (alphanumerics) between source and canonical; below `LOW_COVERAGE_RATIO` (0.70) a `low_coverage` warning (severity `warning`) fires and the decision policy lands on `review` (or worse) instead of `convert`. The `extractRules` sentence-boundary fix is deferred to a post-freeze minor: with the coverage check in place, the misfire can no longer produce a confident wrong verdict — it produces a disclosed, review-class one.
3. **Mixed-profile mode invariance.**
   **Answer: `split_first`/`keep_markdown` is the v1 answer for mixed docs, permanently per mode-invariance.** Every `mixed` fixture is mode-invariant (record short-circuits to the lossless canonical) at -33% to -137% savings. A genuinely smaller mixed canonical would be a designed artifact, not a threshold tune — if it ever exists it arrives in a minor with its own calibration pass. The verdict's advice (split into cleanly-typed blocks) is the product's actual advice.
4. **Web app alignment.**
   **Answer: the web swaps to the engine verdict in Phase 2 with no user-visible verdict flips.** Measured on the web's own samples in their current tab modes: engine and web agree on every tab today (keep_markdown / split_first / split_first / keep_markdown). The web's record-default tabs keep record mode as their display default for now (the verdicts agree either way on the corpus); the wire default stays lossless per question 1, and record-tab users gain `low_coverage` disclosure the client-side logic never had.
5. **`long_section` vs. uniform tables.**
   **Answer: exempted.** Sections whose non-empty lines are ≥ `LONG_SECTION_TABLE_LINE_RATIO` (0.60) table rows no longer fire `long_section` — tables are the case that converts well, so their length is not a smell. config-reference.md flips from a doomed `split_first` to the corpus's one honest `convert` with `safe_to_auto_apply: true` (+22.2%, decode-verified 294/294 rows). Mixed-content long sections (prose plus an embedded table) still fire: the toy corpus confirms no other verdict moved.
6. **Lossless-mode coverage check.**
   **Answer: the coverage check applies to every mode, and quantifies this case at 91% — above the warning bar, documented as a known v1 limitation.** The honest fix is the `table` canonical carrying title/intro/captions; that is a canonical-shape change (library-visible, savings-number-moving) scheduled as a post-freeze minor, at which point coverage reaches ~100% and the limitation note is deleted. `safe_to_auto_apply` on table docs is accepted for v1 with this disclosed: the drop is bounded (9% of content chars on the worst fixture), measured, and the candidate is decode-verified.
7. **Phantom definitions.**
   **Answer: deferred to a post-freeze minor, with the blast radius measured and bounded.** The heuristic inflates `definitions` counts (realistic SKILL.md: 17, mostly phantom) and pushes docs toward `mixed` — but on the corpus this changes no verdict: mixed agent docs measure heavily negative with or without the phantoms, and the honest verdict for them is `keep_markdown`/`split_first` either way (question 3). Profiler precision work is real engine work for a 1.x minor and is deliberately not rushed into freeze week; the calibration table is the regression baseline for it.

## Decision policy (normative; constants tunable)

Evaluated in priority order against deterministic inputs only:

| Priority | Verdict | Condition |
|---|---|---|
| 1 | `refused` | Budget target unreachable losslessly and lossy output not permitted |
| 2 | `split_first` | Any `long_section` or `split_candidate` warning fired |
| 3 | `keep_markdown` | `measured_chars.savings <= 0` **or** `savings_pct < MIN_CONVERT_SAVINGS_PCT` (5, tunable — sub-band wins do not justify a format change; calibration caught a +0.4% "win" earning `convert`) |
| 4 | `review` | Any other warning fired (any code, any severity) |
| 5 | `convert` | Otherwise: zero warnings and measured savings at or above the band |

**Fields freeze; thresholds don't.** The optimizer constants that decide when `long_section` / `split_candidate` / `duplicate_rule` / `vague_rule` fire (in `src/optimizer.ts`) and the verdict-policy constants (`MIN_CONVERT_SAVINGS_PCT`, `LOW_COVERAGE_RATIO` in `src/verdict.ts`; `LONG_SECTION_TABLE_LINE_RATIO` in `src/optimizer.ts`) are decision-policy constants, documented here as **minor-version-tunable**: teardown-week feedback may tune them in a 1.x minor with a CHANGELOG entry, without any schema change. The calibration table (`docs/calibration-v1.md`) pins current behavior per fixture, the snapshot tests pin it as committed expectations, so every tune is a visible diff.

---

## Versioning and freeze rules

- Every verdict carries `schema_version: "1.0"`.
- **Within 1.x: additive optional fields only.** No removal, no retype, no enum-shrink, no new required fields. Consumers MUST ignore unknown fields. An additive change bumps to `"1.1"` with a CHANGELOG entry and an npm minor.
- **Breaking change = new document**: `schemas/verdict.v2.json`, new `$id`, `schema_version: "2.0"`, emitted alongside v1 during a deprecation window. A post-freeze breaking change is a defined versioning event, not a crisis.
- The `$id` URL (`https://cheapagent.ai/schemas/verdict.v1.json`) resolves publicly once cheapagent.ai deploys `public/schemas/verdict.v1.json` (soft launch, day 19).
- Closed enums in v1 (changing any is v2): `verdict`, `severity`, `mode`, `delimiter`, `profile.name`, `profile.source_type`. Open sets (additive within 1.x): warning `code`, `estimator` strings.

---

## Examples

### A verdict (split_first, profile surface — `toon_candidate` withheld, warnings abridged)

```json
{
  "schema_version": "1.0",
  "verdict": "split_first",
  "safe_to_auto_apply": false,
  "profile": {
    "name": "mixed",
    "title": "CLAUDE.md — Bramblebill monorepo",
    "source_type": "markdown",
    "stats": { "lines": 435, "headings": 29, "paragraphs": 108, "list_items": 89, "tables": 0, "table_rows": 0, "definitions": 23, "rules": 53 }
  },
  "measured_chars": { "source": 20490, "toon": 27644, "savings": -7154, "savings_pct": -34.9 },
  "token_estimates": {
    "estimator": "chars-per-token:4",
    "source": 5123, "toon": 6911, "savings": -1788, "savings_pct": -34.9,
    "ratio_estimates": [
      { "chars_per_token": 3.5, "source": 5854, "toon": 7898, "savings": -2044, "savings_pct": -34.9 },
      { "chars_per_token": 4, "source": 5123, "toon": 6911, "savings": -1788, "savings_pct": -34.9 },
      { "chars_per_token": 4.5, "source": 4553, "toon": 6143, "savings": -1590, "savings_pct": -34.9 }
    ]
  },
  "toon_candidate": null,
  "warnings": [
    {
      "code": "duplicate_rule",
      "severity": "warning",
      "message": "Possible duplicate rule in \"Gotchas\".",
      "suggestion": "Merge these rules or keep only the version with the clearest action and scope.",
      "evidence": "Never use JavaScript number arithmetic for invoice amounts; always",
      "range": { "line_start": 336, "line_end": 336, "char_start": 15350, "char_end": 15418 }
    },
    {
      "code": "long_section",
      "severity": "info",
      "message": "Long section: \"Testing\".",
      "suggestion": "Consider splitting this into a shorter canonical rule plus one or more task-specific skill files.",
      "evidence": "3069 chars, 50 non-empty lines, 14 bullets",
      "range": { "line_start": 225, "line_end": 279, "char_start": 9781, "char_end": 12890 }
    },
    {
      "code": "negative_savings",
      "severity": "warning",
      "message": "TOON output is larger than the source text for this input."
    }
  ],
  "flags": { "lossless": true, "valid": true, "target_reached": null },
  "mode": "lossless",
  "delimiter": "\t"
}
```

(Engine-true output for the realistic CLAUDE.md fixture — these exact values are pinned in `test/__snapshots__/verdict.test.ts.snap`, abridged here from six warnings to three. A mixed-profile agent doc usually measures *negative* — the verdict's advice is to split it into cleanly-typed blocks first, and `split_first` outranks `keep_markdown` precisely because splitting is the actionable fix. Note `long_section` is severity `info`: severities are data from the optimizer, and the decision policy keys on codes, not severities. The `chars-per-token:4` estimator identity is what browser surfaces report; CLI surfaces report `tokenx@1.3.0` with different advisory numbers and the identical verdict.)

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
