# External corpus — real-world documents (intake contract)

**Status:** awaiting documents (being sourced from public repos; see manifest below — currently empty).
**Slated for:** 0.3.1 (additive: corpus + snapshots + docs only; no engine or contract changes).

This directory extends the honesty benchmark with documents we did **not** write. The
in-house corpus (one directory up) is original content describing fictional projects —
realistic, but authored by the team that built the verdict policy. Third-party documents
remove that objection. This README is the methodology, written down **before** the
documents were selected or measured, so results cannot quietly shape the rules.

## Pre-registered methodology

1. **Verbatim intake.** Files are committed exactly as retrieved, with one disclosed
   exception: `.gitattributes` pins `fixtures/**` to LF, so CRLF sources are normalized
   on commit. Line endings are measurement-relevant (the same document measured −1.5%
   at LF and +0.4% at CRLF), so the manifest records each file's original EOL. No other
   edits — no trimming, no anonymizing, no cleanup.
2. **Verdicts fall where they fall.** Every `.md` file in this directory is picked up
   automatically by `scripts/benchmark-honesty.mjs` and by the per-fixture snapshot +
   schema-validation suite (both glob `fixtures/` recursively). Results are published
   regardless of whether they help the thesis. If TOON wins more often on external
   docs than on ours, that is the finding; if it loses everywhere, that is the finding.
3. **No threshold tuning against this corpus on intake.** Decision-policy constants were
   calibrated on the in-house corpus (`docs/calibration-v1.md`). The external run is an
   out-of-sample test. Any constant change it motivates is a separate, documented
   calibration event under the freeze rules (minor-version-tunable constants) — never
   bundled into the intake commit.
4. **License before commit.** A document enters only if its license permits
   redistribution (or it carries an explicit permissive grant). Verify first, commit
   second. No exceptions for "it's just a config file."

## Per-file manifest (append one row per document, at intake)

| File | Source repo | Commit SHA | Path in source | License | Retrieved | Original EOL |
|---|---|---|---|---|---|---|
| _none yet_ | | | | | | |

## Intake checklist (run when documents arrive)

- [ ] License verified per file; manifest row added with source URL + commit SHA.
- [ ] `npm run build && node scripts/benchmark-honesty.mjs` — record the new table.
- [ ] `npm test` — new per-fixture snapshots are written on first run; review them
      (they are the receipt), commit them with the docs.
- [ ] Compare external verdict distribution against the in-house corpus; write the
      delta into the benchmark summary and `docs/calibration-v1.md` as an
      out-of-sample note (no constant changes in the same commit — see rule 3).
- [ ] Update the published numbers that quote the corpus size: the honesty page on
      cheapagent.ai ("19 documents" becomes 19 + N) and the README, citing both the
      in-house and external counts separately.
- [ ] Release as 0.3.1 (rehearse-then-tag discipline; additive only).
