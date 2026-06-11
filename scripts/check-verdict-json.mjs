#!/usr/bin/env node
// Validates a CLI --json output file against schemas/verdict.v1.json. Used by the CI smoke
// (scripts/smoke.sh) so the published CLI's wire output is ajv-checked on every run, not just
// in vitest. Exits 1 with the validation errors when the document does not conform.
//
// Usage: node scripts/check-verdict-json.mjs <verdict.json>

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import Ajv2020Module from "ajv/dist/2020.js";

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/check-verdict-json.mjs <verdict.json>");
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const schema = JSON.parse(readFileSync(join(root, "schemas", "verdict.v1.json"), "utf8"));
const document = JSON.parse(readFileSync(target, "utf8"));

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(schema);

if (!validate(document)) {
  console.error(`Schema validation failed for ${target}:`);
  console.error(JSON.stringify(validate.errors, null, 2));
  process.exit(1);
}

console.log(`Schema-valid verdict: ${target}`);
