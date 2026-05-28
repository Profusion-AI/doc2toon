# doc2toon v0.1.0 Release Check

Date: 2026-05-27

Commit: see `git log --oneline --decorate -1`
Tag: `v0.1.0`

## Summary

`doc2toon` is ready for local inspection before GitHub push. The release is a local TypeScript CLI for `.md`, `.txt`, and stdin input with `profile`, `convert`, `validate`, and `decode` commands.

The public positioning is intentionally narrow:

- Profile first.
- Use compact semantic schemas.
- Validate official TOON round trips.
- Report measured savings.
- Do not claim universal compression.
- Mark budget-mode semantic compression as lossy.

## Checks Run

```bash
rm -rf node_modules dist && npm install
npm run build
npm run lint
npm test
npm run smoke
npm link
doc2toon --version
toon-doc --version
doc2toon profile examples/definitions.md
doc2toon convert examples/prose.md --mode lossless --out tmp/release-check/prose.toon
doc2toon convert examples/definitions.md --mode record --delimiter tab --out tmp/release-check/defs.toon
doc2toon convert examples/prose.md --mode budget --target-chars 100 --out tmp/release-check/fail.toon
doc2toon convert examples/prose.md --mode budget --target-chars 1000 --allow-lossy --out tmp/release-check/budget.toon
doc2toon validate tmp/release-check/defs.toon
doc2toon decode tmp/release-check/defs.toon --out tmp/release-check/defs.json
npx toon tmp/release-check/defs.toon --decode --strict -o tmp/release-check/defs.official.json
npm pack --dry-run --json
```

## Results

- Clean install completed with zero reported vulnerabilities.
- Build passed.
- Lint passed.
- Tests passed: 1 file, 7 tests.
- Smoke passed.
- `doc2toon --version` printed `0.1.0`.
- `toon-doc --version` printed `0.1.0`.
- Profile example detected `definitions`.
- Lossless prose conversion wrote TOON and reported negative savings, as expected for prose-heavy content.
- Record conversion wrote compact tab-delimited TOON.
- Budget refusal failed as expected without `--allow-lossy`.
- Budget conversion with `--allow-lossy` wrote lossy TOON and reached the 1000 character target.
- Direct `doc2toon validate` passed.
- Direct `doc2toon decode` wrote JSON.
- Official `@toon-format/cli` decode passed.
- README commands were run in order; the documented budget refusal was the only expected nonzero command.
- `npm pack --dry-run --json` included only package docs, `dist`, examples, release notes, and package metadata.
- Public roadmap docs now identify 2026-05-27 as the `doc2toon` v0.1.0 CLI release and frame CheapAgent / `cheapagent.ai` as planned follow-through until domain ownership is confirmed.
- Internal CheapAgent strategy notes are kept under ignored private paths and are not tracked or packed.

## Package Contents

The dry-run package is `doc2toon@0.1.0` and excludes `node_modules`, `tmp`, fixtures, tests, source, debug outputs, local logs, and private files.

Included top-level package surfaces:

- `dist/`
- `examples/`
- `docs/github-release-v0.1.0.md`
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `package.json`

## Strategy Privacy Pass

Internal business strategy belongs under ignored paths such as `data/private/`, `private/`, or `.strategy/`.

Public docs should stay limited to release-safe positioning:

- `doc2toon` is the v0.1.0 CLI artifact.
- CheapAgent is the working brand for planned agent-context optimization follow-through.
- TOON is one useful output target, not the whole product thesis.
- Savings claims remain measured, not assumed.

Do not publish internal source notes, market thesis drafts, pricing experiments, or private launch planning unless they have been deliberately rewritten as public copy.

## Local Git State

The repository is initialized locally on branch `main`.

No remote is configured.

The release tag is local only until pushed:

```bash
git push -u origin main
git push origin v0.1.0
```
