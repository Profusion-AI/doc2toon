# doc2toon v0.1.1 Release Check

Date: 2026-06-02

Commit: final release commit for tag `v0.1.1` after release-prep base `72e9ce8`
Tag: pending `v0.1.1`

## Summary

`doc2toon` v0.1.1 is the library-boundary and packaging hardening release. It keeps `doc2toon` as the engine/library repo and treats CheapAgent as the separate hosted app surface that consumes `doc2toon/browser`.

The release target remains deliberately narrow:

- No new conversion features.
- Package exports for Node and browser consumers.
- CLI entrypoint through `npx doc2toon`.
- Browser-safe `doc2toon/browser` entrypoint for CheapAgent.
- Measured savings only; no universal compression claims.
- CheapAgent is live as a controlled alpha at `https://cheapagent.ai/`; broader launch claims remain alpha-oriented and measured.

## Checks Run

```bash
rm -rf node_modules dist tmp/release-check-v0.1.1 doc2toon-0.1.1.tgz
npm install
npm run build
npm run lint
npm test
npm run smoke

node dist/cli.js --version
node dist/cli.js profile examples/definitions.md
node dist/cli.js convert examples/prose.md --mode lossless --out tmp/release-check-v0.1.1/prose.toon
node dist/cli.js convert examples/definitions.md --mode record --delimiter tab --out tmp/release-check-v0.1.1/defs.toon
node dist/cli.js convert examples/prose.md --mode budget --target-chars 100 --out tmp/release-check-v0.1.1/fail.toon
node dist/cli.js convert examples/prose.md --mode budget --target-chars 1000 --allow-lossy --out tmp/release-check-v0.1.1/budget.toon
node dist/cli.js validate tmp/release-check-v0.1.1/defs.toon
node dist/cli.js decode tmp/release-check-v0.1.1/defs.toon --out tmp/release-check-v0.1.1/defs.json

npm pack --dry-run --json
npm pack
npm view doc2toon version dist-tags --json
```

Tarball smoke:

```bash
mkdir -p /tmp/doc2toon-registry-smoke
npm install "$DOC2TOON_REPO/tmp/release-check-v0.1.1/doc2toon-0.1.1.tgz"
npx doc2toon --version
npx doc2toon profile "$DOC2TOON_REPO/examples/definitions.md"
node --input-type=module -e "import('doc2toon').then(m => console.log(Object.keys(m).sort()))"
node --input-type=module -e "import('doc2toon/browser').then(m => console.log(Object.keys(m).sort()))"
```

CheapAgent boundary smoke was run in a throwaway copy so the active CheapAgent frontend worktree was not mutated:

```bash
rsync -a --exclude node_modules --exclude dist --exclude .git "$CHEAPAGENT_REPO/" /tmp/cheapagent-ai-doc2toon-tarball-smoke/
npm install "$DOC2TOON_REPO/tmp/release-check-v0.1.1/doc2toon-0.1.1.tgz"
npm run build
node --input-type=module -e "import('doc2toon/browser').then(m => { if (typeof m.convertTextToToon !== 'function') throw new Error('missing convertTextToToon'); })"
```

## Results

- Clean install completed with zero reported vulnerabilities.
- Build passed.
- Lint passed.
- Tests passed: 3 files, 25 tests.
- Smoke passed.
- `node dist/cli.js --version` printed `0.1.1`.
- Profile example detected `definitions`.
- Lossless prose conversion wrote TOON and reported negative savings, as expected for prose-heavy content.
- Record conversion wrote compact tab-delimited TOON and reported measured savings on the structured sample.
- Budget refusal failed as expected without `--allow-lossy`.
- Budget conversion with `--allow-lossy` wrote lossy TOON and reached the 1000 character target.
- Direct `doc2toon validate` passed.
- Direct `doc2toon decode` wrote JSON.
- `npm pack --dry-run` produced `doc2toon-0.1.1.tgz` with 50 files and about 172 KB unpacked size.
- `npm view doc2toon version dist-tags --json` returned npm 404, indicating no current public `doc2toon` package was visible from this environment.
- Tarball install exposed `npx doc2toon`, `import("doc2toon")`, and `import("doc2toon/browser")`.
- The throwaway CheapAgent build passed against the tarball and confirmed `convertTextToToon` from `doc2toon/browser`.

## Package Contents

The dry-run package is `doc2toon@0.1.1` and includes only intentional public files:

- `dist/`
- `examples/`
- `README.md`
- `ROADMAP.md`
- `CHANGELOG.md`
- `LICENSE`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `package.json`

The package does not include `docs/`, `fixtures/`, `src/`, `scripts/`, `.github/`, `private/`, `tmp/`, coverage output, Netlify/DNS notes, CheapAgent alpha app files, or CheapAgent brand assets.

## Publish Gate

Do not publish from a dirty primary worktree. After review, the expected publish path is:

```bash
git tag -a v0.1.1 -m "doc2toon v0.1.1"
git push origin main --tags
```

The tag workflow publishes with npm trusted publishing/provenance under the `alpha` dist-tag. Promote to `latest` only after registry install and CheapAgent smoke pass.

## Publish Result

- npm package: pending
- dist-tag: pending
- registry install smoke: pending
- CheapAgent npm dependency smoke: pending
- promoted to latest: pending
