import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runVerdict } from "../src/index.js";
import { buildContextPlan } from "../src/plan.js";
import { createServeServer } from "../src/serve.js";
import { estimateNodeTokenCount, NODE_TOKEN_ESTIMATOR_ID } from "../src/node-token-estimator.js";
import type { Server as HttpServer } from "node:http";

// `doc2toon serve` contract tests (phased plan 4.3): every route on an ephemeral localhost
// port, every response validated against the frozen contract. The handlers are the exact
// functions a hosted transport would import, so what these tests pin is the wire behavior of
// "one contract, two transports" — including decision 8's HTTP mapping (representable verdict
// = 200, refusal included; envelopes for 400/404/405/413/500; 501 for spec-only routes).

const root = fileURLToPath(new URL("..", import.meta.url));
const schema = JSON.parse(readFileSync(join(root, "schemas", "verdict.v1.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true });
const validateVerdict = ajv.compile(schema);

const wireOptions = {
  sourceType: "paste" as const,
  flavor: "markdown" as const,
  estimateTokenCount: estimateNodeTokenCount,
  estimator: NODE_TOKEN_ESTIMATOR_ID,
};

let server: HttpServer;
let base: string;

beforeAll(async () => {
  server = createServeServer({ maxBodyBytes: 64 * 1024 }); // small cap keeps the 413 test fast
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

const agentsDoc = readFileSync(join(root, "fixtures", "agent-context", "realistic", "AGENTS.md"), "utf8");
const mixedDoc = readFileSync(
  join(root, "fixtures", "agent-context", "problematic", "mixed-agent-context.md"),
  "utf8",
);

describe("POST /v1/profile", () => {
  it("returns a schema-valid verdict with the candidate withheld, byte-equal to runVerdict", async () => {
    const { status, json } = await post("/v1/profile", { content: agentsDoc });

    expect(status).toBe(200);
    expect(validateVerdict(json)).toBe(true);
    expect(validateVerdict.errors ?? []).toEqual([]);
    expect(json.schema_version).toBe("1.0");
    expect(json.toon_candidate).toBeNull();
    expect("context_plan" in json).toBe(false);

    const expected = runVerdict(agentsDoc, { ...wireOptions, mode: "lossless", includeToonCandidate: false });
    expect(json).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  it("honors options.flavor and options.chars_per_token", async () => {
    const { status, json } = await post("/v1/profile", {
      content: agentsDoc,
      options: { flavor: "text", chars_per_token: [3.7] },
    });

    expect(status).toBe(200);
    expect(json.profile.source_type).toBe("paste");
    expect(json.token_estimates.ratio_estimates).toHaveLength(1);
    expect(json.token_estimates.ratio_estimates[0].chars_per_token).toBe(3.7);
  });
});

describe("POST /v1/convert", () => {
  it("returns the verdict with the TOON candidate attached", async () => {
    const { status, json } = await post("/v1/convert", { content: agentsDoc });

    expect(status).toBe(200);
    expect(validateVerdict(json)).toBe(true);
    expect(typeof json.toon_candidate === "string" || json.toon_candidate === null).toBe(true);

    const expected = runVerdict(agentsDoc, { ...wireOptions, mode: "lossless" });
    expect(json).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  it("represents budget refusal in-band: HTTP 200 with verdict refused (decision 6)", async () => {
    const { status, json } = await post("/v1/convert", {
      content: "# Prose\n\nThis cannot fit ten characters losslessly.",
      options: { mode: "budget", target_chars: 10 },
    });

    expect(status).toBe(200);
    expect(json.verdict).toBe("refused");
    expect(json.toon_candidate).toBeNull();
    expect(json.warnings.map((warning: { code: string }) => warning.code)).toContain("budget_refused");
    expect(validateVerdict(json)).toBe(true);
  });

  it("rejects budget mode without a target as bad_request (caller error, not refusal)", async () => {
    const { status, json } = await post("/v1/convert", { content: "# D\n\nBody.", options: { mode: "budget" } });

    expect(status).toBe(400);
    expect(json.error.code).toBe("bad_request");
  });

  it("accepts only canonical mode names on the wire (decision 7: CLI aliases are CLI-only)", async () => {
    const { status, json } = await post("/v1/convert", {
      content: "# D\n\nBody.",
      options: { mode: "lossless-doc" },
    });

    expect(status).toBe(400);
    expect(json.error.code).toBe("bad_request");
    expect(json.error.message).toContain("canonical");
  });
});

describe("POST /v1/validate", () => {
  it("returns valid:true with error:null for decodable TOON, HTTP 200", async () => {
    const convert = await post("/v1/convert", { content: agentsDoc });
    const { status, json } = await post("/v1/validate", { toon: convert.json.toon_candidate });

    expect(status).toBe(200);
    expect(json.valid).toBe(true);
    expect(json.error).toBeNull();
    expect(json.schema_version).toMatch(/^1\.[0-9]+$/);
  });

  it("an invalid document is representable: HTTP 200 with valid:false and invalid_toon (decision 11)", async () => {
    const { status, json } = await post("/v1/validate", { toon: "defs[2]{id,term}:\n  d001,alpha\n" });

    expect(status).toBe(200);
    expect(json.valid).toBe(false);
    expect(json.error.code).toBe("invalid_toon");
  });
});

describe("POST /v1/plan (the one schema 1.1 surface)", () => {
  it("returns the whole-document verdict carrying context_plan, byte-equal to buildContextPlan", async () => {
    const { status, json } = await post("/v1/plan", { content: mixedDoc });

    expect(status).toBe(200);
    expect(json.schema_version).toBe("1.1");
    expect(json.toon_candidate).toBeNull();
    expect(json.context_plan.sections.length).toBeGreaterThan(1);
    expect(json.context_plan.reassembly_verified).toBe(true);
    expect(validateVerdict(json)).toBe(true);
    expect(validateVerdict.errors ?? []).toEqual([]);

    const expected = buildContextPlan(mixedDoc, {
      sourceType: "paste",
      flavor: "markdown",
      estimateTokenCount: estimateNodeTokenCount,
      estimator: NODE_TOKEN_ESTIMATOR_ID,
    }).verdict;
    expect(json).toEqual(JSON.parse(JSON.stringify(expected)));
  });
});

describe("error envelopes and transport limits (decision 8 HTTP mapping)", () => {
  it("malformed JSON: 400 bad_request", async () => {
    const { status, json } = await post("/v1/profile", "{not json");
    expect(status).toBe(400);
    expect(json.error.code).toBe("bad_request");
  });

  it("unknown top-level and option fields: 400 (requests are additionalProperties: false)", async () => {
    const top = await post("/v1/profile", { content: "x", extra: 1 });
    expect(top.status).toBe(400);
    expect(top.json.error.message).toContain("extra");

    const option = await post("/v1/profile", { content: "x", options: { bogus: true } });
    expect(option.status).toBe(400);
    expect(option.json.error.message).toContain("bogus");
  });

  it("missing content: 400", async () => {
    const { status, json } = await post("/v1/plan", { options: {} });
    expect(status).toBe(400);
    expect(json.error.code).toBe("bad_request");
  });

  it("oversized body: 413 payload_too_large", async () => {
    const { status, json } = await post("/v1/profile", { content: "x".repeat(128 * 1024) });
    expect(status).toBe(413);
    expect(json.error.code).toBe("payload_too_large");
  });

  it("spec-only routes answer 501 with a docs pointer", async () => {
    for (const path of ["/v1/estimate", "/v1/batch"]) {
      const { status, json } = await post(path, {});
      expect(status).toBe(501);
      expect(json.error.code).toBe("not_implemented");
      expect(json.error.docs_url).toContain("doc2toon");
    }
  });

  it("unknown route: 404; wrong method: 405", async () => {
    const notFound = await post("/v1/nope", {});
    expect(notFound.status).toBe(404);
    expect(notFound.json.error.code).toBe("not_found");

    const get = await fetch(`${base}/v1/profile`);
    expect(get.status).toBe(405);
    expect((await get.json()).error.code).toBe("method_not_allowed");
  });

  it("GET /v1/openapi.yaml serves the packaged spec", async () => {
    const response = await fetch(`${base}/v1/openapi.yaml`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("yaml");
    const text = await response.text();
    expect(text.startsWith("openapi: 3.1")).toBe(true);
    expect(text).toBe(readFileSync(join(root, "openapi", "cheapagent.v1.yaml"), "utf8"));
  });
});

describe("CORS posture", () => {
  it("no CORS headers by default; OPTIONS is 405", async () => {
    const { status } = await post("/v1/profile", { content: "x" });
    expect(status).toBe(200);
    const plain = await fetch(`${base}/v1/profile`, { method: "POST", body: JSON.stringify({ content: "x" }) });
    expect(plain.headers.get("access-control-allow-origin")).toBeNull();

    const preflight = await fetch(`${base}/v1/profile`, { method: "OPTIONS" });
    expect(preflight.status).toBe(405);
  });

  it("opt-in --cors enables exactly the configured origin", async () => {
    const corsServer = createServeServer({ corsOrigin: "https://cheapagent.ai" });
    await new Promise<void>((resolve) => corsServer.listen(0, "127.0.0.1", resolve));
    const corsBase = `http://127.0.0.1:${(corsServer.address() as AddressInfo).port}`;
    try {
      const preflight = await fetch(`${corsBase}/v1/profile`, { method: "OPTIONS" });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("https://cheapagent.ai");

      const response = await fetch(`${corsBase}/v1/profile`, {
        method: "POST",
        body: JSON.stringify({ content: "x" }),
      });
      expect(response.headers.get("access-control-allow-origin")).toBe("https://cheapagent.ai");
    } finally {
      await new Promise<void>((resolve, reject) =>
        corsServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
