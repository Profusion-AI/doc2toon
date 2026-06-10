---
name: quarterly-board-report
description: Build the quarterly financial board pack for Pinebarrow Instruments from Fernbook CSV exports. Trigger on requests like "board pack", "FY26-Q3 board report", "quarterly financials deck", or a finance-ops handoff ticket tagged board-pack.
allowed-tools: Bash, Read, Write, Grep
owner: finance-ops
revision: 7
last-reviewed: 2026-05-18
---

# Quarterly financial board report

This skill turns raw Fernbook CSV exports for one fiscal quarter into the
board-ready financial pack: a Markdown report, a slide outline, and a
reconciliation appendix. It encodes the finance team's closing conventions so
the figures in the pack match what the controller signs.

The pack goes straight to the board of directors. Mistakes here cost trust,
not just rework, so treat the gates in Stage 4 as blocking rather than advisory.

## When to use this skill

- The user asks for a quarterly board report, board pack, or board deck for a named fiscal quarter.
- A `handoff/board-pack-<quarter>.md` ticket landed in the finance-ops repo and names you as the builder.
- The controller requests a restated pack after signing a prior-quarter correction memo.
- A draft pack already exists but `qbr gate` reports failures the user wants cleared.
- Phrases worth triggering on — "board pack", "quarterly board report", "Q3 deck", "board financials", "pack for the board meeting".

## When NOT to use this skill

- Monthly flash updates come from the separate `monthly-flash` skill; its rounding and layout conventions differ enough that this template misleads.
- Ad-hoc investor questions about a single metric: answer those directly from Fernbook, a full pack is overkill.
- External audit requests go through the audit liaison, never through this pipeline.
- Anything touching statutory filings; those have their own counsel-reviewed process owned by the controller's office.

## Inputs

### Required CSV exports

Pull these with `qbr fetch --quarter <FY-Qn>`; the command drops them into
`work/<quarter>/raw/` and writes `fetch.log` beside them.

- `revenue.csv` — one row per invoice line, recognized revenue only, amounts in minor units.
- `opex.csv` — operating spend by cost center and fiscal month.
- `headcount.csv` — month-end headcount snapshot per department, contractors flagged.
- `cash.csv` — daily closing balances for every operating account.

A fifth export, `deferred.csv`, appears only for quarters with multi-year
contracts on the books. Its absence is normal; `qbr reconcile` notes whether
it was expected given the revenue mix.

### Schema expectations

- Every export carries a `fiscal_quarter` column whose value equals the quarter under construction.
- Amounts are integers in minor units with an explicit `currency` column; bare floats mean a broken Fernbook view, stop and re-export.
- `headcount.csv` uses ISO dates in `snapshot_date`; anything else is a localization bug in the export job, not your data.
- Column order is not guaranteed between Fernbook releases. Address columns by header name, not by position.

### Optional context inputs

- `guidance/<quarter>.md` — the CFO guidance memo; it shapes commentary tone but not the numbers.
- The prior quarter's shipped pack under `shipped/<prior>/pack.md`, read by `qbr diff` for sanity bands.
- `corrections/<quarter>/memo.md` — present only on restated quarters; see the Restatements section.

### Fiscal calendar

Pinebarrow's fiscal year starts on the first Monday of February, so fiscal
quarters and calendar quarters disagree by roughly five weeks. The exports
arrive already cut on fiscal boundaries; resist any urge to re-bucket by
calendar month. `headcount.csv` is the one exception — its snapshots are
calendar month-ends because the HR system has no fiscal concept — and
`qbr draft` maps them using `templates/board-pack/calendar-map.yaml`.

### Currency handling

All four exports arrive in ledger currency; subsidiaries are translated
upstream inside Fernbook. The pack never shows source currencies. A quarter
that crosses an FX revaluation date picks up a reconciliation bucket for the
revaluation delta — that bucket is the single most common Stage 2 question,
and the answer lives with the FX desk, not in this skill.

### Headcount conventions

- Contractors land in the contractor line, not in department headcount; the board asked for that split back in FY24.
- Backfills in flight count as open roles, not as filled headcount.
- The headcount plan on the outlook page comes from the CFO office, like every other forward-looking figure.

## Data quality screens

Run these before trusting any export, even when `fetch.log` looks healthy:

- Duplicate invoice ids in `revenue.csv` — Fernbook emits them when a contract amendment lands mid-sync. `qbr reconcile` catches the total, but the row-level duplicate is easier to explain at this stage.
- Cost centers in `opex.csv` that joined this quarter — a new center wants a mapping row in `templates/board-pack/cost-center-names.yaml`, or the tables render raw codes.
- Gaps in `cash.csv` — weekend gaps are normal; weekday gaps mean a feed outage and an asterisk in the appendix.
- A `currency` column with more than one distinct value — that is an upstream translation bug, and the quarter does not build until Fernbook support clears it.

## Output contract

### Files produced

Everything lands in `work/<quarter>/out/`:

- `pack.md` — the full board report: headline page, revenue, opex, cash, headcount, outlook.
- `slides.outline.md` — one block per slide, consumed by the deck team's renderer.
- `appendix-reconciliation.md` — every adjustment between raw exports and reported figures, with journal references.
- `manifest.json` — SHA-256 of each output plus the Fernbook sync timestamp.

### Formatting conventions

- Currency figures appear in thousands of ledger currency, rounded half away from zero.
- Percentages carry one decimal place; growth deltas keep their sign even when positive.
- Quarters are written `FY26-Q3`, never `Q3 2026`; the fiscal calendar drives the label.
- Negative amounts take parentheses in tables and a minus sign in running text.
- Footnote markers are letters rather than numbers, so they survive the deck renderer.

### Slide outline conventions

- One `## Slide:` block per slide; the deck team's renderer splits on that marker.
- Ten slides for a normal quarter: headline, revenue, revenue drivers, opex, opex variances, cash, runway, headcount, outlook, appendix pointer.
- Tables in the outline carry at most six columns; the renderer truncates wider ones silently.
- Speaker text goes under a `notes:` line inside each block and stays out of the rendered deck.

### Working directory layout

```
work/FY26-Q3/
  raw/                   four (or five) Fernbook exports
  fetch.log              row counts and the sync timestamp
  PROVENANCE.md          ticket link, sync timestamp, template revision
  reconcile-clear.txt    cleared summary from Stage 2
  out/
    pack.md
    slides.outline.md
    appendix-reconciliation.md
    manifest.json
```

### Provenance file

`PROVENANCE.md` is plain text, append-only during a build, and the first
thing the controller opens during sign-off:

```
# Provenance — FY26-Q3
ticket: finance-ops/handoff/board-pack-FY26-Q3.md
fernbook-sync: 2026-05-02T04:11:09Z
template-revision: board-pack@9c41f72
restatement: no
approved-as-of: 7d1c9aa0 (controller, 2026-05-09)
```

### Manifest shape

`qbr ship` writes `manifest.json`; nothing else touches it.

```json
{
  "quarter": "FY26-Q3",
  "fernbook_sync": "2026-05-02T04:11:09Z",
  "template_revision": "board-pack@9c41f72",
  "files": {
    "pack.md": "sha256:b1946ac9...",
    "slides.outline.md": "sha256:5d41402a...",
    "appendix-reconciliation.md": "sha256:aaf4c61d..."
  },
  "restates": null
}
```

## Build workflow

Stages run in order. Each stage ends with a written artifact, so a crashed or
interrupted session resumes by reading `work/<quarter>/` instead of redoing
the whole pipeline.

### Stage 1 — Intake

1. Read the handoff ticket; note the quarter, the restatement flag, and any guidance deltas called out by the CFO office.
2. Create `work/<quarter>/` and start `PROVENANCE.md` with the ticket link and today's date.
3. Fetch exports: `qbr fetch --quarter FY26-Q3 --out work/FY26-Q3/raw`.
4. Compare row counts in `fetch.log` against the ranges printed in the ticket; an order-of-magnitude gap usually means a half-synced Fernbook view.
5. Append the Fernbook sync timestamp from `fetch.log` to `PROVENANCE.md`.

### Stage 2 — Reconcile

1. Run `qbr reconcile work/<quarter>/raw` and read the printed summary.
2. Every line in the "unexplained" bucket needs either a journal reference or an escalation; nothing ships with an unexplained delta.
3. Known recurring items (FX revaluation, the Brightwell sublease offset) live in `reconcile-known.yaml`; add a new recurring item there with a one-line justification.
4. Save the cleared summary to `work/<quarter>/reconcile-clear.txt`. Stage 3 refuses to start without it.

### Stage 3 — Draft

1. Render the draft: `qbr draft work/<quarter>`. Templates live in `templates/board-pack/` on the finance repo, pinned by the ticket.
2. Write the commentary by hand: headline narrative, revenue drivers, opex variances, cash runway, headcount plan. Source every figure you cite from the rendered tables, not from the raw CSVs.
3. Match the guidance memo's tone on the outlook page; the figures there come from the CFO office and arrive pre-approved in the ticket.
4. Run `qbr diff work/<quarter> --against <prior>` and explain in the appendix any headline figure that moved beyond its sanity band.

### Stage 4 — Gate

Run `qbr gate work/<quarter>` and clear every failure before sign-off. The
gates, in the order they execute:

1. Cross-foot — section totals re-add from their own rows within one rounding unit.
2. Tie-out — headline revenue, opex, and closing cash equal the reconciled figures from Stage 2.
3. Sanity bands — quarter-over-quarter deltas beyond `bands.yaml` carry an appendix note.
4. Provenance — `PROVENANCE.md` lists ticket, sync timestamp, and template revision.
5. Phrasing — the pack steers clear of the banned-phrase list in `style/banned.txt`, mostly forward-looking promises the lawyers dislike.

### Stage 5 — Ship

1. Open the sign-off issue with `qbr ship work/<quarter>`; it hashes the outputs, writes `manifest.json`, and assigns the controller.
2. The controller replies `approved-as-of <sha>` on the issue; paste that line into `PROVENANCE.md`.
3. Move the directory to `shipped/<quarter>/` only once the approval line lands. Repeat runs of `qbr ship` refuse to overwrite a shipped quarter without `--restated`.
4. Hand the slide outline to the deck team in #board-prep; they own visual design, you own the figures.

## Writing the commentary

Tone targets the board, not the finance team: plain sentences, one idea per
paragraph, numbers carried by the tables rather than by the prose.

- Lead each section with the single sentence a board member would quote later.
- Name drivers concretely — "two enterprise renewals slipped to Q4", not "timing effects".
- Quantify every driver you name; an unquantified driver reads as a guess.
- Past quarters get past tense; the outlook page alone speaks about the future.
- Acronyms expand on first mention, even the ones the finance team considers obvious.
- The runway paragraph states the month count and the assumption set behind it, both taken from the rendered cash table.

## Command reference

| Command | Purpose | Behavior to know |
| --- | --- | --- |
| `qbr fetch --quarter <q>` | Pulls the four standard exports from Fernbook | Idempotent; overwrites `raw/` |
| `qbr reconcile <dir>` | Cross-foots exports against the trial balance | Exit 2 on unexplained deltas |
| `qbr draft <dir>` | Renders `pack.md` and `slides.outline.md` from templates | Reads `PROVENANCE.md` for the header block |
| `qbr diff <dir> --against <q>` | Compares headline figures with a prior quarter | Prints sanity-band breaches |
| `qbr gate <dir>` | Replays the Stage 4 gates non-interactively | Exit code feeds the finance repo CI |
| `qbr ship <dir>` | Hashes outputs, writes the manifest, opens sign-off | Re-ship of a shipped quarter wants `--restated` |
| `qbr restate <dir> --prior <q>` | Re-opens a shipped quarter with correction entries | Prompts for the correction memo path |
| `qbr bands --edit` | Opens `bands.yaml` with the current sanity bands | Edits ride normal code review, in a separate change |

## Sanity bands

`bands.yaml` holds one entry per headline figure: a relative band for normal
quarters plus an absolute floor so tiny denominators stop screaming.

```yaml
revenue:    { relative: 0.12, floor_minor_units: 250000000 }
opex:       { relative: 0.08, floor_minor_units: 90000000 }
cash_close: { relative: 0.15, floor_minor_units: 400000000 }
headcount:  { relative: 0.06, floor_minor_units: 0 }
```

Breaches are not failures; a breach plus a missing appendix note is the
failure. The bands started as FY23 gut feel and get re-fit every February
from the trailing eight quarters.

## Error handling

| Symptom | Likely cause | Recovery |
| --- | --- | --- |
| `qbr fetch` exits 3 | Fernbook session token expired | Re-auth with `fernbook login`, fetch again |
| Row counts far below ticket ranges | Half-synced Fernbook view | Wait for the sync banner inside Fernbook, re-export |
| `reconcile` exit 2, FX bucket | Quarter crossed a revaluation date | Add the journal reference from the FX desk to `reconcile-known.yaml` |
| `reconcile` exit 2, unknown bucket | Genuine unexplained delta | Escalate in #fin-close with the delta table; drafting waits for a journal reference |
| `draft` rejects the template pin | Ticket pins an older template revision | Pull that revision from the finance repo, point `--templates` at it |
| `gate` phrasing failure | Banned phrase in commentary | Reword the sentence; the banned list itself changes only via legal |
| `ship` declines to run | Quarter already shipped | This is a restatement: switch to `qbr restate` |
| Deck team reports broken tables | Footnote markers collided with the renderer | Letters for footnotes; regenerate the outline |
| Numbers differ from the controller's spot total | Stale `raw/` from an earlier fetch | Re-fetch, re-run Stage 2; the sync timestamps in `PROVENANCE.md` will disagree, which is the tell |

## Restatements

A restatement re-opens a shipped quarter because the controller signed a
correction memo. They are rare — two in the last three fiscal years — and the
mechanics differ from a normal build:

- `qbr restate` clones the shipped pack into a new `-r1` working directory; the original stays untouched.
- The pack title gains "(restated)" plus the memo date, and the headline page leads with a one-paragraph correction summary.
- Sanity bands compare against the original pack rather than the prior quarter, so expect `qbr diff` noise; explain it once in the appendix.
- Both the original and the restated pack live under `shipped/` permanently; the manifest of each names the other.

## Examples

### Standard quarter

```
$ qbr fetch --quarter FY26-Q3 --out work/FY26-Q3/raw
fetched revenue.csv (18,204 rows) opex.csv (3,977 rows) headcount.csv (612 rows) cash.csv (8,281 rows)
sync timestamp: 2026-05-02T04:11:09Z
$ qbr reconcile work/FY26-Q3/raw
cleared: 14 buckets   known: 2   unexplained: 0
$ qbr draft work/FY26-Q3
wrote pack.md slides.outline.md appendix-reconciliation.md
$ qbr gate work/FY26-Q3
5/5 gates green
```

The clean path: four commands, hand-written commentary in between Stage 2 and
Stage 4, then `qbr ship` once the narrative reads well aloud. Most quarters
look like this one.

### Restated quarter

The FY26-Q2 pack shipped with a revenue line that double-counted a contract
amendment; the controller signed `corrections/FY26-Q2/memo.md` three weeks
later.

```
$ qbr restate shipped/FY26-Q2 --prior FY26-Q1
correction memo: corrections/FY26-Q2/memo.md
re-opened as work/FY26-Q2-r1/
$ qbr gate work/FY26-Q2-r1
5/5 gates green (restated)
```

The restated pack went out with the memo summary up top and the original left
in place under `shipped/FY26-Q2/`, exactly as the Restatements section
describes.

## Anti-patterns from past quarters

Real failures from FY24 through FY26 retros, kept here so the next builder
skips them:

- Pasting figures from the prior pack to save time. The prior quarter had a restated revenue line; the new pack inherited the stale number and the gate suite had no way to notice.
- Re-bucketing opex by calendar month because the chart looked smoother. The board compares against guidance, and guidance is fiscal.
- Editing `bands.yaml` mid-build to silence a diff breach. Bands change through code review in a separate change, with the controller on it.
- Writing outlook commentary from memory of the guidance call instead of the memo text. The memo is the record; the call is not.
- Shipping at 23:40 the night before the board meeting with one gate amber. The amber gate was the tie-out gate. There is a reason it blocks.

## Escalation

- Unexplained reconciliation deltas — #fin-close, tag the assistant controller.
- Template or renderer breakage — #board-prep.
- Anything touching the correction memo's accounting treatment — the controller directly, not a channel.
- Deadline pressure does not change the gates; escalate the deadline itself in the handoff ticket thread.

## Hard limits

- Never send any part of a draft pack outside #fin-close and #board-prep.
- Figures come from the exports and the reconciliation, never from memory and never from prior packs.
- No forward-looking revenue commitments in the commentary; the outlook text arrives from the CFO office verbatim.
- A failed gate blocks shipping; there is no override flag, by design.
- Restatements keep the original shipped pack intact; corrections add files, they do not replace them.

## Questions that keep coming up

Why thousands rather than full units? The board reads printed packs; six-digit noise hides the signal, and the appendix carries full precision for anyone who wants it.

Can the deck team adjust figures for layout? No — they own visuals only. A figure that does not fit gets a layout change, and the request comes back through #board-prep.

Where do exchange rates come from? Fernbook translates upstream; the pack never touches rates directly. Rate questions go to the FX desk.

Does a board member's direct request override the gates? It has not happened yet. The escalation path is the controller, who can re-scope the ticket; the gates themselves stay.

What about the first quarter that includes an acquisition? Expect a temporary `deferred.csv`, wider sanity-band noise, and a guidance memo that doubles in length. Budget an extra day.

## Maintenance

Templates, bands, and the banned-phrase list live in the finance repo under
`board-pack/`. This SKILL.md rides with them; the `revision` field in the
frontmatter increments on any change to the stage order or the gates.
Questions about the skill itself go to finance-ops. The deck renderer belongs
to #board-prep, and its quirks are theirs to fix — report them, then route
around with the outline conventions above.
