# Context plans: section-level verdicts as the main workflow

**Status:** implementation handoff — agreed direction, QC-amended. Pre-registration items in §6 must land before any plan code runs against the corpus.
**Date:** 2026-06-11
**QC amendments (2026-06-11, pre-implementation):** (1) the section model is now normative with source ranges (§2.1) — the existing `{ h, body }` model is explicitly insufficient; (2) the wire contract is decided: only the plan surface emits `schema_version: "1.1"` (§3); (3) every measured section carries its standalone `verdict` and `measured_chars`, `keep` included (§2, §3); (4) plan-level `safe_to_auto_apply` is non-vacuous — it requires at least one converted section (§2, §3); (5) the internal corpus is pinned by file hash alongside the external manifest SHAs (§5, §6).
**Provenance:** synthesis of two positions, both summarized in §1 so this doc stands alone: the threshold-freeze analysis (engine side) and the product direction (Kyle): keep whole-document `convert` strict; make `split_first` the product's main workflow via measured, per-section context plans. Target framing: *"Whole-doc TOON is rare; doc2toon finds the parts worth converting and refuses the rest."*

---

## 1. What is settled (both positions agree; none of this reopens)

- **Decision-policy constants stay frozen.** No change to `MIN_CONVERT_SAVINGS_PCT` (5), `LOW_COVERAGE_RATIO` (0.7), `LONG_SECTION_TABLE_LINE_RATIO` (0.6), or the verdict priority order. The corpus data is unambiguous: all 19 external lane-1 docs measure *negative* whole-doc (−2.8% to −86.9%), so no threshold value produces honest whole-doc flips — the measurements are the gate, not the constants. The constants are now out-of-sample-validated; that is an asset.
- **The honesty denominators stay as published**: 1 of 19 internal, 0 of 19 external whole-doc converts. Context plans *add* a metric; they never replace or restate those numbers.
- **No tuning toward "yes."** A future constant change requires a separate, documented calibration event motivated by evidence of miscalibration (e.g., post-launch verdict disputes with receipts) — tuning toward truth, per the freeze rules in `verdict-schema-v1.md`.
- **The verdict unit is too coarse for mixed agent docs, and that is a product gap, not a threshold problem.** The external corpus says so in our own stored measurements (`fixtures/agent-context/external/results.json`): 16 of 19 docs verdict `split_first`; 5 of 19 carry tables (47 rows total); **19 of 19 contain rules** (7–57 per doc) and 18 of 19 contain definitions. The convertible substrate is *inside* the documents. Today `split_first` ends the conversation; the plan makes it the beginning.

## 2. The product: context plans

A **context plan** is a per-section analysis of one document under the existing frozen policy:

- Sections are **heading-bounded blocks from the document's own structure** — the author's ATX headings, the same boundaries `long_section`/`split_candidate` already reason about. v1 does **no boundary search/optimization**: every plan line is explainable as "your own section, measured." (Optimized split-point search is future work and would be a calibration-grade surface; out of scope here.) **The parser's existing `{ h, body }` section model is not sufficient for plans** — its bodies are re-rendered text, not source bytes. Plans require the source-range-preserving section model specified in §2.1, whose raw slices partition the document byte-for-byte.
- Each section is measured **as if it were a standalone document, under the unchanged frozen policy**: lossless convert → measured chars → same 5% band, same warning codes, same priority order. **A section "converts" iff it would earn `convert` as a document.** This is the central design move: *policy composition instead of new judgment* — context plans introduce **zero new tunable constants**.
- The plan's recommendation: convert the sections that independently clear the policy; keep everything else as Markdown; report **measured per-section deltas for every section — `keep` sections included** — and the **aggregate net delta including splice overhead** (kept headings, fence markers — stitching costs are counted, not hidden). A `keep` row without its measured (usually negative) delta would make the plan less auditable than the honesty page; the evidence rides on every row. The single exception is frontmatter, which is never measured (§2.1).
- **Hybrid output is recommended only when the aggregate net savings clears `MIN_CONVERT_SAVINGS_PCT`** — the same frozen 5% band, reused at plan level. Below the band, the plan's honest answer is "keep the whole document" even if one small table technically wins.
- **v1 plans are lossless-only.** Record-mode (semantic compression) stays a whole-document, explicit opt-in; mixing lossy sections into a "plan" muddies the one sentence the product must keep true.
- `safe_to_auto_apply` semantics:
  - The existing whole-doc field is **unchanged**.
  - Each plan section gets its own `safe_to_auto_apply` under the existing formula, applied to its standalone measurement.
  - Plan-level `safe_to_auto_apply` is **non-vacuous by definition**:
    `recommend_hybrid AND converted-section count > 0 AND every converted section individually safe AND reassembly verified`.
    Reassembly verified means: kept sections byte-identical in the hybrid, converted sections decode-verified as embedded, and the section slices re-stitch to the full document. A plan that converts nothing is never "safe to auto-apply" — there is nothing to apply.

### 2.1 Section model (v1, normative — source ranges are the contract)

The splitter operates on the raw source string. Rules:

- **Partition property (the invariant everything else hangs on):** section ranges `[char_start, char_end)` tile the document exactly — no gaps, no overlaps; concatenating every section's raw slice reproduces the source **byte-for-byte**. The implementation asserts this; the test suite re-proves it for every fixture.
- **Boundaries** are ATX heading lines (`#{1,6} `, the parser's own heading regex) **outside fenced code blocks**, using the parser's fence rules (` ``` `/`~~~` opens; a line starting with the same fence token closes) — a "heading" inside a fence is code, exactly as `parseMarkdown` treats it. Setext headings are not boundaries (the parser does not recognize them).
- **Heading inclusion:** a section's slice starts at the first character of its heading line and ends immediately before the first character of the next boundary heading line (or at end of file). The heading line and its terminating newline belong to the section.
- **Preamble:** content before the first heading is a section with `heading: null`, `kind: "preamble"`, measured like any other section. A document with no headings is one preamble section — the plan degenerates, honestly, to the whole-doc verdict.
- **Trailing newline handling:** the final section's slice runs to `source.length`, so the document's trailing newline (or its absence) lives inside the last slice and survives reassembly untouched. Kept slices are never trimmed, normalized, or re-terminated.
- **YAML frontmatter** (document starts with a `---` line closed by a later `---`/`...` line): its own section — `kind: "frontmatter"`, `heading: null`, action always `keep`, and **never measured** (`verdict: null`, `profile: null`, `measured_chars: null`). Running the markdown policy on YAML metadata is the documented profiler caveat; a null measurement on a labeled frontmatter section is honest, a garbage verdict is not. This is the plan-side half of §4.4; the profiler-side half remains a separate event (see §4).
- **Warning range offsetting:** warnings from a section's standalone measurement carry ranges relative to the slice; the plan offsets them to whole-document coordinates (`line += section line_start − 1`, `char += section char_start`) before emission. A plan consumer never sees slice-relative coordinates.
- **CRLF:** slices are raw — offsets and lengths count source characters as-is. Nothing re-encodes line endings (the corpus is LF-pinned; a CRLF document keeps CRLF in kept slices).

### Hybrid emission format

A Markdown document where converted sections become fenced ` ```toon ` blocks in place, everything else byte-identical. Agents already consume fenced blocks; the file remains one self-contained context document.

Normative rendering of a converted section (every kept section is its raw slice, untouched):

1. The section's **heading line (with its newline) stays as Markdown, byte-identical** — structure and navigation survive even where a TOON canonical would drop a title (the §4.1 caveat cannot reach a hybrid's headings).
2. The rest of the slice is replaced by a fenced block whose content is **exactly the TOON candidate that produced the section's `measured_chars`** — the numbers in the plan are the bytes in the artifact.
3. Fence length adapts: one backtick longer than the longest backtick run inside the TOON (minimum three), so embedded backticks cannot terminate the fence early.
4. The slice's trailing newline run is preserved after the closing fence, so inter-section spacing stays the author's own.

The fence markers and the kept heading are the splice overhead — counted, never hidden: `net.hybrid` is the exact character count of the assembled hybrid string.

## 3. Wire contract (additive, per the freeze rules)

New **optional** field on the verdict object — `context_plan` — an additive `schema_version: "1.1"` change (CHANGELOG + npm minor; consumers MUST ignore unknown fields, already normative).

**Emission contract (decided before code, QC P1):** only the plan surface emits 1.1. `doc2toon plan --json` (and a future `/v1/plan`) emits `schema_version: "1.1"` with `context_plan` present. Existing `profile`/`convert` output stays `schema_version: "1.0"`, byte-stable, field-for-field — no existing snapshot, CI pipeline, or API consumer sees any change. `schemas/verdict.v1.json` gains the optional field (instances of both versions validate); nothing "rides along" implicitly on other surfaces.

```jsonc
"context_plan": {
  "sections": [
    {
      "heading": "Configuration reference",        // null for preamble and frontmatter
      "kind": "section" | "preamble" | "frontmatter",
      "range": { "line_start": 120, "line_end": 184, "char_start": 4806, "char_end": 9612 },
      "profile": "table",                          // standalone profile; null only for frontmatter (never measured)
      "verdict": "convert",                        // standalone verdict under the unchanged policy; null only for frontmatter
      "action": "convert" | "keep",                // convert iff standalone verdict is convert AND the candidate decodes
      "measured_chars": { "source": n, "toon": n, "savings": n, "savings_pct": n }, // EVERY measured section, keep included; null only for frontmatter
      "warnings": [ /* coded, same registry, ranges offset to whole-document coordinates */ ],
      "safe_to_auto_apply": bool                   // section-level, existing formula on the standalone measurement
    }
  ],
  "net": { "source": n, "hybrid": n, "savings": n, "savings_pct": n },  // hybrid = exact chars of the assembled hybrid; splice overhead included
  "recommend_hybrid": bool,            // net clears the frozen 5% band AND at least one section converts
  "reassembly_verified": bool,         // kept bytes identical + converted decode-verified as embedded + slices re-stitch to the full document
  "safe_to_auto_apply": bool           // recommend_hybrid AND converted count > 0 AND all converted sections safe AND reassembly_verified
}
```

Sync obligations as always: `schemas/verdict.v1.json` + `openapi/cheapagent.v1.yaml` in lockstep (the deep-equality sync test), ajv validation of plan output against the schema, snapshots. Because only the plan surface emits the field, **existing profile/convert snapshots stay byte-identical**; the plan surface gets its own snapshots.

### Surfaces

- **CLI:** new `doc2toon plan [--json] [--out <hybrid.md>] <file>` subcommand (existing commands' output stays byte-stable; no flag soup on `profile`/`convert`). The verdict half of plan output is profile-shaped (`toon_candidate: null`); the hybrid document is the artifact, written only via `--out`. Exit-code contract identical to `profile`; `--fail-on` gains nothing new and keys on the whole-doc verdict — plans inform, the verdict gates.
- **Web:** plan table under the verdict card; "Copy plan" reuses the schema-field-named summary style; hybrid download. (`split_first` verdict card gains: "…and here's the plan.") Ships from the library's browser-safe `buildContextPlan`, not a re-derivation.
- **Action/MCP/serve:** gain plans by adding an explicit plan call when each surface schedules one (the Action comment may then append a one-line plan summary per file — codes and numbers only, as ever). Their existing verdict payloads do not change.

## 4. Supporting engine fixes (already-flagged, now sequenced with a reason)

1. **Table canonical title/caption retention** (the 91%-coverage caveat on config-reference): section plans make this urgent — table sections are precisely where plans win, and dropping captions inside a hybrid is not acceptable. **Scope decision (QC): not bundled with the plan implementation.** It is a canonical-shape change that moves published whole-doc numbers, which would break §5's "the only variable is the new capability" guarantee; it ships as its own measured minor. Plans mitigate structurally in the meantime: the hybrid keeps every converted section's Markdown heading line (the title half of the caveat cannot reach a hybrid), and per-section measurement shrinks the coverage denominator, so a caption that matters fires `low_coverage` at section level — verdict `review`, action `keep` — far sooner than the whole-doc check could. The residual exposure (small captions inside converting table sections) is the same bounded, disclosed v1 limitation the published honest convert already carries.
2. **Phantom-definitions heuristic fix**: section profiles must be accurate for per-section verdicts to be credible.
3. **`extractRules` mid-sentence splitting fix**: not needed for lossless-only v1 plans, but queued for any future record-mode story; keeping it on the list so it isn't lost.
4. **YAML frontmatter awareness**: two halves. The **plan-side half ships with plans** (§2.1): the splitter sections frontmatter as `kind: "frontmatter"`, always `keep`, never measured. The **profiler-side half** (the whole-doc profiler counting frontmatter lines as content/definitions — documented caveat in `fixtures/agent-context/external/results.json`) changes published whole-doc verdict inputs and stays a separate, documented event; it is what actually unblocks honest lane-2 (skill-pack) measurement.

## 5. The metric (pre-registered BEFORE implementation runs against the corpus)

**Actionable-plan rate:** the share of corpus documents whose context plan recommends a hybrid (`recommend_hybrid: true`, i.e., net savings ≥ the frozen 5% band with every converted section independently clearing the unchanged policy). Secondary: median net savings among plan-positive docs; count of plan-level `safe_to_auto_apply`.

- Re-run target: the **same pinned corpus** (internal 19 + external lane-1 19) — no re-pinning for this measurement, so the only variable is the new capability. External docs are pinned by the exact manifest SHAs. **The internal 19 are pinned too (QC):** the file list and per-file SHA-256 hashes are recorded as a dated amendment in `fixtures/agent-context/external/README.md`, so the measurement cannot silently include fixture drift; if a fixture must change before the measurement, that is a new dated pre-registration, not an edit.
- **The "one-third of docs" figure is a product hypothesis to test, not a number to hit.** If the measured rate is 3/19, we publish 3/19. Goodhart guard, explicitly: the metric definition above is frozen by this document *before* any plan code exists; it does not get massaged after results exist. Any later metric change is a new pre-registration.
- Honesty-page treatment when results exist: a third section *adding* the plan metric. The whole-doc numbers stay the headline of their sections; the plan section's headline is Kyle's line — finds the parts, refuses the rest.

## 6. Pre-registration checklist (must land before plan code measures the corpus)

- [x] This document merged (done by the commit that adds it).
- [x] Metric definition (§5) appended to `fixtures/agent-context/external/README.md` as a dated amendment.
- [x] Internal corpus pinned (file list + SHA-256 per file) in the same README amendment trail (QC, 2026-06-11).
- [x] Schema 1.1 draft (`context_plan`) reviewed against the freeze rules before implementation starts (QC review 2026-06-11: emission contract fixed to plan-surface-only 1.1; per-section evidence made mandatory for `keep` rows; plan-level safety made non-vacuous; source-range section model made normative in §2.1).

## 7. Complementary content move (independent of engineering)

**Table-shaped wild round:** the external corpus has zero `table`-profiled documents because we sourced by agent-doc filename — the win class lives in *other* files (rules references, API matrices, config tables; ruff's own rules docs are a giant uniform table). A round-3 lane targeting table-shaped public files — same gates, pins, frozen thresholds — is the honest way to show whole-doc converts in the wild, and it's a content-lane move that needs no engine work. Also zero-engine: a **manual plan teardown** (run a famous doc's sections through the existing CLI by hand) can ship as content *before* the feature exists — both a demand probe and the feature's announcement post.

## 8. Sequencing recommendation (decision: Kyle's)

The 30-day plan's critical path (Phase 4 MCP/serve → v0.4.0 by day 17; instrumentation hard deadline day 18; Phase 5 launch wave days 19–23, engineering-frozen; Phase 6 gate week) has no slack for a 2–4 day engine feature before day 30, and plans do not feed the day-30 gate's instrumentation.

- **Recommended:** design + pre-registration now (this doc); manual plan teardown during Phase 5 content week (zero engine work, validates demand); implementation as the **first post-gate engineering block (day 31+)**, shipping as Verdict 1.1 in v0.5.0. Works under either gate outcome: if the gate passes, plans are the hosted API's flagship capability; if it fails, plans are the strongest local/OSS value driver.
- **Outcome (2026-06-11, Kyle's call): implementation pulled forward, ahead of Phase 4.** The pre-registration trail was complete before measurement either way, and engineering was ~7 plan-days ahead of the calendar, so the slack existed. Plans ship as Verdict 1.1 in **v0.4.0** together with MCP/serve (one release train), not v0.5.0; the Phase 5 teardown can now use the shipped feature instead of a manual walkthrough.
- **Alternative (pull-forward):** trade MCP-or-serve scope in Phase 4 for plans. Not recommended: those artifacts feed the day-18 beat and the gate; plans don't.

## 9. Risks and guards

| Risk | Guard |
|---|---|
| Goodhart on the 1/3 hypothesis | Metric frozen in §5 before code exists; publish whatever falls out |
| Plans become a side-door re-derivation of judgment | Sections judged by the *unchanged* whole-doc policy; zero new constants; plan recommendation reuses the frozen band |
| Splice overhead hidden, net savings overstated | Overhead counted in `net`; reassembly verified for any `safe_to_auto_apply` |
| Boundary gaming (cherry-picked split points) | v1 boundaries = the author's own headings, deterministic; no search |
| Contract drift | Additive-only 1.1, emitted by the plan surface only; existing surfaces stay 1.0 byte-stable; sync tests enforce schema/OpenAPI lockstep |
| Frontmatter mangling inside hybrids | Plan-side §4.4 ships inside the splitter: frontmatter sections always `keep`, never measured |
| Vacuously "safe" empty plans | Plan-level `safe_to_auto_apply` requires at least one converted section by definition |
| Hybrid bytes diverge from plan numbers | The fence content is the exact measured candidate; `net.hybrid` counts the assembled string; reassembly verification is mechanical, not asserted |

## 10. Definition of done (implementation phase, when scheduled)

- `doc2toon plan --json` emits Verdict 1.1 with `context_plan`; `profile`/`convert` output stays `schema_version: "1.0"` byte-for-byte (existing snapshots prove it); ajv + OpenAPI sync green; new plan snapshots reviewed.
- Reassembly property test: for every fixture, section slices partition the source byte-for-byte; kept-section bytes identical in the hybrid; converted sections decode-verified as embedded; a zero-convert plan's hybrid equals the source exactly.
- Pinned-corpus re-run produces the §5 metric; results stored in the external results format (bodies never stored); honesty page gains the plan section.
- Web renders the plan under the verdict card with Copy-plan; no regression on the existing verdict UI contract (`llms.txt` ids stable, additive only).
- A real teardown published using the shipped feature on one famous doc from the corpus.
