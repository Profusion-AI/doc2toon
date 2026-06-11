# Context plans: section-level verdicts as the main workflow

**Status:** design handoff — agreed direction, not yet implemented. Pre-registration items in §6 must land before any plan code runs against the corpus.
**Date:** 2026-06-11
**Provenance:** synthesis of two positions, both summarized in §1 so this doc stands alone: the threshold-freeze analysis (engine side) and the product direction (Kyle): keep whole-document `convert` strict; make `split_first` the product's main workflow via measured, per-section context plans. Target framing: *"Whole-doc TOON is rare; doc2toon finds the parts worth converting and refuses the rest."*

---

## 1. What is settled (both positions agree; none of this reopens)

- **Decision-policy constants stay frozen.** No change to `MIN_CONVERT_SAVINGS_PCT` (5), `LOW_COVERAGE_RATIO` (0.7), `LONG_SECTION_TABLE_LINE_RATIO` (0.6), or the verdict priority order. The corpus data is unambiguous: all 19 external lane-1 docs measure *negative* whole-doc (−2.8% to −86.9%), so no threshold value produces honest whole-doc flips — the measurements are the gate, not the constants. The constants are now out-of-sample-validated; that is an asset.
- **The honesty denominators stay as published**: 1 of 19 internal, 0 of 19 external whole-doc converts. Context plans *add* a metric; they never replace or restate those numbers.
- **No tuning toward "yes."** A future constant change requires a separate, documented calibration event motivated by evidence of miscalibration (e.g., post-launch verdict disputes with receipts) — tuning toward truth, per the freeze rules in `verdict-schema-v1.md`.
- **The verdict unit is too coarse for mixed agent docs, and that is a product gap, not a threshold problem.** The external corpus says so in our own stored measurements (`fixtures/agent-context/external/results.json`): 16 of 19 docs verdict `split_first`; 5 of 19 carry tables (47 rows total); **19 of 19 contain rules** (7–57 per doc) and 18 of 19 contain definitions. The convertible substrate is *inside* the documents. Today `split_first` ends the conversation; the plan makes it the beginning.

## 2. The product: context plans

A **context plan** is a per-section analysis of one document under the existing frozen policy:

- Sections are **heading-bounded blocks from the document's own structure** (the optimizer's existing section model — the same boundaries `long_section`/`split_candidate` already reason about). v1 does **no boundary search/optimization**: boundaries come from the author's headings, so every plan line is explainable as "your own section, measured." (Optimized split-point search is future work and would be a calibration-grade surface; out of scope here.)
- Each section is measured **as if it were a standalone document, under the unchanged frozen policy**: lossless convert → measured chars → same 5% band, same warning codes, same priority order. **A section "converts" iff it would earn `convert` as a document.** This is the central design move: *policy composition instead of new judgment* — context plans introduce **zero new tunable constants**.
- The plan's recommendation: convert the sections that independently clear the policy; keep everything else as Markdown; report **measured per-section deltas** and the **aggregate net delta including splice overhead** (kept headings, fence markers — stitching costs are counted, not hidden).
- **Hybrid output is recommended only when the aggregate net savings clears `MIN_CONVERT_SAVINGS_PCT`** — the same frozen 5% band, reused at plan level. Below the band, the plan's honest answer is "keep the whole document" even if one small table technically wins.
- **v1 plans are lossless-only.** Record-mode (semantic compression) stays a whole-document, explicit opt-in; mixing lossy sections into a "plan" muddies the one sentence the product must keep true.
- `safe_to_auto_apply` semantics:
  - The existing whole-doc field is **unchanged**.
  - Each plan section gets its own `safe_to_auto_apply` under the existing formula.
  - Plan-level `safe_to_auto_apply` is true only if **every converted section is individually safe AND reassembly is verified**: kept sections byte-identical, converted sections decode-verified, document re-stitches to full coverage.

### Hybrid emission format

A Markdown document where converted sections become fenced ` ```toon ` blocks in place, everything else byte-identical. Agents already consume fenced blocks; the file remains one self-contained context document. (Format note for the implementer: the fence is the splice overhead — count it.)

## 3. Wire contract (additive, per the freeze rules)

New **optional** field on the verdict object — `context_plan` — making this a `schema_version: "1.1"` additive change (CHANGELOG + npm minor; consumers MUST ignore unknown fields, already normative):

```jsonc
"context_plan": {
  "sections": [
    {
      "heading": "Configuration reference",        // or null for preamble
      "range": { "line_start": 120, "line_end": 184 },
      "profile": "table",
      "action": "convert" | "keep",
      "measured_chars": { "source": n, "toon": n, "savings": n, "savings_pct": n }, // convert sections only
      "warnings": [ /* coded, same registry */ ],
      "safe_to_auto_apply": bool
    }
  ],
  "net": { "source": n, "hybrid": n, "savings": n, "savings_pct": n },  // splice overhead included
  "recommend_hybrid": bool,            // net clears the frozen 5% band
  "safe_to_auto_apply": bool           // all converted sections safe + reassembly verified
}
```

Sync obligations as always: `schemas/verdict.v1.json` + `openapi/cheapagent.v1.yaml` in lockstep, ajv per-fixture validation, snapshots (the additive field will show as a visible snapshot diff — by design).

### Surfaces

- **CLI:** new `doc2toon plan [--json] <file>` subcommand (existing commands' output stays byte-stable; no flag soup on `profile`/`convert`). Exit-code contract identical to `profile`. `--fail-on` gains nothing new — plans inform, the verdict gates.
- **Web:** plan table under the verdict card; "Copy plan" reuses the schema-field-named summary style; hybrid download. (`split_first` verdict card gains: "…and here's the plan.")
- **Action/MCP/serve:** the field rides along free once they consume Verdict 1.1; the Action comment may append a one-line plan summary per file (codes and numbers only, as ever).

## 4. Supporting engine fixes (already-flagged, now sequenced with a reason)

1. **Table canonical title/caption retention** (the 91%-coverage caveat on config-reference): section plans make this urgent — table sections are precisely where plans win, and dropping captions inside a hybrid is not acceptable.
2. **Phantom-definitions heuristic fix**: section profiles must be accurate for per-section verdicts to be credible.
3. **`extractRules` mid-sentence splitting fix**: not needed for lossless-only v1 plans, but queued for any future record-mode story; keeping it on the list so it isn't lost.
4. **YAML frontmatter awareness**: parse frontmatter as a metadata section, always `keep`. Unblocks honest lane-2 (skill-pack) measurement — the profiler currently counts frontmatter lines as content/definitions (documented caveat in `fixtures/agent-context/external/results.json`).

## 5. The metric (pre-registered BEFORE implementation runs against the corpus)

**Actionable-plan rate:** the share of corpus documents whose context plan recommends a hybrid (`recommend_hybrid: true`, i.e., net savings ≥ the frozen 5% band with every converted section independently clearing the unchanged policy). Secondary: median net savings among plan-positive docs; count of plan-level `safe_to_auto_apply`.

- Re-run target: the **same pinned corpus** (internal 19 + external lane-1 19, the exact manifest SHAs) — no re-pinning for this measurement, so the only variable is the new capability.
- **The "one-third of docs" figure is a product hypothesis to test, not a number to hit.** If the measured rate is 3/19, we publish 3/19. Goodhart guard, explicitly: the metric definition above is frozen by this document *before* any plan code exists; it does not get massaged after results exist. Any later metric change is a new pre-registration.
- Honesty-page treatment when results exist: a third section *adding* the plan metric. The whole-doc numbers stay the headline of their sections; the plan section's headline is Kyle's line — finds the parts, refuses the rest.

## 6. Pre-registration checklist (must land before plan code measures the corpus)

- [ ] This document merged (done by the commit that adds it).
- [ ] Metric definition (§5) appended to `fixtures/agent-context/external/README.md` as a dated amendment.
- [ ] Schema 1.1 draft (`context_plan`) reviewed against the freeze rules before implementation starts.

## 7. Complementary content move (independent of engineering)

**Table-shaped wild round:** the external corpus has zero `table`-profiled documents because we sourced by agent-doc filename — the win class lives in *other* files (rules references, API matrices, config tables; ruff's own rules docs are a giant uniform table). A round-3 lane targeting table-shaped public files — same gates, pins, frozen thresholds — is the honest way to show whole-doc converts in the wild, and it's a content-lane move that needs no engine work. Also zero-engine: a **manual plan teardown** (run a famous doc's sections through the existing CLI by hand) can ship as content *before* the feature exists — both a demand probe and the feature's announcement post.

## 8. Sequencing recommendation (decision: Kyle's)

The 30-day plan's critical path (Phase 4 MCP/serve → v0.4.0 by day 17; instrumentation hard deadline day 18; Phase 5 launch wave days 19–23, engineering-frozen; Phase 6 gate week) has no slack for a 2–4 day engine feature before day 30, and plans do not feed the day-30 gate's instrumentation.

- **Recommended:** design + pre-registration now (this doc); manual plan teardown during Phase 5 content week (zero engine work, validates demand); implementation as the **first post-gate engineering block (day 31+)**, shipping as Verdict 1.1 in v0.5.0. Works under either gate outcome: if the gate passes, plans are the hosted API's flagship capability; if it fails, plans are the strongest local/OSS value driver.
- **Alternative (pull-forward):** trade MCP-or-serve scope in Phase 4 for plans. Not recommended: those artifacts feed the day-18 beat and the gate; plans don't.

## 9. Risks and guards

| Risk | Guard |
|---|---|
| Goodhart on the 1/3 hypothesis | Metric frozen in §5 before code exists; publish whatever falls out |
| Plans become a side-door re-derivation of judgment | Sections judged by the *unchanged* whole-doc policy; zero new constants; plan recommendation reuses the frozen band |
| Splice overhead hidden, net savings overstated | Overhead counted in `net`; reassembly verified for any `safe_to_auto_apply` |
| Boundary gaming (cherry-picked split points) | v1 boundaries = the author's own headings, deterministic; no search |
| Contract drift | Additive-only 1.1; existing fields byte-stable; sync tests enforce schema/OpenAPI lockstep |
| Frontmatter mangling inside hybrids | Fix §4.4 lands with or before plans; frontmatter sections always `keep` |

## 10. Definition of done (implementation phase, when scheduled)

- `doc2toon plan --json` emits Verdict 1.1 with `context_plan`; ajv + OpenAPI sync green; snapshots updated and reviewed.
- Reassembly property test: for every fixture, kept-section bytes identical; converted sections decode-verified; full-document coverage on re-stitch.
- Pinned-corpus re-run produces the §5 metric; results stored in the external results format (bodies never stored); honesty page gains the plan section.
- Web renders the plan under the verdict card with Copy-plan; no regression on the existing verdict UI contract (`llms.txt` ids stable, additive only).
- A real teardown published using the shipped feature on one famous doc from the corpus.
