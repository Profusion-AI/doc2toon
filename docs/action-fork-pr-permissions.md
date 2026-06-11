# Spike — fork-PR permissions for the context-check Action

**Status:** decided (design outcome below is binding for `action.yml`)
**Date:** 2026-06-11 (plan day 9)
**Question:** the Action's headline feature is a PR comment, but `pull_request` events from
forks get a read-only `GITHUB_TOKEN` — comment writes fail exactly when an OSS adopter's
contributors hit the Action. What does the Action do about it?

## Verified platform behavior

Verified against GitHub's documentation on 2026-06-11 (quotes below); the fork-empirical
checklist at the bottom re-confirms each row on a real fork PR during day-11/12 dogfooding.

| Channel | Fork PR (`pull_request`) | Why |
|---|---|---|
| Exit code / job status | ✅ works | runner-local, no token |
| `$GITHUB_STEP_SUMMARY` | ✅ works | runner-side file write, no token |
| `::warning`/`::error` annotations | ✅ works | runner workflow commands, no token (10/type/step cap) |
| Artifact upload | ✅ works | uses the runtime token, not `GITHUB_TOKEN` (this is why the `workflow_run` pattern passes data via artifacts) |
| PR comment (issues API) | ❌ 403 | `GITHUB_TOKEN` is read-only on fork PRs |
| Secrets | ❌ absent | not passed to fork-triggered runs |

The two governing statements, from *Events that trigger workflows*:

> "With the exception of `GITHUB_TOKEN`, secrets are not passed to the runner when a workflow
> is triggered from a forked repository. The `GITHUB_TOKEN` has read-only permissions in pull
> requests from forked repositories."

And on `pull_request_target`, which runs with a write token in the base-repo context:

> "Running untrusted code on the `pull_request_target` trigger may lead to security
> vulnerabilities. These vulnerabilities include cache poisoning and granting unintended
> access to write privileges or secrets." — with the explicit instruction to *avoid using
> this event if you need to build or run code from the pull request*.

The Action profiles doc files **from the PR head** — it runs code/content from the PR. That is
exactly the forbidden combination, which closes the `pull_request_target` question permanently
(see Rejected alternatives).

Note the comment can fail on **same-repo** PRs too: if the repo's default workflow permissions
are set to read-only and the consumer's workflow omits `permissions: pull-requests: write`, the
comment 403s with no fork involved. So "am I a fork?" detection alone is not sufficient — the
comment step must tolerate 403 unconditionally.

## Design outcome (binding for `action.yml`)

1. **Trigger is `pull_request`. Never `pull_request_target`, never a default you can flip.**
   The recipe and docs state the caveat honestly: with `pull_request_target` the comment would
   work on fork PRs, and we still won't do it, because the Action checks out and processes PR
   content. There is no input to enable it.

2. **No secret-dependent path exists.** The Action needs zero secrets by construction:
   `npx doc2toon@^0.3` installs from public npm; `GITHUB_TOKEN` is used opportunistically for
   the comment only. A fork PR therefore loses *nothing except the comment*.

3. **The verdict gate is the product; the comment is progressive enhancement.** Load-bearing
   output rides only the channels that work everywhere:
   - **exit code** per `--fail-on` (the actual CI gate),
   - **`$GITHUB_STEP_SUMMARY`** — full per-file verdict table, always written, same content
     the comment would carry,
   - **annotations** — one `::warning file=<path>::` per non-info finding (respecting the cap),
   - **artifact** — the raw `--json` verdicts (`doc2toon-verdicts.json`), uploaded always; also
     the hook a future privileged commenter would consume.

4. **Comment step is best-effort, sticky, and silent on failure.**
   - Skip the attempt when detectably read-only: `github.event.pull_request.head.repo.full_name
     != github.repository` (avoids a guaranteed-red step on every fork PR).
   - Wrap the write in try/catch via `actions/github-script` and downgrade 403/permission errors
     to a notice pointing at the step summary — covers the same-repo read-only-default case the
     fork check can't see. Any other error still fails the step.
   - Sticky update: find-and-update an existing comment by hidden marker
     `<!-- doc2toon-context-check -->` so re-pushes edit one comment instead of stacking.
   - `comment: false` input opts out entirely.
   - Consumer workflow declares `permissions: { contents: read, pull-requests: write }` —
     least privilege; GitHub clamps it to read on fork PRs regardless of what is declared.

### Degradation matrix

| Scenario | Gate (exit code) | Summary + annotations | Artifact | Comment |
|---|---|---|---|---|
| Same-repo PR, default perms writable | ✅ | ✅ | ✅ | ✅ posted/updated |
| Same-repo PR, repo default read-only, perms not declared | ✅ | ✅ | ✅ | skipped with notice (caught 403) |
| Fork PR | ✅ | ✅ | ✅ | skipped with notice (detected) |
| `comment: false` | ✅ | ✅ | ✅ | off by request |

The row that matters: **a fork contributor gets the identical verdict information** (summary +
annotations + pass/fail) — they lose only the in-thread rendering of it.

## Rejected alternatives

- **`pull_request_target` + checkout of PR head** — the documented pwn-request pattern; write
  token + untrusted content in the same run. Rejected permanently, not deferred.
- **`workflow_run` two-stage commenter** (unprivileged run uploads the verdict artifact; a
  second, privileged workflow on the base repo posts the comment). This is the known-correct
  way to comment on fork PRs and the artifact output deliberately leaves the door open. Rejected
  *for v1* on cost: it doubles the recipe (two workflow files) for a consumer promise of "≤15
  lines copy-pasteable", and the comment is not load-bearing. Revisit if an external adopter
  with fork-heavy contribution asks.
- **PAT / GitHub App secret for commenting** — reintroduces a secret-dependent path on
  untrusted PRs, the exact thing rule 2 forbids.

## Empirical checklist (run during day-11/12 Action dogfooding)

The design above depends only on documented-guaranteed behavior, so building the Action does not
wait on this; the checklist confirms the matrix on real events the first time each occurs.

- [ ] Same-repo PR on doc2toon: comment posts; re-push updates the same comment (marker found).
- [ ] Fork PR (first external contributor, or a scratch fork from a second account): comment
      step skips with notice; summary, annotations, artifact, and exit code all present.
- [ ] `--fail-on` failure renders red check + summary on both PR types.
- [ ] Same-repo PR with `permissions:` omitted in a read-only-default scratch repo: caught 403
      path produces the notice, not a red step.
