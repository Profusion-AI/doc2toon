import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import Ajv2020 from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runVerdict } from "../src/index.js";
import { handleProfile } from "../src/http-handlers.js";
import { createMcpServer } from "../src/mcp.js";
import { estimateNodeTokenCount, NODE_TOKEN_ESTIMATOR_ID } from "../src/node-token-estimator.js";

// MCP contract tests (phased plan 4.2): the tools are thin adapters over the same transport-free
// handlers serve uses, so a tool's structuredContent must deep-equal the HTTP body and the
// library output for the same input — one contract, three transports. Most tests run over the
// SDK's linked in-memory transports; one spawns the real dist/cli-mcp.js bin to pin the stdio
// packaging decision (4.1) on this Windows machine.

const root = fileURLToPath(new URL("..", import.meta.url));
const schema = JSON.parse(readFileSync(join(root, "schemas", "verdict.v1.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true });
const validateVerdict = ajv.compile(schema);

const agentsDoc = readFileSync(join(root, "fixtures", "agent-context", "realistic", "AGENTS.md"), "utf8");

let client: Client;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(serverTransport);
  client = new Client({ name: "doc2toon-tests", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

describe("tools/list", () => {
  it("exposes profile, convert, plan, validate with plain JSON Schema inputs", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(["convert", "plan", "profile", "validate"]);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });
});

describe("tools/call", () => {
  it("profile structuredContent deep-equals runVerdict and the HTTP handler for the same input", async () => {
    const result = await client.callTool({ name: "profile", arguments: { content: agentsDoc } });

    expect(result.isError ?? false).toBe(false);
    const verdict = result.structuredContent as Record<string, unknown>;
    expect(validateVerdict(verdict)).toBe(true);
    expect(verdict.schema_version).toBe("1.0");
    expect(verdict.toon_candidate).toBeNull();

    const viaLibrary = runVerdict(agentsDoc, {
      sourceType: "paste",
      flavor: "markdown",
      mode: "lossless",
      estimateTokenCount: estimateNodeTokenCount,
      estimator: NODE_TOKEN_ESTIMATOR_ID,
      includeToonCandidate: false,
    });
    const viaHttpHandler = handleProfile({ content: agentsDoc });
    expect(verdict).toEqual(JSON.parse(JSON.stringify(viaLibrary)));
    expect(verdict).toEqual(JSON.parse(JSON.stringify(viaHttpHandler.body)));

    // The text content carries the same JSON for clients that ignore structuredContent.
    const textBlock = (result.content as Array<{ type: string; text: string }>)[0];
    expect(JSON.parse(textBlock.text)).toEqual(verdict);
  });

  it("budget refusal is a representable result, not a tool error (decision 6)", async () => {
    const result = await client.callTool({
      name: "convert",
      arguments: {
        content: "# Prose\n\nThis cannot fit ten characters losslessly.",
        options: { mode: "budget", target_chars: 10 },
      },
    });

    expect(result.isError ?? false).toBe(false);
    const verdict = result.structuredContent as Record<string, unknown>;
    expect(verdict.verdict).toBe("refused");
    expect(validateVerdict(verdict)).toBe(true);
  });

  it("plan returns the schema 1.1 verdict with context_plan", async () => {
    const result = await client.callTool({ name: "plan", arguments: { content: agentsDoc } });

    expect(result.isError ?? false).toBe(false);
    const verdict = result.structuredContent as Record<string, any>;
    expect(verdict.schema_version).toBe("1.1");
    expect(verdict.context_plan.sections.length).toBeGreaterThan(0);
    expect(verdict.context_plan.reassembly_verified).toBe(true);
    expect(validateVerdict(verdict)).toBe(true);
  });

  it("invalid TOON is representable through the validate tool (decision 11)", async () => {
    const result = await client.callTool({
      name: "validate",
      arguments: { toon: "defs[2]{id,term}:\n  d001,alpha\n" },
    });

    expect(result.isError ?? false).toBe(false);
    const validation = result.structuredContent as Record<string, any>;
    expect(validation.valid).toBe(false);
    expect(validation.error.code).toBe("invalid_toon");
  });

  it("malformed arguments become an isError result carrying the same 400 envelope as HTTP", async () => {
    const result = await client.callTool({
      name: "convert",
      arguments: { content: "x", options: { mode: "lossless-doc" } },
    });

    expect(result.isError).toBe(true);
    const envelope = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(envelope.error.code).toBe("bad_request");
    expect(envelope.error.message).toContain("canonical");
  });

  it("unknown tool name is an isError result, not a transport failure", async () => {
    const result = await client.callTool({ name: "summarize", arguments: {} });

    expect(result.isError).toBe(true);
    const envelope = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(envelope.error.code).toBe("bad_request");
  });
});

describe("doc2toon-mcp bin over real stdio (packaging decision 4.1)", () => {
  it("spawns, lists tools, and answers a call end-to-end", async () => {
    const bin = join(root, "dist", "cli-mcp.js");
    expect(existsSync(bin), "dist/cli-mcp.js not found — run `npm run build` before `npm test`.").toBe(true);

    const transport = new StdioClientTransport({ command: process.execPath, args: [bin] });
    const stdioClient = new Client({ name: "doc2toon-stdio-test", version: "0.0.0" });
    await stdioClient.connect(transport);
    try {
      const { tools } = await stdioClient.listTools();
      expect(tools.map((tool) => tool.name)).toContain("profile");

      const result = await stdioClient.callTool({ name: "profile", arguments: { content: "# T\n\nBody.\n" } });
      expect(result.isError ?? false).toBe(false);
      expect((result.structuredContent as Record<string, unknown>).schema_version).toBe("1.0");
    } finally {
      await stdioClient.close();
    }
  });
});
