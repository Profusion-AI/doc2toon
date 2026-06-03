# doc2toon v0.1.2 Release Check

Date: 2026-06-02

Tag: pending `v0.1.2`

## Summary

`doc2toon` v0.1.2 is a packaging-only retry after the pushed `v0.1.1` tag workflow failed at npm publication before the package became registry-visible.

The release keeps the v0.1.1 package contract:

- CLI entrypoint through `npx doc2toon`.
- Node import through `doc2toon`.
- Browser-safe import through `doc2toon/browser`.
- Measured savings only; no universal compression claims.
- CheapAgent remains the separate hosted app surface.

## Changes Since v0.1.1

- Package version bumped to `0.1.2`.
- CLI `bin` paths normalized from `./dist/cli.js` to `dist/cli.js`, matching npm's publish-time package fix.

## Checks Run

```bash
npm run build
npm run lint
npm test
npm run smoke
node dist/cli.js --version
npm pack --dry-run --json
npm publish --dry-run --access public --tag alpha
```

Tarball smoke:

```bash
npm pack --pack-destination tmp/release-check-v0.1.2
mkdir -p /tmp/doc2toon-registry-smoke-v012
npm install /home/kyle/toon-doc-converter/tmp/release-check-v0.1.2/doc2toon-0.1.2.tgz
npx doc2toon --version
npx doc2toon profile /home/kyle/toon-doc-converter/examples/definitions.md
node --input-type=module -e "import('doc2toon').then(m => console.log(Object.keys(m).sort()))"
node --input-type=module -e "import('doc2toon/browser').then(m => console.log(Object.keys(m).sort()))"
```

CheapAgent boundary smoke was run in a throwaway copy:

```bash
npm install /home/kyle/toon-doc-converter/tmp/release-check-v0.1.2/doc2toon-0.1.2.tgz
npm run build
node --input-type=module -e "import('doc2toon/browser').then(m => { if (typeof m.convertTextToToon !== 'function') throw new Error('missing convertTextToToon'); })"
```

## Results

- Build passed.
- Lint passed.
- Tests passed: 3 files, 25 tests.
- Smoke passed.
- `node dist/cli.js --version` printed `0.1.2`.
- `npm pack --dry-run` produced `doc2toon-0.1.2.tgz` with 50 files and about 173 KB unpacked size.
- `npm publish --dry-run --access public --tag alpha` passed locally with only the expected unauthenticated dry-run warning.
- Tarball install exposed `npx doc2toon`, `import("doc2toon")`, and `import("doc2toon/browser")`.
- The throwaway CheapAgent build passed against the tarball and confirmed `convertTextToToon` from `doc2toon/browser`.
- Local `npm whoami` returned `ENEEDAUTH`, so a manual local publish is blocked until this machine is authenticated to npm.

## Publish Result

- npm package: blocked on npm first-publish auth/trusted-publisher setup
- dist-tag: pending
- registry install smoke: pending
- CheapAgent npm dependency smoke: tarball smoke passed; registry smoke pending
- promoted to latest: pending

Do not push tag `v0.1.2` until the npm first-publish path is resolved through either a configured trusted publisher that can create the package or a manual first publish from an authenticated npm session.
