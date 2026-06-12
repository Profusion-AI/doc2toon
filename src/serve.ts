import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import {
  badRequest,
  handleConvert,
  handleNotImplemented,
  handlePlan,
  handleProfile,
  handleValidate,
  internalError,
  type HandlerResponse,
} from "./http-handlers.js";

// `doc2toon serve` (phased plan 4.3): the local HTTP transport of the frozen contract —
// node:http wrapping the transport-free handlers, zero new dependencies. Privacy posture is
// structural: binds 127.0.0.1 unless an explicit --host says otherwise, no CORS unless an
// explicit --cors origin says otherwise, and document bodies never leave the process.
//
// HTTP mapping (docs/verdict-schema-v1.md, decision 8): representable verdict = 200 (including
// refused and valid:false); malformed input = 400 envelope; oversized body = 413 (2 MB default);
// spec-only routes = 501; unrepresentable failure = 500. Never an unhandled 500 for a
// representable condition.

export interface ServeOptions {
  port: number;
  /** Default 127.0.0.1 — exposing beyond localhost requires an explicit host. */
  host?: string;
  /** When set, CORS is enabled for exactly this origin. Off by default. */
  corsOrigin?: string;
  /** Request-body byte cap. Default 2 MiB (413 above it). */
  maxBodyBytes?: number;
}

export const DEFAULT_SERVE_PORT = 8787;
export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

const { version: packageVersion } = createRequire(import.meta.url)("../package.json") as { version: string };

// The packaged spec, served from GET /v1/openapi.yaml so a caller can always discover the exact
// contract version it is talking to. dist/serve.js and src/serve.ts both sit one level under the
// package root, so the relative URL holds in both layouts.
const OPENAPI_PATH = new URL("../openapi/cheapagent.v1.yaml", import.meta.url);

const POST_ROUTES: Record<string, (body: unknown) => HandlerResponse> = {
  "/v1/profile": handleProfile,
  "/v1/convert": handleConvert,
  "/v1/validate": handleValidate,
  "/v1/plan": handlePlan,
};

const PLANNED_ROUTES = new Set(["/v1/estimate", "/v1/batch"]);

export function createServeServer(options: Pick<ServeOptions, "corsOrigin" | "maxBodyBytes"> = {}): HttpServer {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const openapiYaml = readFileSync(OPENAPI_PATH, "utf8");

  return createServer((request, response) => {
    void route(request, response, openapiYaml, maxBodyBytes, options.corsOrigin).catch((error) => {
      // Last-resort guard: handlers map their own failures; reaching here means the transport
      // itself broke. Best-effort envelope if headers haven't gone out.
      if (!response.headersSent) {
        sendJson(response, internalError(error instanceof Error ? error.message : String(error)), options.corsOrigin);
      } else {
        response.destroy();
      }
    });
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  openapiYaml: string,
  maxBodyBytes: number,
  corsOrigin: string | undefined,
): Promise<void> {
  const path = (request.url ?? "/").split("?")[0];

  if (request.method === "OPTIONS") {
    if (corsOrigin) {
      response.writeHead(204, {
        ...corsHeaders(corsOrigin),
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      });
      response.end();
      return;
    }
    sendJson(response, methodNotAllowed(), corsOrigin);
    return;
  }

  if (path === "/v1/openapi.yaml") {
    if (request.method !== "GET") {
      sendJson(response, methodNotAllowed(), corsOrigin);
      return;
    }
    response.writeHead(200, {
      "content-type": "application/yaml; charset=utf-8",
      ...(corsOrigin ? corsHeaders(corsOrigin) : {}),
    });
    response.end(openapiYaml);
    return;
  }

  if (PLANNED_ROUTES.has(path)) {
    sendJson(response, handleNotImplemented(path), corsOrigin);
    return;
  }

  const handler = POST_ROUTES[path];
  if (!handler) {
    sendJson(response, { status: 404, body: { error: { code: "not_found", message: `No such route: ${path}.` } } }, corsOrigin);
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, methodNotAllowed(), corsOrigin);
    return;
  }

  const body = await readBody(request, maxBodyBytes);
  if (body === "too_large") {
    sendJson(
      response,
      {
        status: 413,
        body: {
          error: {
            code: "payload_too_large",
            message: `Request body exceeds the ${maxBodyBytes}-byte limit.`,
          },
        },
      },
      corsOrigin,
      true,
    );
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    sendJson(response, badRequest("Request body must be valid JSON."), corsOrigin);
    return;
  }

  sendJson(response, handler(parsed), corsOrigin);
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer | "too_large"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;

    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (tooLarge) {
        // Keep draining (discarding) so the client can finish its send and read the 413
        // instead of hitting a connection reset mid-write — but bound the courtesy so a
        // hostile endless stream cannot hold the socket.
        if (total > maxBytes * 4) {
          request.destroy();
        }
        return;
      }
      if (total > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        resolve("too_large");
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!tooLarge) {
        resolve(Buffer.concat(chunks));
      }
    });
    request.on("error", (error) => {
      if (!tooLarge) {
        reject(error);
      }
      // After the early 413 the request stream may error as the client aborts; that is fine.
    });
  });
}

function sendJson(
  response: ServerResponse,
  handlerResponse: HandlerResponse,
  corsOrigin: string | undefined,
  closeConnection = false,
): void {
  const payload = JSON.stringify(handlerResponse.body, null, 2);
  response.writeHead(handlerResponse.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...(corsOrigin ? corsHeaders(corsOrigin) : {}),
    ...(closeConnection ? { connection: "close" } : {}),
  });
  response.end(payload);
}

function corsHeaders(origin: string): Record<string, string> {
  return { "access-control-allow-origin": origin };
}

function methodNotAllowed(): HandlerResponse {
  return { status: 405, body: { error: { code: "method_not_allowed", message: "Use POST for /v1 endpoints (GET only for /v1/openapi.yaml)." } } };
}

export async function runServe(options: ServeOptions): Promise<void> {
  const host = options.host ?? "127.0.0.1";
  const server = createServeServer(options);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => resolve());
  });

  if (host !== "127.0.0.1" && host !== "localhost") {
    console.error(`Warning: binding ${host} exposes the server beyond localhost.`);
  }
  console.log(`doc2toon ${packageVersion} serving on http://${host}:${options.port}`);
  console.log("  POST /v1/profile | /v1/convert | /v1/validate | /v1/plan   GET /v1/openapi.yaml");
  console.log("  Document bodies never leave this machine.");

  await new Promise<void>((resolve) => {
    const shutdown = () => server.close(() => resolve());
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
