import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  handleConvert,
  handlePlan,
  handleProfile,
  handleValidate,
  type HandlerResponse,
} from "./http-handlers.js";

// MCP server (phased plan 4.2): tools are thin adapters over the same transport-free /v1
// handlers `doc2toon serve` uses, so an MCP tool result deep-equals the HTTP body and the CLI
// --json output for the same input — one contract, three transports, no surface re-derives a
// verdict. Tool inputs mirror the OpenAPI request components verbatim (content + options).
//
// This module is Node-only and deliberately NOT exported from src/index.ts: the SDK's
// dependency tree is heavy, and library consumers shouldn't pay for it. It is reachable via
// the dedicated `doc2toon-mcp` bin (the documented client-config form) and the `doc2toon mcp`
// subcommand, which imports this module dynamically.
//
// stdio discipline: stdout is the protocol channel. Nothing in this module may write to
// stdout; the startup notice goes to stderr.

const { version: packageVersion } = createRequire(import.meta.url)("../package.json") as { version: string };

const CHARS_PER_TOKEN_SCHEMA = {
  type: "array",
  description: "Chars-per-token ratios for the advisory ratio_estimates table.",
  items: { type: "number", exclusiveMinimum: 0 },
} as const;

const FLAVOR_SCHEMA = {
  description: "Parser flavor override. Defaults to markdown.",
  enum: ["markdown", "text"],
} as const;

/** Mirrors components.schemas.ProfileRequest in openapi/cheapagent.v1.yaml. */
const PROFILE_INPUT_SCHEMA = {
  type: "object",
  required: ["content"],
  additionalProperties: false,
  properties: {
    content: { type: "string", description: "The document text to profile." },
    options: {
      type: "object",
      additionalProperties: false,
      properties: {
        flavor: FLAVOR_SCHEMA,
        chars_per_token: CHARS_PER_TOKEN_SCHEMA,
      },
    },
  },
} as const;

/** Mirrors components.schemas.ConvertRequest in openapi/cheapagent.v1.yaml. */
const CONVERT_INPUT_SCHEMA = {
  type: "object",
  required: ["content"],
  additionalProperties: false,
  properties: {
    content: { type: "string", description: "The document text to convert." },
    options: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          description: "Output mode. Defaults to lossless. Canonical names only.",
          enum: ["lossless", "record", "budget"],
        },
        delimiter: {
          description: "TOON delimiter. Defaults to auto.",
          enum: ["auto", ",", "\t", "|"],
        },
        target_chars: {
          type: "integer",
          exclusiveMinimum: 0,
          description: "Character budget, mainly for budget mode.",
        },
        target_tokens: {
          type: "integer",
          exclusiveMinimum: 0,
          description: "Estimated-token budget, mainly for budget mode.",
        },
        allow_lossy: {
          type: "boolean",
          description:
            "Permit semantic compression when a budget cannot be met losslessly. When false (default), an unreachable budget yields verdict \"refused\".",
        },
        chars_per_token: CHARS_PER_TOKEN_SCHEMA,
        flavor: FLAVOR_SCHEMA,
      },
    },
  },
} as const;

/** Mirrors components.schemas.PlanRequest in openapi/cheapagent.v1.yaml (same shape as ProfileRequest). */
const PLAN_INPUT_SCHEMA = {
  type: "object",
  required: ["content"],
  additionalProperties: false,
  properties: {
    content: { type: "string", description: "The document text to plan." },
    options: {
      type: "object",
      additionalProperties: false,
      properties: {
        flavor: FLAVOR_SCHEMA,
        chars_per_token: CHARS_PER_TOKEN_SCHEMA,
      },
    },
  },
} as const;

/** Mirrors components.schemas.ValidateRequest in openapi/cheapagent.v1.yaml. */
const VALIDATE_INPUT_SCHEMA = {
  type: "object",
  required: ["toon"],
  additionalProperties: false,
  properties: {
    toon: { type: "string", description: "TOON text to decode with the official decoder." },
  },
} as const;

// Deliberately loose output schemas: the canonical contract is schemas/verdict.v1.json
// ($id https://cheapagent.ai/schemas/verdict.v1.json, shipped in this npm package), and
// embedding ~12 kB of schema per tool would bloat every client's tools/list — the wrong look
// for a context-efficiency tool. Consumers MUST ignore unknown fields per the contract.
const VERDICT_OUTPUT_SCHEMA = {
  type: "object",
  required: ["schema_version", "verdict", "safe_to_auto_apply", "measured_chars"],
  additionalProperties: true,
  description:
    "CheapAgent Verdict v1 (canonical: schemas/verdict.v1.json in the doc2toon package; $id https://cheapagent.ai/schemas/verdict.v1.json). Decision fields derive from measured character counts and warning codes; token estimates are advisory.",
} as const;

const VALIDATION_OUTPUT_SCHEMA = {
  type: "object",
  required: ["schema_version", "valid", "error"],
  additionalProperties: true,
  description: "ValidationResult: error is null when valid, else {code, message} (e.g. invalid_toon).",
} as const;

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false } as const;

const TOOLS = [
  {
    name: "profile",
    title: "Profile a document (verdict without the TOON payload)",
    description:
      "Profile a Markdown/text document and get the conversion verdict WITHOUT the TOON payload — call this before loading a large document into context. The verdict (convert | keep_markdown | split_first | review | refused) derives from measured character counts under a frozen policy; toon_candidate is always null on this tool. If the verdict is convert, call the convert tool for the payload.",
    inputSchema: PROFILE_INPUT_SCHEMA,
    outputSchema: VERDICT_OUTPUT_SCHEMA,
    handler: handleProfile,
  },
  {
    name: "convert",
    title: "Convert a document to TOON (verdict with the payload)",
    description:
      "Convert a document to TOON and get the full verdict including toon_candidate. A budget target that cannot be met losslessly without allow_lossy is a representable outcome (verdict: refused), not an error.",
    inputSchema: CONVERT_INPUT_SCHEMA,
    outputSchema: VERDICT_OUTPUT_SCHEMA,
    handler: handleConvert,
  },
  {
    name: "plan",
    title: "Per-section context plan (hybrid recommendation)",
    description:
      "Build a per-section context plan (Verdict 1.1): every heading-bounded section of the document is measured as a standalone document under the same frozen policy, and a Markdown+TOON hybrid is recommended only when the net savings — splice overhead included — clear the 5% band. Returns the whole-document verdict with the context_plan field (per-section verdicts, measured deltas, net, reassembly verification). The hybrid document itself is produced by the doc2toon CLI: doc2toon plan --out hybrid.md <file>.",
    inputSchema: PLAN_INPUT_SCHEMA,
    outputSchema: VERDICT_OUTPUT_SCHEMA,
    handler: handlePlan,
  },
  {
    name: "validate",
    title: "Validate TOON text",
    description:
      "Validate TOON text with the official decoder. An invalid document is a representable outcome: valid is false with a coded error, never a tool error.",
    inputSchema: VALIDATE_INPUT_SCHEMA,
    outputSchema: VALIDATION_OUTPUT_SCHEMA,
    handler: handleValidate,
  },
] as const;

export function createMcpServer(): Server {
  const server = new Server(
    { name: "doc2toon", version: packageVersion },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, title, description, inputSchema, outputSchema }) => ({
      name,
      title,
      description,
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((entry) => entry.name === request.params.name);
    if (!tool) {
      return errorResult({
        status: 400,
        body: { error: { code: "bad_request", message: `Unknown tool: ${request.params.name}.` } },
      });
    }
    const response = tool.handler(request.params.arguments ?? {});
    if (response.status !== 200) {
      return errorResult(response);
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(response.body, null, 2) }],
      structuredContent: response.body as Record<string, unknown>,
    };
  });

  return server;
}

/**
 * Transport-level errors are reserved for unrepresentable failures, mirroring decision 8:
 * a 4xx/5xx envelope becomes an isError tool result carrying the same JSON envelope, so an
 * agent sees identical error data over MCP and HTTP.
 */
function errorResult(response: HandlerResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(response.body, null, 2) }],
    isError: true,
  };
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  console.error(`doc2toon ${packageVersion} MCP server on stdio (tools: profile, convert, plan, validate)`);
}
