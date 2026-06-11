import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

// "One contract, two transports": components.schemas.Verdict in the OpenAPI spec must deep-equal
// schemas/verdict.v1.json modulo $schema/$id. Both files are deliberately written without internal
// $refs so this stays plain deep equality (docs/verdict-schema-v1.md, decision 10).

const root = fileURLToPath(new URL("..", import.meta.url));
const jsonSchema = JSON.parse(readFileSync(join(root, "schemas", "verdict.v1.json"), "utf8"));
const openapi = parse(readFileSync(join(root, "openapi", "cheapagent.v1.yaml"), "utf8"));

describe("OpenAPI <-> JSON Schema sync", () => {
  it("components.schemas.Verdict deep-equals schemas/verdict.v1.json modulo $schema/$id", () => {
    const { $schema: _schema, $id: _id, ...canonical } = jsonSchema;
    expect(openapi.components?.schemas?.Verdict).toEqual(canonical);
  });

  it("the JSON Schema compiles under JSON Schema 2020-12", () => {
    const ajv = new Ajv2020({ allErrors: true });
    expect(() => ajv.compile(jsonSchema)).not.toThrow();
  });

  it("the spec exposes the v1 surface the schema doc promises", () => {
    const paths = Object.keys(openapi.paths ?? {});
    for (const path of ["/v1/profile", "/v1/convert", "/v1/validate", "/v1/estimate", "/v1/batch"]) {
      expect(paths).toContain(path);
    }
  });
});
