#!/usr/bin/env node
// Aggregation step for the doc2toon context-check Action (action.yml at repo root).
//
// Globs the consumer's doc files, runs the published CLI per file
// (`npx doc2toon@^0.3 profile --json [--fail-on ...]`), and emits every
// load-bearing output on channels that work on fork PRs (see
// docs/action-fork-pr-permissions.md): step summary, annotations, an artifact
// JSON, step outputs, and the gate flag. The comment body is written here too,
// but posting it is a separate best-effort step.
//
// The table renders verdict + warnings[].code counts + measured numbers from
// the Verdict v1 object — never prose, never re-derived judgment.

import { spawnSync } from "node:child_process";
import { appendFileSync, globSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Pin major.minor, never `latest`. The "0.3.x" range form is used instead of
// "^0.3" (identical semantics) because Windows spawns go through cmd.exe, where
// the caret is the escape character.
const CLI_SPEC = "doc2toon@0.3.x";
const ANNOTATION_CAP = 10; // runner caps warning annotations per step

const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
const outDir = process.env.RUNNER_TEMP || workspace;
const failOn = (process.env.INPUT_FAIL_ON || "").trim();
const globs = (process.env.INPUT_FILES || "")
  .split(/[\n,]/)
  .map((g) => g.trim())
  .filter(Boolean);

const setOutput = (key, value) => {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
};
const summary = (markdown) => {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
  }
};

const files = [...new Set(globs.flatMap((g) => globSync(g, { cwd: workspace })))]
  .map((f) => f.replaceAll("\\", "/"))
  .filter((f) => /\.(md|txt)$/i.test(f))
  .sort();

if (files.length === 0) {
  console.log(`::notice::doc2toon context check: no files matched (${globs.join(", ")}).`);
  summary(`## doc2toon context check\n\nNo files matched the configured globs (\`${globs.join("`, `")}\`).`);
  setOutput("matched", "0");
  setOutput("tripped", "false");
  process.exit(0);
}

// Windows: .cmd shims require a shell since Node's spawn hardening; quote any
// arg with spaces because cmd.exe re-parses the joined command line.
// cwd is the temp dir, NOT the workspace: npx resolves a matching local package
// name before the registry, so running inside a checkout of doc2toon itself
// (the dogfood case) would skip the published package. File paths are passed
// absolute for the same reason.
const useShell = process.platform === "win32";
const npx = useShell ? "npx.cmd" : "npx";
const runCli = (args) => {
  const finalArgs = ["-y", CLI_SPEC, ...args].map((a) => (useShell && /\s/.test(a) ? `"${a}"` : a));
  return spawnSync(npx, finalArgs, { cwd: outDir, encoding: "utf8", shell: useShell, maxBuffer: 64 * 1024 * 1024 });
};

const versionRun = runCli(["--version"]);
const engineVersion = versionRun.status === 0 ? versionRun.stdout.trim() : "unknown";

const records = [];
let tripped = false;
let hardFailure = null;

for (const file of files) {
  const args = ["profile", "--json"];
  if (failOn) {
    args.push("--fail-on", failOn);
  }
  args.push(join(workspace, file));
  const run = runCli(args);

  let parsed = null;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    const detail = run.error?.message || run.stderr || run.stdout || "no output";
    hardFailure = `CLI produced unparseable output for ${file} (exit ${run.status}): ${detail.slice(0, 400)}`;
    break;
  }

  if (parsed.error) {
    hardFailure = `doc2toon failed on ${file}: [${parsed.error.code}] ${parsed.error.message}`;
    break;
  }

  // Exit 1 with a parseable verdict means the CLI's own --fail-on gate tripped
  // (representable verdicts otherwise exit 0 — the exit-code contract).
  const fileTripped = run.status !== 0;
  tripped ||= fileTripped;

  const warningCounts = {};
  for (const warning of parsed.warnings ?? []) {
    warningCounts[warning.code] = (warningCounts[warning.code] ?? 0) + 1;
  }
  records.push({
    file,
    verdict: parsed.verdict,
    safe_to_auto_apply: parsed.safe_to_auto_apply,
    profile: parsed.profile?.name ?? null,
    measured_chars: parsed.measured_chars,
    warning_counts: warningCounts,
    warnings: (parsed.warnings ?? []).map(({ code, severity, message, range }) => ({ code, severity, message, range })),
    tripped: fileTripped,
    verdict_json: parsed,
  });
}

if (hardFailure) {
  console.log(`::error::${hardFailure}`);
  summary(`## doc2toon context check\n\n**Internal failure:** ${hardFailure}`);
  process.exit(1);
}

const fmtPct = (pct) => `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
const fmtWarnings = (counts) =>
  Object.entries(counts)
    .map(([code, n]) => (n > 1 ? `${code} ×${n}` : code))
    .join(", ") || "—";

const tableRows = records
  .map(
    (r) =>
      `| \`${r.file}\` | **${r.verdict}**${r.tripped ? " ❌" : ""} | ${fmtPct(r.measured_chars.savings_pct)} | ${fmtWarnings(r.warning_counts)} |`,
  )
  .join("\n");
const gateLine = failOn
  ? tripped
    ? `**Gate (\`--fail-on ${failOn}\`): ❌ tripped** by ${records.filter((r) => r.tripped).map((r) => `\`${r.file}\``).join(", ")}.`
    : `Gate (\`--fail-on ${failOn}\`): ✅ passed.`
  : "Gate: report-only (no `fail-on` configured).";

const body = [
  "<!-- doc2toon-context-check -->",
  "## doc2toon context check",
  "",
  "| file | verdict | measured Δ chars | warnings |",
  "|---|---|---|---|",
  tableRows,
  "",
  gateLine,
  "",
  `<sub>Measured by \`doc2toon ${engineVersion}\` \`profile --json\` (Verdict v1) — negative means TOON output would be larger than the source. [How the verdict works](https://cheapagent.ai/honesty.html).</sub>`,
].join("\n");

summary(body.replace("<!-- doc2toon-context-check -->\n", ""));

const commentPath = join(outDir, "doc2toon-comment.md");
writeFileSync(commentPath, body);
const resultsPath = join(outDir, "doc2toon-verdicts.json");
writeFileSync(
  resultsPath,
  JSON.stringify({ engine: `doc2toon ${engineVersion}`, fail_on: failOn || null, tripped, documents: records }, null, 2),
);

let emitted = 0;
for (const r of records) {
  for (const w of r.warnings) {
    if (emitted >= ANNOTATION_CAP) {
      break;
    }
    const loc = w.range?.line_start
      ? `file=${r.file},line=${w.range.line_start}${w.range.line_end ? `,endLine=${w.range.line_end}` : ""}`
      : `file=${r.file}`;
    console.log(`::warning ${loc},title=doc2toon ${w.code}::${w.message}`);
    emitted += 1;
  }
}
const totalWarnings = records.reduce((n, r) => n + r.warnings.length, 0);
if (totalWarnings > emitted) {
  console.log(`::notice::${totalWarnings - emitted} more doc2toon findings in the step summary.`);
}

setOutput("matched", String(records.length));
setOutput("tripped", String(tripped));
setOutput("results_path", resultsPath);
setOutput("comment_path", commentPath);
console.log(`doc2toon context check: ${records.length} file(s), tripped=${tripped} (gate evaluated in the final step).`);
