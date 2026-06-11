#!/usr/bin/env node
// Reproducible honesty benchmark: converts every Markdown fixture and example in
// both lossless and record mode, and prints measured deltas with TOON's losses
// listed first. CheapAgent never claims TOON always saves tokens; this script is
// the receipt.
//
// "Win" means the engine's own verdict says convert — the same buildVerdict every
// surface calls, including the savings band (sub-band positive deltas are not
// wins) and the content-coverage check (record-mode runs that drop content fire
// low_coverage and cannot receive convert — docs/verdict-schema-v1.md).
//
// Usage: npm run build && node scripts/benchmark-honesty.mjs [--json]

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVerdict, convertTextToToon, NODE_TOKEN_ESTIMATOR_ID } from "../dist/index.js";
import { estimateNodeTokenCount } from "../dist/node-token-estimator.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const targets = ["fixtures", "examples"];

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

function measure(text, mode) {
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
  return {
    profile: result.profile.name,
    toon: result.toon,
    source_chars: result.stats.sourceChars,
    toon_chars: result.stats.toonChars,
    char_savings_pct: result.stats.charSavingsPercent,
    source_tokens: result.stats.sourceTokens,
    toon_tokens: result.stats.toonTokens,
    token_savings_pct: result.stats.tokenSavingsPercent,
    warning_codes: [...new Set(verdict.warnings.map((warning) => warning.code))],
    verdict: verdict.verdict,
    safe_to_auto_apply: verdict.safe_to_auto_apply,
  };
}

const files = targets
  .flatMap((dir) => collectMarkdownFiles(join(root, dir)))
  .sort();

const rows = [];
for (const file of files) {
  const rel = relative(root, file).replaceAll("\\", "/");
  try {
    const text = readFileSync(file, "utf8");
    const lossless = measure(text, "lossless");
    const record = measure(text, "record");
    rows.push({
      file: rel,
      profile: lossless.profile,
      source_chars: lossless.source_chars,
      lossless: {
        toon_chars: lossless.toon_chars,
        char_savings_pct: lossless.char_savings_pct,
        source_tokens: lossless.source_tokens,
        toon_tokens: lossless.toon_tokens,
        token_savings_pct: lossless.token_savings_pct,
        verdict: lossless.verdict,
        safe_to_auto_apply: lossless.safe_to_auto_apply,
      },
      record: {
        toon_chars: record.toon_chars,
        char_savings_pct: record.char_savings_pct,
        token_savings_pct: record.token_savings_pct,
        verdict: record.verdict,
        safe_to_auto_apply: record.safe_to_auto_apply,
      },
      mode_invariant: lossless.toon === record.toon,
      warning_codes: lossless.warning_codes,
      // A win is the engine's own call, not a sign bit: verdict === "convert" applies the
      // savings band, so a sub-band positive delta is honestly not a win.
      toon_wins_lossless: lossless.verdict === "convert",
    });
  } catch (error) {
    rows.push({ file: rel, error: error instanceof Error ? error.message : String(error) });
  }
}

// Losses first: that is the point of the exercise.
rows.sort((a, b) => (a.lossless?.char_savings_pct ?? 0) - (b.lossless?.char_savings_pct ?? 0));

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ estimator: NODE_TOKEN_ESTIMATOR_ID, rows }, null, 2)}\n`);
  process.exit(0);
}

const pct = (value) => `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(1)}%`;
const headers = ["file", "profile", "src chars", "lossless Δ", "record Δ", "warnings", "verdict (lossless)"];
const table = rows.map((row) =>
  row.error
    ? [row.file, "-", "-", "-", "-", "-", `ERROR: ${row.error}`]
    : [
        row.file,
        row.profile,
        String(row.source_chars),
        pct(row.lossless.char_savings_pct),
        row.mode_invariant ? "(same)" : pct(row.record.char_savings_pct),
        row.warning_codes.length > 0 ? row.warning_codes.join(",") : "-",
        row.toon_wins_lossless ? "convert (toon wins)" : row.lossless.verdict,
      ],
);

const widths = headers.map((header, i) => Math.max(header.length, ...table.map((r) => r[i].length)));
const renderRow = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ");

console.log("Honesty benchmark — measured per input, losses first.");
console.log("A win is the engine's own verdict (convert), savings band included: a sub-band positive");
console.log("delta is honestly not a win. Record-mode content coverage is measured per run; runs that");
console.log("drop content fire low_coverage and cannot earn convert (docs/verdict-schema-v1.md, decision 12).");
console.log("Token estimates: tokenx (advisory). Decisions use measured chars.\n");
console.log(renderRow(headers));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const row of table) {
  console.log(renderRow(row));
}

const measured = rows.filter((row) => !row.error);
const losses = measured.filter((row) => !row.toon_wins_lossless);
console.log(
  `\n${measured.length} documents measured (lossless): the verdict says convert on ${measured.length - losses.length}, not on ${losses.length}.`,
);
if (losses.length > 0) {
  const worst = losses[0];
  console.log(`Worst case: ${worst.file} (${pct(worst.lossless.char_savings_pct)} chars). That is why the verdict exists.`);
}
