import { buildContextPlan } from "./plan.js";
import { validateToonText } from "./core.js";
import { estimateNodeTokenCount, NODE_TOKEN_ESTIMATOR_ID } from "./node-token-estimator.js";
import { runVerdict, VERDICT_SCHEMA_VERSION } from "./verdict.js";
import type { DelimiterOption, OutputMode, ParseFlavor, VerdictV1 } from "./types.js";

// Transport-free /v1 handlers (openapi/cheapagent.v1.yaml). `doc2toon serve` wraps these in
// node:http today; the day-31+ hosted Netlify function imports them verbatim — "one contract,
// two transports" enforced in code, not prose (phased plan 4.3). Handlers take a parsed JSON
// body and return {status, body}; transports own byte caps, JSON parsing, and socket concerns.
//
// Error contract (docs/verdict-schema-v1.md, decision 8): any representable verdict is 200 —
// including refused. 400 carries the {"error":{code,message}} envelope for malformed requests.
// Request validation is strict per the spec (additionalProperties: false; the wire accepts only
// canonical mode names — CLI aliases are a CLI-only courtesy). This module is Node-only (tokenx
// estimator), exported from the Node entrypoint, never from browser.ts.

export interface HandlerResponse {
  status: number;
  body: unknown;
}

interface ParsedCommonOptions {
  flavor: ParseFlavor;
  charsPerTokenRatios: number[] | undefined;
}

/** Thrown by request validation; mapped to a 400 envelope. */
class BadRequestError extends Error {}

const PROFILE_OPTION_KEYS = new Set(["flavor", "chars_per_token"]);
const CONVERT_OPTION_KEYS = new Set([
  "mode",
  "delimiter",
  "target_chars",
  "target_tokens",
  "allow_lossy",
  "chars_per_token",
  "flavor",
]);

export function handleProfile(body: unknown): HandlerResponse {
  return representable(() => {
    const { content, options } = parseContentRequest(body, PROFILE_OPTION_KEYS);
    return ok(
      runVerdict(content, {
        ...verdictBaseOptions(options),
        mode: "lossless",
        includeToonCandidate: false,
      }),
    );
  });
}

export function handleConvert(body: unknown): HandlerResponse {
  return representable(() => {
    const { content, options, raw } = parseContentRequest(body, CONVERT_OPTION_KEYS);
    const mode = parseMode(raw.mode);
    const targetChars = parsePositiveInteger(raw.target_chars, "options.target_chars");
    const targetTokens = parsePositiveInteger(raw.target_tokens, "options.target_tokens");
    if (mode === "budget" && targetChars === undefined && targetTokens === undefined) {
      throw new BadRequestError("Budget mode requires options.target_chars or options.target_tokens.");
    }
    return ok(
      runVerdict(content, {
        ...verdictBaseOptions(options),
        mode,
        delimiter: parseDelimiter(raw.delimiter),
        targetChars,
        targetTokens,
        allowLossy: parseBoolean(raw.allow_lossy, "options.allow_lossy"),
      }),
    );
  });
}

export function handleValidate(body: unknown): HandlerResponse {
  return representable(() => {
    const record = requireObject(body, "request body");
    assertNoUnknownKeys(record, new Set(["toon"]), "request body");
    const toon = record.toon;
    if (typeof toon !== "string") {
      throw new BadRequestError("toon is required and must be a string.");
    }
    const validation = validateToonText(toon);
    return ok({
      schema_version: VERDICT_SCHEMA_VERSION,
      valid: validation.valid,
      error: validation.valid ? null : { code: "invalid_toon", message: validation.error ?? "TOON validation failed." },
    });
  });
}

export function handlePlan(body: unknown): HandlerResponse {
  return representable(() => {
    const { content, options } = parseContentRequest(body, PROFILE_OPTION_KEYS);
    const { verdict } = buildContextPlan(content, {
      sourceType: "paste",
      flavor: options.flavor,
      charsPerTokenRatios: options.charsPerTokenRatios,
      estimateTokenCount: estimateNodeTokenCount,
      estimator: NODE_TOKEN_ESTIMATOR_ID,
    });
    return ok(verdict);
  });
}

/** /v1/estimate and /v1/batch are spec-only in v1 (x-status: planned); every v1 server answers 501. */
export function handleNotImplemented(route: string): HandlerResponse {
  return {
    status: 501,
    body: {
      error: {
        code: "not_implemented",
        message: `${route} is specified but not implemented in v1 servers.`,
        docs_url: "https://github.com/Profusion-AI/doc2toon#readme",
      },
    },
  };
}

export function badRequest(message: string): HandlerResponse {
  return { status: 400, body: { error: { code: "bad_request", message } } };
}

export function internalError(message: string): HandlerResponse {
  return { status: 500, body: { error: { code: "internal", message } } };
}

function ok(body: VerdictV1 | Record<string, unknown>): HandlerResponse {
  return { status: 200, body };
}

/**
 * Run a handler body, mapping validation failures to 400 and anything unrepresentable to 500.
 * runVerdict already returns refusals in-band as verdicts, so a throw here is a genuine fault.
 */
function representable(build: () => HandlerResponse): HandlerResponse {
  try {
    return build();
  } catch (error) {
    if (error instanceof BadRequestError) {
      return badRequest(error.message);
    }
    return internalError(error instanceof Error ? error.message : String(error));
  }
}

function parseContentRequest(
  body: unknown,
  allowedOptionKeys: Set<string>,
): { content: string; options: ParsedCommonOptions; raw: Record<string, unknown> } {
  const record = requireObject(body, "request body");
  assertNoUnknownKeys(record, new Set(["content", "options"]), "request body");

  const content = record.content;
  if (typeof content !== "string") {
    throw new BadRequestError("content is required and must be a string.");
  }

  const raw = record.options === undefined ? {} : requireObject(record.options, "options");
  assertNoUnknownKeys(raw, allowedOptionKeys, "options");

  return {
    content,
    options: {
      flavor: parseFlavor(raw.flavor),
      charsPerTokenRatios: parseCharsPerToken(raw.chars_per_token),
    },
    raw,
  };
}

function verdictBaseOptions(options: ParsedCommonOptions) {
  return {
    // HTTP and MCP inputs are pasted bodies, not files: source_type reflects the channel.
    sourceType: "paste" as const,
    flavor: options.flavor,
    charsPerTokenRatios: options.charsPerTokenRatios,
    estimateTokenCount: estimateNodeTokenCount,
    estimator: NODE_TOKEN_ESTIMATOR_ID,
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function assertNoUnknownKeys(record: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new BadRequestError(`Unknown field in ${label}: ${key}.`);
    }
  }
}

function parseFlavor(value: unknown): ParseFlavor {
  if (value === undefined) {
    return "markdown"; // the spec's documented default
  }
  if (value === "markdown" || value === "text") {
    return value;
  }
  throw new BadRequestError("options.flavor must be \"markdown\" or \"text\".");
}

function parseMode(value: unknown): OutputMode {
  if (value === undefined) {
    return "lossless"; // calibration question 1: lossless stays the wire default
  }
  if (value === "lossless" || value === "record" || value === "budget") {
    return value;
  }
  throw new BadRequestError("options.mode must be \"lossless\", \"record\", or \"budget\" (canonical names only).");
}

function parseDelimiter(value: unknown): DelimiterOption {
  if (value === undefined || value === "auto") {
    return "auto";
  }
  if (value === "," || value === "\t" || value === "|") {
    return value;
  }
  throw new BadRequestError("options.delimiter must be \"auto\", \",\", \"\\t\", or \"|\".");
}

function parsePositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestError(`${label} must be a positive integer.`);
  }
  return value;
}

function parseBoolean(value: unknown, label: string): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new BadRequestError(`${label} must be a boolean.`);
  }
  return value;
}

function parseCharsPerToken(value: unknown): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number" || !(entry > 0))) {
    throw new BadRequestError("options.chars_per_token must be an array of positive numbers.");
  }
  return value.length > 0 ? (value as number[]) : undefined;
}
