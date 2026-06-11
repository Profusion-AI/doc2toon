#!/usr/bin/env node
// External honesty corpus runner (fixtures/agent-context/external/README.md).
//
// Reads the pinned manifest, fetches each third-party file at its exact commit SHA,
// measures it through the CLI's public --json surface, and stores measurements +
// provenance ONLY — bodies and derived TOON bodies are never written to the repo
// (intake contract amendment 2026-06-11: publish measurements, not copies).
//
// Pointer-only files (a CLAUDE.md containing just "@AGENTS.md") are recorded as
// linking-behavior evidence but never counted as benchmark documents.
//
// Usage: node scripts/benchmark-external.mjs   (requires a fresh `npm run build`)

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const externalDir = join(root, "fixtures", "agent-context", "external");
const manifest = JSON.parse(readFileSync(join(externalDir, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const cli = join(root, "dist", "cli.js");

// A pointer file delegates to another doc instead of carrying content: tiny, and it
// references some other .md file (agent docs usually, but biome's CLAUDE.md points at
// CONTRIBUTING.md — the pre-registered rule is about delegation, not the target's name).
const POINTER_MAX_CHARS = 256;
const isPointer = (text) => {
  const trimmed = text.trim();
  return trimmed.length <= POINTER_MAX_CHARS && /\b[\w./-]+\.md\b/i.test(trimmed);
};

function runCliJson(args, file) {
  try {
    return JSON.parse(execFileSync(process.execPath, [cli, ...args, file], { encoding: "utf8" }));
  } catch (error) {
    // Representable verdicts exit 0; exit 1 carries the {"error":{...}} envelope on stdout.
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch {
        // fall through to the original error
      }
    }
    throw error;
  }
}

const docs = [];
const tmp = mkdtempSync(join(tmpdir(), "doc2toon-external-"));
try {
  for (const source of manifest.sources) {
    for (const f of source.files) {
      const rawUrl = `https://raw.githubusercontent.com/${source.repo}/${source.pinned_sha}/${f.path}`;
      const res = await fetch(rawUrl);
      if (!res.ok) {
        throw new Error(`Fetch failed (${res.status}) for ${rawUrl} — manifest pin may be stale.`);
      }
      const text = await res.text();
      const entry = {
        repo: source.repo,
        lane: source.lane ?? 1,
        path: f.path,
        source_url: `https://github.com/${source.repo}/blob/${source.pinned_sha}/${f.path}`,
        pinned_sha: source.pinned_sha,
        license_note: source.license_note,
        retrieved: new Date().toISOString().slice(0, 10),
        original_eol: text.includes("\r\n") ? "crlf" : "lf",
        source_chars: text.length,
        pointer: isPointer(text),
      };

      if (f.expect && f.expect !== (entry.pointer ? "pointer" : "substantive")) {
        console.warn(
          `WARNING: ${source.repo}:${f.path} classified ${entry.pointer ? "pointer" : "substantive"} but manifest expects ${f.expect} — reconcile before publishing.`,
        );
      }
      if (entry.pointer) {
        entry.pointer_excerpt = text.trim().slice(0, 120);
        docs.push(entry);
        continue;
      }

      // Keep the upstream basename's extension so the CLI's type detection applies.
      const local = join(
        tmp,
        `${source.repo.replaceAll("/", "__")}__${f.path.replaceAll("/", "__")}`,
      );
      writeFileSync(local, text);

      const profile = runCliJson(["profile", "--json"], local);
      const convert = runCliJson(["convert", "--json"], local);

      entry.verdict = convert.verdict;
      entry.profile = convert.profile?.name ?? null;
      entry.safe_to_auto_apply = convert.safe_to_auto_apply;
      entry.mode = convert.mode;
      entry.measured_chars = convert.measured_chars;
      entry.token_estimates = convert.token_estimates;
      entry.warning_codes = (convert.warnings ?? []).map((w) => w.code);
      entry.flags = convert.flags;
      entry.toon_emitted = typeof convert.toon_candidate === "string" && convert.toon_candidate.length > 0;
      // Decision 9 sanity: profile and convert share one policy; a mismatch is a bug.
      entry.profile_verdict_matches_convert = profile.verdict === convert.verdict;
      entry.verdict_json = {
        ...convert,
        toon_candidate: null,
        $note: "toon_candidate stripped before storage — bodies and derived bodies are not kept",
      };
      docs.push(entry);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const laneAggregate = (lane) => {
  const counted = docs.filter((d) => !d.pointer && d.lane === lane);
  const verdicts = {};
  for (const d of counted) {
    verdicts[d.verdict] = (verdicts[d.verdict] ?? 0) + 1;
  }
  return {
    documents_counted: counted.length,
    verdicts,
    safe_to_auto_apply_true: counted.filter((d) => d.safe_to_auto_apply).length,
  };
};

const counted = docs.filter((d) => !d.pointer);
const results = {
  generated: new Date().toISOString(),
  doc2toon_version: pkg.version,
  method:
    "Each file fetched at its manifest-pinned commit SHA and measured via `doc2toon profile --json` and `doc2toon convert --json` (defaults: lossless mode). Measurements and provenance stored; source bodies and TOON candidates are not. Lane 1 (embedded repo docs) is the public headline aggregate; lane 2 (skill packs) is a separate population, reported separately and never merged into the lane-1 denominator.",
  aggregate: {
    lane1_embedded_repo_docs: laneAggregate(1),
    lane2_skill_packs: {
      ...laneAggregate(2),
      caveat:
        "Skill files carry YAML frontmatter, which the current profiler does not treat specially — inspect the per-document profile stats before citing lane-2 numbers publicly.",
    },
    pointers_recorded_not_counted: docs.length - counted.length,
  },
  documents: docs,
};
writeFileSync(join(externalDir, "results.json"), JSON.stringify(results, null, 2) + "\n");

const pad = (v, n) => String(v).padEnd(n);
console.log(`External honesty corpus — doc2toon ${pkg.version}, measured ${results.generated.slice(0, 10)}`);
for (const lane of [1, 2]) {
  const laneDocs = docs.filter((d) => d.lane === lane);
  if (laneDocs.length === 0) {
    continue;
  }
  console.log(`\n=== Lane ${lane}: ${lane === 1 ? "embedded repo docs (public denominator)" : "skill packs (separate population)"} ===`);
  console.log(`${pad("document", 56)} ${pad("profile", 13)} ${pad("Δ chars", 9)} ${pad("verdict", 14)} warnings`);
  console.log("-".repeat(114));
  for (const d of laneDocs) {
    const name = `${d.repo}:${d.path}`;
    if (d.pointer) {
      console.log(`${pad(name, 56)} ${pad("(pointer)", 13)} ${pad("—", 9)} ${pad("not counted", 14)} "${d.pointer_excerpt}"`);
      continue;
    }
    const delta = `${d.measured_chars.savings_pct.toFixed(1)}%`;
    console.log(
      `${pad(name, 56)} ${pad(d.profile, 13)} ${pad(delta, 9)} ${pad(d.verdict, 14)} ${d.warning_codes.join(",") || "-"}`,
    );
  }
  const agg = lane === 1 ? results.aggregate.lane1_embedded_repo_docs : results.aggregate.lane2_skill_packs;
  console.log("-".repeat(114));
  console.log(
    `lane ${lane}: ${agg.documents_counted} counted — ` +
      Object.entries(agg.verdicts)
        .map(([v, n]) => `${v}=${n}`)
        .join(", "),
  );
}
console.log(`\n${docs.length - counted.length} pointer files recorded across lanes, not counted.`);
