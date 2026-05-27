# Release Smoke Requirements

## Build

- The smoke script must build the CLI when the compiled entrypoint is missing.
- The smoke script should use the compiled `dist/cli.js` path for release-like execution.

## Conversion

- The smoke script must convert every Markdown example into generated TOON.
- The smoke script must validate each generated TOON file with the decoder.
- The smoke script should decode one generated file to JSON and check the expected top-level shape.

## Budget Safety

- The smoke script must verify that budget mode refuses an impossible lossless target.
- The converter cannot silently emit lossy output unless `--allow-lossy` is passed.

## Packaging

- The npm package should include built files and examples.
- The npm package must exclude generated smoke outputs, debug files, private files, and local environment files.
