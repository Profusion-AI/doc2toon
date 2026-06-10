# Realistic agent-context fixtures

Real-scale, real-shaped calibration fixtures for the verdict contract (`docs/verdict-schema-v1.md`). All content is original and describes fictional projects. Unlike the toy fixtures one directory up (12–74 lines), these are 350–840 lines and messy the way real files are messy. They were authored against the live CLI: every number below is measured, not aspirational.

Expected verdicts follow the v1 decision policy in default (lossless) mode. Measured 2026-06-10 against doc2toon 0.2.1 + the Phase 0 contract draft; re-measure when optimizer thresholds tune (the numbers are calibration inputs, not test assertions — snapshot tests pin behavior separately in Phase 1).

## Expected verdicts (lossless mode)

| Fixture | Lines | Profile | Chars Δ | Tokens Δ (tokenx) | Warnings fired | Expected verdict | Why |
|---|---|---|---|---|---|---|---|
| `CLAUDE.md` | 434 | mixed | −37.8% | −47.8% | long_section, duplicate_rule ×2, vague_rule ×2, negative_savings | **split_first** | "Testing" section exceeds all three long_section thresholds; priority 1 beats the negative savings |
| `AGENTS.md` | 459 | mixed | −62.1% | −73.7% | duplicate_rule ×2, vague_rule ×2, negative_savings | **keep_markdown** | The precedence case: negative savings (priority 3) outranks review-class warnings (priority 4) |
| `SKILL.md` | 364 | mixed | −38.9% | −44.9% | negative_savings | **keep_markdown** | Zero optimizer warnings, but even a maximally disciplined SKILL.md profiles `mixed` and loses chars |
| `architecture-rfc.md` | 838 | requirements | −1.5% | −6.6% | negative_savings | **keep_markdown** | Flowing prose; TOON's quoting overhead exceeds structural compression |
| `config-reference.md` | 449 | table | **+21.1%** | **+29.1%** | long_section | **split_first** | A legitimate, decode-verified win (294/294 rows survive) — but long_section fires on the single giant section a `table` profile requires |

## What these fixtures taught us (calibration findings, day 1)

These feed the threshold-calibration week (days 4–6) and the open questions in `docs/verdict-schema-v1.md`:

1. **`convert` is currently unreachable for realistic agent docs.** Real CLAUDE/AGENTS/SKILL shapes profile as `mixed` (tables + rules + defs + prose ≥ 3 active kinds), and the mixed canonical duplicates section bodies into defs/rules/rows — heavily negative savings in *both* modes (record short-circuits to the same canonical). The honest verdict for them is `keep_markdown` or `split_first`, which is the product's actual advice.
2. **`review` is currently near-unreachable** for the same reason: it requires positive savings plus non-split warnings, and positive savings require a non-mixed profile.
3. **The record-mode content-loss bug, demonstrated** (`architecture-rfc.md`): the doc profiles as `requirements`, and `--mode record` reports **+91.6% savings with `lossless: true` and zero warnings** while the decoded output retains only 33 wrapped-line rule fragments — about 5% of the source. The record-mode verdict would be `convert`. This is the dishonest outcome decision 12 exists to prevent; `safe_to_auto_apply` requires lossless mode until coverage is verified mechanically. (`extractRules` splits on newlines before sentence boundaries, so the retained fragments are cut mid-sentence.)
4. **Even lossless-claimed table conversion drops content** (`config-reference.md`): title, intro paragraph, and 29 blockquote caption lines (~3.4% of source) are silently absent from the candidate while the engine reports `lossless: true`. Smaller than the record-mode bug, same class: the lossless flag asserts intent, not verified coverage.
5. **`long_section` fires on uniform tables** (`config-reference.md`): the `table` profile requires ≤1 heading, so any real-size table doc is one giant "section" and long_section always fires — turning a decode-verified +21% win into `split_first`. Threshold tuning should likely exempt (or weight differently) sections that are a single uniform table.
6. **The parser's inline-definition heuristic produces junk definitions** (`SKILL.md`, `architecture-rfc.md`): capitalized lines containing a hyphen or `Term: def` shapes get extracted as definitions, inflating activeKinds toward `mixed` and (in the RFC's case) requiring deliberate line-wrapping to dodge phantom matches.

## Per-fixture notes

- **`CLAUDE.md`** — fictional B2B invoicing TypeScript monorepo. Reads like 8 months of accretion: a deliberately overlong Testing section (3,069 chars / 50 lines / 14 bullets vs. thresholds 1500/40/12), two near-duplicate rule pairs stated in different sections, two vague rules, plus plenty of legitimate content.
- **`AGENTS.md`** — fictional Python event-ingestion/warehouse service. Duplicates: the schema-stubs rule (Do + Schema management) and the never-point-at-prod-warehouse rule (Operating rules + Merge semantics). Vague: "Handle errors gracefully…", "Use good judgment…". All sections under the long_section thresholds, so the warnings present are exactly the review-class ones the precedence test needs.
- **`SKILL.md`** — fictional quarterly-board-report skill. Zero optimizer warnings by construction; the `mixed` profile comes from its 17 table rows + 12 extracted rules + 17 (mostly phantom) definitions. Decode check: all 38 sections/rules/defs/rows survive — no content loss on the mixed path.
- **`architecture-rfc.md`** — fictional cron-to-event-streaming migration RFC, 838 lines of prose. Enough headings to keep every section under the long_section thresholds; deliberately line-wrapped to avoid phantom definitions. The record-mode bug demonstration case (finding 3).
- **`config-reference.md`** — fictional IaC tool reference: single H1, blockquote captions, 28 uniform-schema tables, 294 rows, zero rules/defs. The legitimate-win case (decode-verified) and the long_section-vs-tables threshold case (finding 5).
