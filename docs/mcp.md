# doc2toon MCP server

The MCP server lets any MCP client (Claude Code, Cowork, Claude Desktop, or anything else
speaking the protocol) call doc2toon as tools. It is the same engine behind every other
surface: tool results are the [Verdict v1 object](../schemas/verdict.v1.json), produced by the
same transport-free handlers `doc2toon serve` exposes over HTTP — an MCP tool result
deep-equals the CLI `--json` output for the same input (test-enforced).

**Privacy posture:** the server runs locally over stdio. Document bodies never leave your
machine.

## Tools

| Tool | What it returns |
|---|---|
| `profile` | The verdict **without** the TOON payload (`toon_candidate: null`) — call this before loading a large document into context |
| `convert` | The verdict **with** `toon_candidate`. A budget refusal is `verdict: "refused"`, never a tool error |
| `plan` | The whole-document verdict carrying `context_plan` (schema 1.1): per-section verdicts, measured deltas, net hybrid savings, reassembly verification |
| `validate` | `{valid, error}` from the official TOON decoder; invalid TOON is `valid: false`, never a tool error |

All tools are read-only. Decision fields derive from measured character counts under the
frozen policy ([docs/verdict-schema-v1.md](verdict-schema-v1.md)); token estimates are
advisory.

## Install

The documented client-config form is the dedicated `doc2toon-mcp` bin (a single-purpose bin
avoids CLI-passthrough edge cases in client configs). `doc2toon mcp` runs the identical
server if you prefer the subcommand.

### Claude Code (macOS / Linux)

```bash
claude mcp add doc2toon -- npx -y doc2toon-mcp@0.4.x
```

### Claude Code (Windows)

Windows client configs need the `cmd /c` wrapper for npx-launched servers:

```bash
claude mcp add doc2toon -- cmd /c npx -y doc2toon-mcp@0.4.x
```

### Any MCP client (JSON config)

```json
{
  "mcpServers": {
    "doc2toon": {
      "command": "npx",
      "args": ["-y", "doc2toon-mcp@0.4.x"]
    }
  }
}
```

On Windows, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "doc2toon-mcp@0.4.x"]`.

With doc2toon installed globally (`npm i -g doc2toon`), replace the npx forms with plain
`doc2toon-mcp`.

### Cowork / Claude Desktop

Add the JSON block above to the MCP/connector settings. The server is stdio-only; no ports,
no network.

## Try it

Ask your agent:

> Profile ./AGENTS.md with doc2toon before reading it — is TOON worth it?

The agent calls `profile`, gets a verdict like `split_first` with measured deltas and coded
warnings, and can decide **before** spending context. If the verdict is `convert`, a
follow-up `convert` call returns the payload; if it is `split_first`, the `plan` tool says
which sections independently earn conversion and what the net hybrid saves.

## Pinning

Pin the published package line (`doc2toon-mcp@0.4.x`), never `latest`: the verdict schema is
frozen per 1.x versioning rules, but pinning keeps your tool behavior reproducible anyway.
