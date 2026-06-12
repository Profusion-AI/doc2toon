#!/usr/bin/env node
// Dedicated bin for the MCP server (phased plan 4.1 decision): `doc2toon-mcp` is the documented
// client-config form because a single-purpose bin avoids commander passthrough edge cases in
// MCP client configs (`doc2toon mcp` exists too and runs the same server). stdout belongs to
// the MCP stdio transport; nothing here may print to it.
import { runMcpServer } from "./mcp.js";

await runMcpServer();
