#!/usr/bin/env node
// Actionable-plan-rate runner — the §5 pre-registered metric of docs/context-plan-design.md
// (metric definition + corpus pins recorded in fixtures/agent-context/external/README.md
// BEFORE any plan code existed; this script only measures what was pre-registered).
//
// Denominators: the internal 19 (verified against the pinned SHA-256 table in the external
// README — drift aborts the run) and the external lane-1 19 (fetched at the exact manifest
// SHAs, pointers recorded-not-counted, same as the honesty runner). Each document runs through
// the published CLI surface: `doc2toon plan --json` (lossless-only v1 plans). Measurements and
// provenance are stored; bodies and TOON candidates are not (external intake amendment).
//
// The metric (frozen): actionable-plan rate = share of counted documents whose plan recommends
// a hybrid (recommend_hybrid: net savings, splice overhead included, >= the frozen 5% band with
// every converted section independently earning `convert`). Secondary: median net savings among
// plan-positive docs; plan-level safe_to_auto_apply count. Whatever falls out is published.
//
// Usage: node scripts/benchmark-plans.mjs   (requires a fresh `npm run build`)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const externalDir = join(root, "fixtures", "agent-context", "external");
const manifest = JSON.parse(readFileSync(join(externalDir, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const cli = join(root, "dist", "cli.js");

// Same pointer rule as the honesty runner: delegation files are evidence, never documents.
const POINTER_MAX_CHARS = 256;
const isPointer = (text) => {
  const trimmed = text.trim();
  return trimmed.length <= POINTER_MAX_CHARS && /\b[\w./-]+\.md\b/i.test(trimmed);
};

function runPlanJson(file) {
  return JSON.parse(execFileSync(process.execPath, [cli, "plan", "--json", file], { encoding: "utf8" }));
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// The internal pin table is parsed from the pre-registration document itself, so the script
// verifies against the recorded amendment rather than a second copy of the hashes.
function readInternalPins() {
  const readme = readFileSync(join(externalDir, "README.md"), "utf8");
  const section = readme.split("## Amendment 2026-06-11 (internal corpus pinned")[1];
  if (!section) {
    throw new Error("Internal-corpus pin amendment not found in the external README.");
  }
  const pins = [];
  for (const match of section.matchAll(/\| `([^`]+\.md)` \| `([0-9a-f]{64})` \|/g)) {
    pins.push({ path: match[1], sha256: match[2] });
  }
  if (pins.length !== 19) {
    throw new Error(`Expected 19 pinned internal files, found ${pins.length}.`);
  }
  return pins;
}

function summarizePlan(verdict) {
  const plan = verdict.context_plan;
  const converted = plan.sections.filter((section) => section.action === "convert");
  return {
    verdict: verdict.verdict,
    schema_version: verdict.schema_version,
    sections: plan.sections.length,
    converted_sections: converted.map((section) => ({
      heading: section.heading,
      kind: section.kind,
      profile: section.profile,
      measured_chars: section.measured_chars,
      safe_to_auto_apply: section.safe_to_auto_apply,
    })),
    net: plan.net,
    recommend_hybrid: plan.recommend_hybrid,
    reassembly_verified: plan.reassembly_verified,
    plan_safe_to_auto_apply: plan.safe_to_auto_apply,
  };
}

function aggregate(entries) {
  const positive = entries.filter((entry) => entry.plan.recommend_hybrid);
  const positiveNets = positive.map((entry) => entry.plan.net.savings_pct).sort((a, b) => a - b);
  const median =
    positiveNets.length === 0
      ? null
      : positiveNets.length % 2 === 1
        ? positiveNets[(positiveNets.length - 1) / 2]
        : (positiveNets[positiveNets.length / 2 - 1] + positiveNets[positiveNets.length / 2]) / 2;
  return {
    documents_counted: entries.length,
    plan_positive: positive.length,
    actionable_plan_rate: `${positive.length}/${entries.length}`,
    median_net_savings_pct_plan_positive: median,
    plan_safe_to_auto_apply_true: entries.filter((entry) => entry.plan.plan_safe_to_auto_apply).length,
    reassembly_verified_all: entries.every((entry) => entry.plan.reassembly_verified),
    docs_with_any_converted_section: entries.filter((entry) => entry.plan.converted_sections.length > 0).length,
  };
}

// --- Internal 19 (pin-verified, measured in place) ---
const internal = [];
for (const pin of readInternalPins()) {
  const text = readFileSync(join(root, pin.path), "utf8");
  const actual = sha256(text);
  if (actual !== pin.sha256) {
    throw new Error(
      `Internal corpus drift: ${pin.path} hashes ${actual}, pinned ${pin.sha256}. ` +
        "The pre-registered measurement cannot run on drifted fixtures — re-pin via a new dated amendment first.",
    );
  }
  internal.push({
    path: pin.path,
    sha256: pin.sha256,
    source_chars: text.length,
    plan: summarizePlan(runPlanJson(join(root, pin.path))),
  });
}

// --- External lane-1 (fetched at the exact manifest pins; pointers recorded, not counted) ---
const external = [];
let pointersSkipped = 0;
const tmp = mkdtempSync(join(tmpdir(), "doc2toon-plan-metric-"));
try {
  for (const source of manifest.sources) {
    if ((source.lane ?? 1) !== 1) {
      continue; // lane 2 is a separate population and was never part of the pre-registered denominator
    }
    for (const f of source.files) {
      const rawUrl = `https://raw.githubusercontent.com/${source.repo}/${source.pinned_sha}/${f.path}`;
      const res = await fetch(rawUrl);
      if (!res.ok) {
        throw new Error(`Fetch failed (${res.status}) for ${rawUrl} — manifest pin may be stale.`);
      }
      const text = await res.text();
      if (isPointer(text)) {
        pointersSkipped += 1;
        continue;
      }
      const local = join(tmp, `${source.repo.replaceAll("/", "__")}__${f.path.replaceAll("/", "__")}`);
      writeFileSync(local, text);
      external.push({
        repo: source.repo,
        path: f.path,
        pinned_sha: source.pinned_sha,
        source_url: `https://github.com/${source.repo}/blob/${source.pinned_sha}/${f.path}`,
        license_note: source.license_note,
        retrieved: new Date().toISOString().slice(0, 10),
        source_chars: text.length,
        plan: summarizePlan(runPlanJson(local)),
      });
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const results = {
  generated: new Date().toISOString(),
  doc2toon_version: pkg.version,
  metric:
    "actionable_plan_rate — pre-registered 2026-06-11 in fixtures/agent-context/external/README.md and docs/context-plan-design.md §5, before any plan code existed. The whole-document honesty denominators are not restated or affected.",
  method:
    "Each pinned document measured via `doc2toon plan --json` (lossless-only v1 plans; sections are the author's own headings judged standalone under the unchanged frozen policy). Internal files verified against their pinned SHA-256 before measuring; external lane-1 files fetched at their exact manifest SHAs. Measurements and provenance stored; bodies and TOON candidates are not.",
  aggregate: {
    internal: aggregate(internal),
    external_lane1: aggregate(external),
    combined: aggregate([...internal, ...external]),
    external_pointers_recorded_not_counted: pointersSkipped,
  },
  documents: { internal, external_lane1: external },
};
writeFileSync(join(externalDir, "plan-results.json"), JSON.stringify(results, null, 2) + "\n");

const pad = (v, n) => String(v).padEnd(n);
console.log(`Actionable-plan rate — doc2toon ${pkg.version}, measured ${results.generated.slice(0, 10)}`);
for (const [label, entries] of [
  ["internal (pinned 19)", internal],
  ["external lane-1 (pinned)", external],
]) {
  console.log(`\n=== ${label} ===`);
  console.log(`${pad("document", 56)} ${pad("sections", 9)} ${pad("convert", 8)} ${pad("net Δ", 8)} ${pad("recommend", 10)} safe`);
  console.log("-".repeat(100));
  for (const entry of entries) {
    const name = entry.repo ? `${entry.repo}:${entry.path}` : entry.path;
    console.log(
      `${pad(name, 56)} ${pad(entry.plan.sections, 9)} ${pad(entry.plan.converted_sections.length, 8)} ${pad(`${entry.plan.net.savings_pct.toFixed(1)}%`, 8)} ${pad(entry.plan.recommend_hybrid, 10)} ${entry.plan.plan_safe_to_auto_apply}`,
    );
  }
}
for (const [label, agg] of Object.entries(results.aggregate)) {
  if (label === "external_pointers_recorded_not_counted") {
    continue;
  }
  console.log(
    `\n${label}: ${agg.actionable_plan_rate} plan-positive` +
      (agg.median_net_savings_pct_plan_positive !== null
        ? `, median net ${agg.median_net_savings_pct_plan_positive.toFixed(1)}%`
        : "") +
      `, ${agg.plan_safe_to_auto_apply_true} safe-to-auto-apply, ${agg.docs_with_any_converted_section} docs with >=1 converting section`,
  );
}
