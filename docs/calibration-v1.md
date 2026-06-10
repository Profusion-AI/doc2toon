# Verdict calibration table — v1 freeze

**Date:** 2026-06-10 (Phase 1, run ahead of the day 4–6 window) · **Engine:** doc2toon `phase1/verdict-engine` · **Estimator for advisory numbers:** tokenx@1.3.0 (decisions use measured chars only — the verdict column is estimator-independent, proven by the parity test in `test/verdict.test.ts`).

Regenerate with `npm run build && node scripts/calibration-table.mjs` (add `--json` for machine-readable rows). Every row below was hand-verified against the decision policy in `docs/verdict-schema-v1.md`; the snapshot tests pin the same behavior per fixture, so any future threshold tune shows up as a visible diff in both places.

**Columns:** *chars Δ* = measured character savings (positive = TOON smaller). *coverage* = share of the source's content characters (alphanumerics; markdown syntax deliberately doesn't count) retained by the canonical document, clamped to 100% — the mechanical check decision 12 calls for. *auto-apply* = `safe_to_auto_apply`.

## Calibrated constants (decision-policy constants — minor-version-tunable, never schema changes)

| Constant | Value | What it does | Why this value |
|---|---|---|---|
| `MIN_CONVERT_SAVINGS_PCT` | 5 | Positive savings below this stay `keep_markdown` | The corpus separates real wins (+22.2%, +8.9%, +7.8%) from rounding-error wins (+0.4%) with a wide gap; without the band, architecture-rfc.md (+0.4%) earned `convert` with `safe_to_auto_apply: true` — a wrong-and-confident verdict on 186 chars of 45,628 |
| `LOW_COVERAGE_RATIO` | 0.70 | Coverage below this fires `low_coverage` (severity `warning`) | Legitimate paths measure 88–100%; the record-mode content-loss cases measure 8–66%. The gap between 70 and 88 is the buffer |
| `LONG_SECTION_TABLE_LINE_RATIO` | 0.60 | Sections whose non-empty lines are ≥60% table rows are exempt from `long_section` | The `table` profile requires ≤1 heading, so every real-size table doc is one giant "section"; without the exemption the engine's best win class (config-reference.md, +22.2%, decode-verified) could never receive `convert` |

## Table

| document | profile | mode | chars Δ | coverage | warnings | verdict | auto-apply |
|---|---|---|---|---|---|---|---|
| examples/definitions.md | definitions | lossless | -8.1% | 100% | negative_savings | **keep_markdown** | false |
| examples/definitions.md | definitions | record | +8.9% | 92% | — | **convert** | false |
| examples/prose.md | raw_prose | lossless | -3.4% | 100% | negative_savings | **keep_markdown** | false |
| examples/prose.md | raw_prose | record | +80.2% | 18% | low_coverage | **review** | false |
| examples/requirements.md | requirements | lossless | -10.6% | 100% | negative_savings | **keep_markdown** | false |
| examples/requirements.md | requirements | record | -17.2% | 100% | negative_savings | **keep_markdown** | false |
| examples/table.md | mixed | lossless | -136.9% | 100% | negative_savings | **keep_markdown** | false |
| examples/table.md | mixed | record (= lossless) | -136.9% | 100% | negative_savings | **keep_markdown** | false |
| fixtures/agent-context/AGENTS.md | mixed | lossless | -124.0% | 100% | negative_savings | **keep_markdown** | false |
| fixtures/agent-context/AGENTS.md | mixed | record (= lossless) | -124.0% | 100% | negative_savings | **keep_markdown** | false |
| fixtures/agent-context/CLAUDE.md | requirements | lossless | -19.1% | 100% | negative_savings | **keep_markdown** | false |
| fixtures/agent-context/CLAUDE.md | requirements | record | -32.5% | 100% | negative_savings | **keep_markdown** | false |
| fixtures/agent-context/SKILL.md | mixed | lossless | -103.8% | 100% | negative_savings | **keep_markdown** | false |
| fixtures/agent-context/SKILL.md | mixed | record (= lossless) | -103.8% | 100% | negative_savings | **keep_markdown** | false |
| fixtures/agent-context/problematic/duplicate-rules.md | requirements | lossless | -20.4% | 100% | duplicate_rule, negative_savings | **keep_markdown** | false |
| fixtures/agent-context/problematic/duplicate-rules.md | requirements | record | -24.8% | 100% | duplicate_rule, negative_savings | **keep_markdown** | false |
| fixtures/agent-context/problematic/long-section.md | requirements | lossless | -4.8% | 100% | long_section, split_candidate, negative_savings | **split_first** | false |
| fixtures/agent-context/problematic/long-section.md | requirements | record | -24.4% | 100% | long_section, split_candidate, negative_savings | **split_first** | false |
| fixtures/agent-context/problematic/mixed-agent-context.md | mixed | lossless | -123.4% | 100% | duplicate_rule, vague_rule, long_section, split_candidate, negative_savings | **split_first** | false |
| fixtures/agent-context/problematic/mixed-agent-context.md | mixed | record (= lossless) | -123.4% | 100% | duplicate_rule, vague_rule, long_section, split_candidate, negative_savings | **split_first** | false |
| fixtures/agent-context/problematic/split-candidate.md | requirements | lossless | -11.2% | 100% | split_candidate, negative_savings | **split_first** | false |
| fixtures/agent-context/problematic/split-candidate.md | requirements | record | +28.1% | 66% | split_candidate, low_coverage | **split_first** | false |
| fixtures/agent-context/problematic/vague-rules.md | requirements | lossless | -25.9% | 100% | vague_rule, negative_savings | **keep_markdown** | false |
| fixtures/agent-context/problematic/vague-rules.md | requirements | record | -37.9% | 100% | vague_rule, negative_savings | **keep_markdown** | false |
| fixtures/agent-context/realistic/AGENTS.md | mixed | lossless | -58.4% | 100% | duplicate_rule, vague_rule, negative_savings | **keep_markdown** | false |
| fixtures/agent-context/realistic/AGENTS.md | mixed | record (= lossless) | -58.4% | 100% | duplicate_rule, vague_rule, negative_savings | **keep_markdown** | false |
| fixtures/agent-context/realistic/CLAUDE.md | mixed | lossless | -34.9% | 100% | duplicate_rule, vague_rule, long_section, negative_savings | **split_first** | false |
| fixtures/agent-context/realistic/CLAUDE.md | mixed | record (= lossless) | -34.9% | 100% | duplicate_rule, vague_rule, long_section, negative_savings | **split_first** | false |
| fixtures/agent-context/realistic/SKILL.md | mixed | lossless | -36.3% | 100% | negative_savings | **keep_markdown** | false |
| fixtures/agent-context/realistic/SKILL.md | mixed | record (= lossless) | -36.3% | 100% | negative_savings | **keep_markdown** | false |
| fixtures/agent-context/realistic/architecture-rfc.md | requirements | lossless | +0.4% | 100% | — | **keep_markdown** | false |
| fixtures/agent-context/realistic/architecture-rfc.md | requirements | record | +91.7% | 8% | low_coverage | **review** | false |
| fixtures/agent-context/realistic/config-reference.md | table | lossless | +22.2% | 91% | — | **convert** | **true** |
| fixtures/agent-context/realistic/config-reference.md | table | record (= lossless) | +22.2% | 91% | — | **convert** | false |
| fixtures/glossary.md | definitions | lossless | -15.6% | 100% | negative_savings | **keep_markdown** | false |
| fixtures/glossary.md | definitions | record | +7.8% | 89% | — | **convert** | false |
| fixtures/sample.md | mixed | lossless | -33.1% | 100% | negative_savings | **keep_markdown** | false |
| fixtures/sample.md | mixed | record (= lossless) | -33.1% | 100% | negative_savings | **keep_markdown** | false |
| web-sample/claude (record tab) | requirements | lossless | -18.8% | 100% | duplicate_rule, vague_rule, negative_savings | **keep_markdown** | false |
| web-sample/claude (record tab) | requirements | record | -0.2% | 88% | duplicate_rule, vague_rule, negative_savings | **keep_markdown** | false |
| web-sample/agents (record tab) | requirements | lossless | -20.0% | 100% | vague_rule, split_candidate, negative_savings | **split_first** | false |
| web-sample/agents (record tab) | requirements | record | +40.1% | 50% | vague_rule, split_candidate, low_coverage | **split_first** | false |
| web-sample/skill (record tab) | requirements | lossless | -24.1% | 100% | duplicate_rule, vague_rule, split_candidate, negative_savings | **split_first** | false |
| web-sample/skill (record tab) | requirements | record | -24.9% | 100% | duplicate_rule, vague_rule, split_candidate, negative_savings | **split_first** | false |
| web-sample/toon (lossless tab) | definitions | lossless | -23.1% | 100% | negative_savings | **keep_markdown** | false |
| web-sample/toon (lossless tab) | definitions | record | -0.5% | 93% | negative_savings | **keep_markdown** | false |

## Hand-verification notes (what the table proves)

1. **Every verdict is reachable, honestly.** `convert`: config-reference lossless (+22.2%, decode-verified, the table exemption made it reachable) and definitions-profile record runs (+8.9%, +7.8%, coverage ≥ 89%). `review`: the record-mode content-loss cases. `split_first` / `keep_markdown`: the bulk of real agent docs, which is the product's actual advice. `refused`: pinned by tests (budget target unreachable losslessly).
2. **The decision-12 dishonesty is contained.** architecture-rfc record mode (+91.7% "savings", 8% coverage) and prose.md record (+80.2%, 18%) — the cases that previously earned `convert` with `lossless: true` and zero warnings — now fire `low_coverage` and land on `review`. `safe_to_auto_apply` additionally requires `mode == "lossless"`, so neither could auto-apply regardless.
3. **The one `safe_to_auto_apply: true` row is the right one.** Lossless, valid, +22.2%, zero warnings, decode-verified 294/294 rows. The identical canonical under record mode gets `false` purely from the mode clause — the formula working as written (decision 4).
4. **Web/wire alignment (open question 4).** On the web's own samples, the engine verdict in the tab's current mode matches what the web shows today on every tab (keep_markdown / split_first / split_first / keep_markdown). The Phase 2 engine swap changes no sample verdict; record-tab users gain the `low_coverage` honesty (agents sample: 50% coverage now disclosed).
5. **Estimator parity holds empirically.** This table (tokenx) and the snapshot suite (chars-per-token:4) produce identical verdict and auto-apply fields on all 19 fixtures, including the delimiter-selection channel (`selectEncoding` sorts candidates by estimated tokens; on this corpus both estimators choose compatible candidates — and the decision inputs are chars regardless). One documented nuance: with `--target-tokens`, `target_reached` is evaluated with the reporting surface's estimator — a token question gets an estimator answer; char targets are fully deterministic.
6. **Mode invariance for mixed profiles** (open question 3): every `mixed` row is marked `(= lossless)` — record mode short-circuits to the identical canonical. Mixed docs' verdicts are mode-independent by construction in v1.
7. **The lossless `table` canonical retains 91%** of content chars on config-reference (title, intro paragraph, and blockquote captions are the gap) — the quantified open-question-6 limitation, documented in the schema doc and accepted for v1 with the canonical fix named for a post-freeze minor.
