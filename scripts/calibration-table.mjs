#!/usr/bin/env node
// Generates the verdict calibration table (docs/calibration-v1.md): every fixture plus the
// CheapAgent web samples, in lossless and record mode, with measured savings, content coverage,
// fired warning codes, and the resulting verdict. The committed table is the hand-verified
// snapshot of decision-policy behavior at the v1 freeze; snapshot tests pin the same behavior
// per fixture, so any threshold tune shows up in both.
//
// Usage: npm run build && node scripts/calibration-table.mjs [--json]

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildVerdict,
  convertTextToToon,
  measureContentCoverage,
  NODE_TOKEN_ESTIMATOR_ID,
} from "../dist/index.js";
import { estimateNodeTokenCount } from "../dist/node-token-estimator.js";

const root = fileURLToPath(new URL("..", import.meta.url));

// The CheapAgent web workbench samples (cheapagent-ai/src/main.js, `samples`), copied verbatim:
// open question 4 is whether web tabs and the wire agree about the same documents, so the web's
// own sample corpus belongs in the calibration set. The web's claude/agents/skill tabs default
// to record mode today; the toon tab is lossless.
const webSamples = [
  {
    name: "web-sample/claude (record tab)",
    text: `# CLAUDE.md\n\n## Build Gate\n\n- The converter must validate official TOON round trips before writing output.\n- The converter must validate the official TOON round trip before output is written.\n- Be careful and use good judgement.\n\n## Operating Guidance\n\nWhen reviewing conversion behavior, release behavior, privacy behavior, UI behavior, and test behavior, keep notes short and evidence-linked.\n\n- Make the output better where possible.\n- Report measured character and token savings.\n- Do not claim fixed savings percentages.\n`,
  },
  {
    name: "web-sample/agents (record tab)",
    text: `# AGENTS.md\n\n## Operating Standard\n\n- Start from current local truth before making claims.\n- Start from the current files before making claims.\n- Use common sense when handling ambiguous instructions.\n\n## Workflow\n\nWhen converting agent instructions, review parsing behavior, privacy posture, UI output, docs wording, release notes, and validation coverage.\n\n- Keep the canonical rule short.\n- Move detailed procedures into focused skill files when a section becomes overloaded.\n`,
  },
  {
    name: "web-sample/skill (record tab)",
    text: `# SKILL.md\n\n## Trigger\n\nUse this skill when agent context needs conversion, release prep, docs review, UI validation, privacy review, and testing in one pass.\n\n## Rules\n\n- The agent must validate official TOON round trips before writing output.\n- The agent must validate the official TOON round trip before output is written.\n- Optimize where appropriate.\n- Keep quality high.\n`,
  },
  {
    name: "web-sample/toon (lossless tab)",
    text: `# Definitions\n\n## Context Budget\n\nDefinition: The amount of context an agent has to carry before it can do the task.\nTags: context, tokens\n\n## Review Gate\n\nDefinition: A point where a human confirms the next workflow step before execution.\nTags: review, approval\n\n## Capability Boundary\n\nDefinition: The stated limit of what a tool can safely claim or perform.\nTags: safety, scope\n`,
  },
];

function collectMarkdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectMarkdownFiles(full));
    } else if (entry.toLowerCase().endsWith(".md") && entry.toLowerCase() !== "readme.md") {
      out.push(full);
    }
  }
  return out;
}

function measure(name, text, mode) {
  const result = convertTextToToon({
    text,
    sourceType: "markdown",
    flavor: "markdown",
    mode,
    delimiter: "auto",
    estimateTokenCount: estimateNodeTokenCount,
  });
  const verdict = buildVerdict(result, {
    estimator: NODE_TOKEN_ESTIMATOR_ID,
    includeToonCandidate: false,
  });
  const coverage = measureContentCoverage(result);
  return {
    name,
    mode,
    profile: verdict.profile.name,
    source_chars: verdict.measured_chars.source,
    savings_pct: verdict.measured_chars.savings_pct,
    coverage_pct: coverage === null ? null : Math.round(coverage * 100),
    warning_codes: [...new Set(verdict.warnings.map((warning) => warning.code))],
    verdict: verdict.verdict,
    safe_to_auto_apply: verdict.safe_to_auto_apply,
    toon: result.toon,
  };
}

const documents = [
  ...["fixtures", "examples"]
    .flatMap((dir) => collectMarkdownFiles(join(root, dir)))
    .sort()
    .map((file) => ({
      name: relative(root, file).replaceAll("\\", "/"),
      text: readFileSync(file, "utf8"),
    })),
  ...webSamples,
];

const rows = [];
for (const document of documents) {
  const lossless = measure(document.name, document.text, "lossless");
  const record = measure(document.name, document.text, "record");
  record.mode_invariant = record.toon === lossless.toon;
  rows.push(lossless, record);
}

if (process.argv.includes("--json")) {
  const clean = rows.map(({ toon: _toon, ...row }) => row);
  process.stdout.write(`${JSON.stringify({ estimator: NODE_TOKEN_ESTIMATOR_ID, rows: clean }, null, 2)}\n`);
  process.exit(0);
}

const pct = (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
const lines = [];
lines.push("| document | profile | mode | chars Δ | coverage | warnings | verdict | auto-apply |");
lines.push("|---|---|---|---|---|---|---|---|");
for (const row of rows) {
  lines.push(
    `| ${row.name} | ${row.profile} | ${row.mode}${row.mode_invariant ? " (= lossless)" : ""} | ${pct(row.savings_pct)} | ${row.coverage_pct === null ? "—" : `${row.coverage_pct}%`} | ${row.warning_codes.join(", ") || "—"} | **${row.verdict}** | ${row.safe_to_auto_apply ? "**true**" : "false"} |`,
  );
}
process.stdout.write(`${lines.join("\n")}\n`);
