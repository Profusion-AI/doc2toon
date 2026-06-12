# External corpus — real-world documents (intake contract)

**Status:** sources pinned 2026-06-11 (`manifest.json`); measured via `scripts/benchmark-external.mjs`; results in `results.json`.
**Scope:** repo-side benchmark infrastructure — nothing here ships in the npm tarball or changes the engine.

This corpus extends the honesty benchmark with documents we did **not** write. The in-house
corpus (one directory up) is original content describing fictional projects — realistic, but
authored by the team that built the verdict policy. Third-party documents remove that
objection. The methodology below was written down **before** the documents were measured, so
results cannot quietly shape the rules.

## Amendment 2026-06-11 — measurements, not copies

The original intake contract (committed earlier the same day, before any documents were
selected) assumed third-party files would be vendored verbatim into this directory. That is
**amended before any measurement**: the corpus stores **provenance and measurements only** —
source URL, pinned commit SHA, license note, char counts, verdict JSON (with `toon_candidate`
stripped), and the result table. Bodies and derived TOON bodies are never committed. The
posture: *we analyzed publicly licensed files, attribute the source, pin the commit, and
publish measurements — not copied content.*

Consequences of the amendment:

- Reproduction is via `node scripts/benchmark-external.mjs`, which re-fetches each file at
  its **pinned SHA** (immutable content) and re-measures. Same pins, same bytes, same numbers.
- The in-house benchmark and snapshot suites glob `fixtures/` for `.md` files; since no
  third-party `.md` ever lands here, the in-house corpus stays exactly 19 and its snapshots
  are untouched. The external run is a separate, out-of-sample report.
- The EOL trap is avoided by construction: files are measured as fetched (the blob bytes at
  the pin), never checked out through git smudge. The original EOL is recorded per file.

## Amendment 2026-06-11 (round 2, locked before probing) — lanes and a file-centric gate

Round 2 expands the corpus. Two methodology changes, locked **before** any round-2 source
was probed or measured:

- **Three lanes.** Lane 1, *embedded repo docs*: agent docs maintained inside production
  repos — the only lane that feeds the public honesty-page denominator. Lane 2, *skill
  packs*: curated `SKILL.md` ecosystems (packaged, productized — a different population);
  measured and reported separately, never merged into the lane-1 denominator, and lane-2
  numbers are not published until the engine's handling of YAML frontmatter is inspected
  and documented (skill files carry frontmatter; the in-house corpus largely does not).
  Lane 3, *pointer/control*: pointer-only and symlinked agent files, recorded as evidence
  of how repos route agent context, never counted as documents.
- **The activity gate is file-centric for lane 1** (target file's last commit on or after
  2026-04-01): lane 1 exists to test *living* operational documents, not archival ones.
  Lane 2 uses repo-level activity (skill packs version as a unit). Round 1 was gated
  "repo or file" — its sources pass the stricter reading too (browser-use CLAUDE.md, the
  one round-1 file older than the cutoff, rode in with two passing siblings and stays for
  continuity, disclosed here).
- Dual MIT/Apache-2.0 licensing passes the gate via the MIT option (uv set the precedent
  in round 1).

## Pre-registered methodology (unchanged by the amendments)

1. **Gates** (recorded per source in `manifest.json`): 100+ stars; MIT license or explicit
   MIT for non-enterprise content with the target file outside any carveout subtree —
   verified against the LICENSE file at the pin, not just the repo's SPDX tag; activity
   per the lane rules above; target file is an agent-context document
   (`AGENTS.md`, `CLAUDE.md`, `SKILL.md`, or nested skill files).
2. **Pin before measuring.** Every source is pinned to an exact commit SHA in the manifest
   before any result is produced.
3. **Pointer files are not documents.** A file that only delegates (e.g. `CLAUDE.md`
   containing `@AGENTS.md`) is recorded as evidence of real agent-file linking behavior but
   never counted in the benchmark denominator. Goosing the denominator with tiny pointer
   files teaches nothing.
4. **Public-surface measurement.** Each document runs through the published CLI surface —
   `doc2toon profile --json` and `doc2toon convert --json` (defaults; lossless mode) — and
   the run records verdict, profile, `safe_to_auto_apply`, measured chars, token estimates,
   warning codes, flags, and whether TOON was emitted. The profile/convert verdict match is
   asserted per document (one policy, decision 9).
5. **Verdicts fall where they fall.** Results are published regardless of whether they help
   the thesis. Mostly `keep_markdown`/`split_first`/`review` on real files is the product
   doing its job in the wild, not a failure.
6. **No threshold tuning on intake.** Decision-policy constants were calibrated on the
   in-house corpus (`docs/calibration-v1.md`); this run is an out-of-sample test. Any
   constant change it motivates is a separate, documented calibration event under the freeze
   rules — never bundled with intake or results commits.
7. **Publishing rule.** The honesty page and other public surfaces present aggregate
   measurements, per-document numbers with attribution, and at most short excerpts — never
   whole third-party documents. The external section *adds to* the in-house "1 of 19"
   result; it does not replace it.

## Amendment 2026-06-11 (pre-registered metric: actionable-plan rate)

Locked before any context-plan code exists (design: `docs/context-plan-design.md`). When
section-level context plans ship, the **same pinned corpus** (internal 19 + external lane-1
19, these exact manifest SHAs, no re-pinning) is re-measured for one new metric:

- **Actionable-plan rate** — the share of documents whose plan recommends a hybrid:
  net savings (splice overhead included) ≥ the frozen `MIN_CONVERT_SAVINGS_PCT`, with every
  converted section independently earning `convert` under the unchanged whole-document
  policy. Secondary: median net savings among plan-positive docs; plan-level
  `safe_to_auto_apply` count.
- The whole-document denominators published on the honesty page are not restated, replaced,
  or affected. The "one-third of documents" figure discussed in planning is a hypothesis to
  test, not a number to hit: whatever rate falls out is the published rate.
- This metric definition does not change after results exist; any revision is a new dated
  pre-registration.

**Measured 2026-06-11** (plans implemented; runner `scripts/benchmark-plans.mjs`, results in
`plan-results.json`, internal pins verified before measuring): **internal 1/19, external
lane-1 1/19, combined 2/38 plan-positive.** The "one-third of documents" planning hypothesis
is refuted; 1/19 is the published external rate. The external plan-positive document is
`langchain-ai/langchainjs:AGENTS.md` — whole-doc `keep_markdown`, plan net **+6.8%** with two
table sections converting independently (+49.5%, +52.0%), plan-level `safe_to_auto_apply`
true — the first real-world document in the corpus where the tool has a positive, auto-
applicable recommendation. 7 of 38 docs have at least one converting section; the other five
net 0.2–0.9%, below the frozen band, and the plan's honest answer for them stays "keep the
whole document". Reassembly verified on all 38. The whole-document honesty denominators
above are unchanged by any of this.

## Amendment 2026-06-11 (internal corpus pinned for the actionable-plan-rate measurement)

The actionable-plan-rate amendment above pins the external lane-1 docs by manifest SHA but
left the internal 19 pinned only implicitly ("the repo files"). Locked here, still before any
plan code exists: the internal corpus for that measurement is **these 19 files at these exact
content hashes** (SHA-256 of the committed LF bytes, as of commit `1bfa494`; the corpus is
LF-pinned by `.gitattributes`, so a working-tree hash on any platform matches
`git show <commit>:<path>`). If a fixture must change before the measurement runs, that is a
new dated amendment with new hashes — never a silent edit.

| File | SHA-256 |
| --- | --- |
| `examples/definitions.md` | `8c22723b0a4a10d18da9377d80aa5aa98f7f3aca47f2d65d7029f6ba61527866` |
| `examples/prose.md` | `90fee577b01783081285d3fe9f0f5e64f180e17a9267186465dcf089e8979265` |
| `examples/requirements.md` | `831b28c4f16519fb7710846b1bfca6b37bb4faaa892f53fd3e12d4991f92923f` |
| `examples/table.md` | `3175c2e2d96ef63898ba150d58214f296edd99f1da23f5ecd77a4c43422d4a8f` |
| `fixtures/agent-context/AGENTS.md` | `ad324457121b6a92546d4c55f48174f9637dcc4396fb8f53d8e95a7596bcae4a` |
| `fixtures/agent-context/CLAUDE.md` | `21306dc2b6ed97fcdf7c9abe8e08552961dbff2866bf9ce61cfe9a8b9a3b8892` |
| `fixtures/agent-context/SKILL.md` | `bf9a76e64385dcf2e2bb9b85d62064e9a132da388db6434ed046d93496095363` |
| `fixtures/agent-context/problematic/duplicate-rules.md` | `9ded6dd2e26e18bee44c48ce8821cb34804173ab21ba978d8594c9a6e92db3df` |
| `fixtures/agent-context/problematic/long-section.md` | `39d6023847ffb26ec4f25bce9439338ee9e95d47e3268b69982063a16e4372b6` |
| `fixtures/agent-context/problematic/mixed-agent-context.md` | `47ae87542206d1877fdb2d8cf11208ae3e943e742a7fdadafaf634af12b125a4` |
| `fixtures/agent-context/problematic/split-candidate.md` | `cf28f81a593a1beb4df550ab3e8c0d063ce8e2e42eb7c085fc0d8c53958c4c88` |
| `fixtures/agent-context/problematic/vague-rules.md` | `2a14655f0cdc58387e1f45f328b7cbd258cc52c778eedce1d32af877244f6a7e` |
| `fixtures/agent-context/realistic/AGENTS.md` | `6d9209347511ecf2ede02ca31a0e7d1c60504e716df0da814f761cb6ab11e76d` |
| `fixtures/agent-context/realistic/CLAUDE.md` | `577f06aba0a9dd71822f603f30594f1ee8b11508dfcb641a35485cbc8168d770` |
| `fixtures/agent-context/realistic/SKILL.md` | `9d409a5d444acaeb9430b72d34c78adab1ef08dedeb3a4977d19661d20893745` |
| `fixtures/agent-context/realistic/architecture-rfc.md` | `3bddb9aa4f7882eaee9fa5d45bdbcb198f4de6421bf4307a5fd1e1617834c144` |
| `fixtures/agent-context/realistic/config-reference.md` | `6de7e588c7361abbb9e47fade0fdcd42e33e0db2bee735766856f124daaa35f2` |
| `fixtures/glossary.md` | `82488a23500c7e99c3b688589d1eebd9eb2d6d61780063b23282f9c75efb615d` |
| `fixtures/sample.md` | `ae765b7db2af17cfd9d1a26eccb3f464796f36d00d1c18abfc31f6dab8564796` |

## Watchlist (not canonical)

Technically tempting sources outside the MIT gate are listed in `manifest.json` under
`watchlist_not_canonical` (Apache-2.0 and community-licensed files). They enter only if the
licensing gate is explicitly relaxed — a documented decision, not a drive-by.

## Re-running / extending

- Re-run: `npm run build && node scripts/benchmark-external.mjs` (results are deterministic
  at the pins; `generated` timestamp and `retrieved` dates will differ).
- Re-pin to newer upstream commits: update `manifest.json` SHAs (gate-check again), re-run,
  and commit manifest + results together so numbers and pins never skew.
- Add a source: gate-check it, add a manifest entry with pin + license note, re-run, update
  the published counts (in-house and external cited separately).
