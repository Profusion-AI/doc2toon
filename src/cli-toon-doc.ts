#!/usr/bin/env node
// Dedicated entry for the deprecated `toon-doc` bin alias (docs/verdict-schema-v1.md, decision 7:
// warn on use in v0.3.0, removed at 1.0). A wrapper bin makes the warning fire deterministically
// through both POSIX symlinks and Windows cmd shims — argv-based detection cannot see the alias
// name through Windows shims, which invoke the real script path directly.
console.error("Warning: the toon-doc command is deprecated and will be removed in 1.0; use doc2toon.");
await import("./cli.js");
