import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import { buildContextPlan, runVerdict } from "../src/index.js";
import { estimateNodeTokenCount, NODE_TOKEN_ESTIMATOR_ID } from "../src/node-token-estimator.js";

// Exercises the exit-code and output contract of decision 8 (docs/verdict-schema-v1.md) against
// the built CLI: vitest spawns dist/cli.js so this runs on the Windows dev machine, unlike the
// bash smoke. CI builds before testing; locally, run `npm run build` first.

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "cli.js");
const tmpDir = join(root, "tmp", "cli-tests");

const schema = JSON.parse(readFileSync(join(root, "schemas", "verdict.v1.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true });
const validateVerdict = ajv.compile(schema);

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], input?: string): CliRun {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    input,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function parseVerdict(run: CliRun): Record<string, unknown> {
  const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
  expect(validateVerdict(parsed)).toBe(true);
  expect(validateVerdict.errors ?? []).toEqual([]);
  return parsed;
}

beforeAll(() => {
  if (!existsSync(cli)) {
    throw new Error("dist/cli.js not found — run `npm run build` before `npm test`.");
  }
  // A stale dist silently green-lights old CLI behavior (the suite spawns the build, not src/).
  const distMtime = statSync(cli).mtimeMs;
  const newerSource = collectSourceFiles(join(root, "src")).find((file) => statSync(file).mtimeMs > distMtime);
  if (newerSource) {
    throw new Error(`dist/cli.js is older than ${newerSource} — run \`npm run build\` before \`npm test\`.`);
  }
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
});

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("profile --json", () => {
  it("emits a schema-valid verdict with the candidate withheld, exit 0", () => {
    const run = runCli(["profile", "--json", "fixtures/agent-context/realistic/AGENTS.md"]);

    expect(run.status).toBe(0);
    const verdict = parseVerdict(run);
    expect(verdict.verdict).toBe("keep_markdown");
    expect(verdict.toon_candidate).toBeNull();
    expect((verdict.token_estimates as { estimator: string }).estimator).toBe(NODE_TOKEN_ESTIMATOR_ID);
  });

  it("deep-equals the library's runVerdict for the same input (one buildVerdict everywhere)", () => {
    const fixture = "fixtures/agent-context/realistic/CLAUDE.md";
    const run = runCli(["profile", "--json", fixture]);
    expect(run.status).toBe(0);

    const text = readFileSync(join(root, fixture), "utf8");
    const expected = runVerdict(text, {
      sourceType: "markdown",
      flavor: "markdown",
      mode: "lossless",
      charsPerTokenRatios: [3.5, 4, 4.5],
      estimateTokenCount: estimateNodeTokenCount,
      estimator: NODE_TOKEN_ESTIMATOR_ID,
      includeToonCandidate: false,
    });

    expect(JSON.parse(run.stdout)).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  it("keeps stdout pure JSON when a deprecated mode alias warns on stderr (convert)", () => {
    const run = runCli(
      ["convert", "--json", "--mode", "lossless-doc", "examples/definitions.md"],
    );

    expect(run.status).toBe(0);
    expect(run.stderr).toContain("deprecated");
    parseVerdict(run); // throws if stdout is not pure JSON
  });
});

describe("convert --json", () => {
  it("returns the verdict with toon_candidate and writes nothing without --out", () => {
    const run = runCli(["convert", "--json", "fixtures/agent-context/realistic/config-reference.md"]);

    expect(run.status).toBe(0);
    const verdict = parseVerdict(run);
    expect(verdict.verdict).toBe("convert");
    expect(verdict.safe_to_auto_apply).toBe(true);
    expect(verdict.toon_candidate).toBeTypeOf("string");
  });

  it("writes the .toon file when --out is given and keeps stdout pure JSON", () => {
    const outPath = join(tmpDir, "config-reference.toon");
    const run = runCli([
      "convert",
      "--json",
      "fixtures/agent-context/realistic/config-reference.md",
      "--out",
      outPath,
    ]);

    expect(run.status).toBe(0);
    const verdict = parseVerdict(run);
    expect(run.stderr).toContain("TOON written");
    const written = readFileSync(outPath, "utf8");
    expect(written).toBe(`${(verdict.toon_candidate as string).trimEnd()}\n`);
  });

  it("represents budget refusal in-band: exit 0, verdict refused, no file written", () => {
    const outPath = join(tmpDir, "refused.toon");
    const run = runCli([
      "convert",
      "--json",
      "examples/prose.md",
      "--mode",
      "budget",
      "--target-chars",
      "10",
      "--out",
      outPath,
    ]);

    expect(run.status).toBe(0);
    const verdict = parseVerdict(run);
    expect(verdict.verdict).toBe("refused");
    expect(verdict.toon_candidate).toBeNull();
    expect(verdict.delimiter).toBeNull();
    expect((verdict.warnings as Array<{ code: string }>).map((warning) => warning.code)).toContain(
      "budget_refused",
    );
    expect(existsSync(outPath)).toBe(false);
  });

  it("codes a lossy budget run and still exits 0 (the verdict is the product)", () => {
    const run = runCli([
      "convert",
      "--json",
      "examples/prose.md",
      "--mode",
      "budget",
      "--target-chars",
      "1000",
      "--allow-lossy",
    ]);

    expect(run.status).toBe(0);
    const verdict = parseVerdict(run);
    const codes = (verdict.warnings as Array<{ code: string }>).map((warning) => warning.code);
    expect(codes).toContain("lossy_applied");
    expect((verdict.flags as { lossless: boolean }).lossless).toBe(false);
  });

  it("still requires --out without --json (pretty back-compat)", () => {
    const run = runCli(["convert", "examples/prose.md"]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Missing --out");
  });

  it("pretty mode still writes the file, reports, and exits 0", () => {
    const outPath = join(tmpDir, "prose.toon");
    const run = runCli(["convert", "examples/prose.md", "--mode", "lossless", "--out", outPath]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Verdict: keep_markdown");
    expect(run.stdout).toContain("TOON written");
    expect(existsSync(outPath)).toBe(true);
  });

  it("pretty mode keeps the budget refusal as an error with exit 1 (back-compat)", () => {
    const outPath = join(tmpDir, "refused-pretty.toon");
    const run = runCli([
      "convert",
      "examples/prose.md",
      "--mode",
      "budget",
      "--target-chars",
      "10",
      "--out",
      outPath,
    ]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Target cannot be reached losslessly");
    expect(existsSync(outPath)).toBe(false);
  });
});

describe("plan --json (Verdict 1.1, docs/context-plan-design.md)", () => {
  const fixture = "fixtures/agent-context/problematic/mixed-agent-context.md";

  it("emits schema 1.1 with context_plan, candidate withheld, exit 0", () => {
    const run = runCli(["plan", "--json", fixture]);

    expect(run.status).toBe(0);
    const verdict = parseVerdict(run);
    expect(verdict.schema_version).toBe("1.1");
    expect(verdict.toon_candidate).toBeNull();
    const plan = verdict.context_plan as {
      sections: Array<{ action: string }>;
      recommend_hybrid: boolean;
      reassembly_verified: boolean;
      safe_to_auto_apply: boolean;
    };
    expect(plan.sections.length).toBeGreaterThan(1);
    expect(plan.sections.some((section) => section.action === "convert")).toBe(true);
    expect(plan.reassembly_verified).toBe(true);
    // Below-band net on this fixture: one table wins standalone, the plan still says keep.
    expect(plan.recommend_hybrid).toBe(false);
    expect(plan.safe_to_auto_apply).toBe(false);
  });

  it("deep-equals the library's buildContextPlan for the same input (one builder everywhere)", () => {
    const run = runCli(["plan", "--json", fixture]);
    expect(run.status).toBe(0);

    const text = readFileSync(join(root, fixture), "utf8");
    const expected = buildContextPlan(text, {
      sourceType: "markdown",
      flavor: "markdown",
      charsPerTokenRatios: [3.5, 4, 4.5],
      estimateTokenCount: estimateNodeTokenCount,
      estimator: NODE_TOKEN_ESTIMATOR_ID,
    });

    expect(JSON.parse(run.stdout)).toEqual(JSON.parse(JSON.stringify(expected.verdict)));
  });

  it("profile and convert stay schema 1.0 without context_plan (emission contract)", () => {
    for (const command of [
      ["profile", "--json", fixture],
      ["convert", "--json", fixture],
    ]) {
      const run = runCli(command);
      expect(run.status).toBe(0);
      const verdict = JSON.parse(run.stdout) as Record<string, unknown>;
      expect(verdict.schema_version).toBe("1.0");
      expect("context_plan" in verdict).toBe(false);
    }
  });

  it("--out writes the library's exact hybrid bytes with stdout staying pure JSON", () => {
    const outPath = join(tmpDir, "mixed-hybrid.md");
    const run = runCli(["plan", "--json", fixture, "--out", outPath]);

    expect(run.status).toBe(0);
    parseVerdict(run);
    expect(run.stderr).toContain("Hybrid written");

    const text = readFileSync(join(root, fixture), "utf8");
    const expected = buildContextPlan(text, {
      sourceType: "markdown",
      flavor: "markdown",
      charsPerTokenRatios: [3.5, 4, 4.5],
      estimateTokenCount: estimateNodeTokenCount,
      estimator: NODE_TOKEN_ESTIMATOR_ID,
    });
    expect(readFileSync(outPath, "utf8")).toBe(expected.hybrid);
  });

  it("pretty mode prints the plan table and exits 0", () => {
    const run = runCli(["plan", fixture]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Verdict: split_first");
    expect(run.stdout).toContain("Context plan");
    expect(run.stdout).toContain("net (hybrid vs source, splice overhead included)");
    expect(run.stdout).toContain("recommend hybrid: false");
  });

  it("--fail-on keys on the whole-document verdict (plans inform, the verdict gates)", () => {
    const gated = runCli(["plan", "--json", "--fail-on", "split_first", fixture]);
    expect(gated.status).toBe(1);
    parseVerdict(gated); // the verdict JSON still prints; --fail-on only decides the exit code

    const clean = runCli([
      "plan",
      "--json",
      "--fail-on",
      "warning",
      "fixtures/agent-context/realistic/config-reference.md",
    ]);
    expect(clean.status).toBe(0);
    const verdict = parseVerdict(clean);
    expect((verdict.context_plan as { safe_to_auto_apply: boolean }).safe_to_auto_apply).toBe(true);
  });
});

describe("--fail-on", () => {
  it("exits 1 on a matched verdict while still printing the verdict JSON", () => {
    const run = runCli([
      "profile",
      "--json",
      "--fail-on",
      "keep_markdown",
      "fixtures/agent-context/realistic/AGENTS.md",
    ]);

    expect(run.status).toBe(1);
    const verdict = parseVerdict(run);
    expect(verdict.verdict).toBe("keep_markdown");
  });

  it("severity threshold: warning matches warning-severity warnings", () => {
    const run = runCli([
      "profile",
      "--json",
      "--fail-on",
      "warning",
      "fixtures/agent-context/realistic/AGENTS.md",
    ]);
    expect(run.status).toBe(1);
  });

  it("exits 0 when nothing matches (clean convert case)", () => {
    const run = runCli([
      "profile",
      "--json",
      "--fail-on",
      "warning,refused",
      "fixtures/agent-context/realistic/config-reference.md",
    ]);
    expect(run.status).toBe(0);
  });

  // Known coverage gap: "info" vs "warning" threshold distinguishability needs a verdict whose
  // warnings are info-severity ONLY. No corpus fixture produces one, and synthesizing one is
  // blocked by the profiler: any doc that fires split_candidate/long_section (the info codes)
  // alongside positive savings flips to the mixed profile and gains a warning-severity
  // negative_savings (open question 7's phantom-rule extraction is part of why). The two pins
  // below bound the info clause from both sides; the distinguishing case lands when the
  // profiler precision work does.
  it("--fail-on info passes a verdict with zero warnings", () => {
    const run = runCli([
      "profile",
      "--json",
      "--fail-on",
      "info",
      "fixtures/agent-context/realistic/config-reference.md",
    ]);
    expect(run.status).toBe(0);
  });

  it("--fail-on info fails a verdict with any warning present", () => {
    const run = runCli([
      "profile",
      "--json",
      "--fail-on",
      "info",
      "fixtures/agent-context/realistic/AGENTS.md",
    ]);
    expect(run.status).toBe(1);
  });

  it("rejects unknown values with a bad_request envelope", () => {
    const run = runCli(["profile", "--json", "--fail-on", "bogus", "examples/prose.md"]);

    expect(run.status).toBe(1);
    const envelope = JSON.parse(run.stdout) as { error: { code: string } };
    expect(envelope.error.code).toBe("bad_request");
  });
});

describe("validate --json", () => {
  it("returns valid:true with error:null, exit 0", () => {
    const outPath = join(tmpDir, "validate-me.toon");
    runCli(["convert", "examples/definitions.md", "--mode", "record", "--out", outPath]);

    const run = runCli(["validate", "--json", outPath]);
    expect(run.status).toBe(0);
    const result = JSON.parse(run.stdout) as { schema_version: string; valid: boolean; error: null };
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.schema_version).toMatch(/^1\.[0-9]+$/);
  });

  it("returns a coded invalid_toon error and keeps exit 1 (CI ergonomics)", () => {
    const writeBack = join(tmpDir, "invalid-mangled.toon");
    // A tabular header that declares two rows but provides one: the official decoder
    // enforces declared lengths, so this is structurally invalid TOON.
    const invalidToon = "defs[2]{id,term}:\n  d001,alpha\n";
    spawnSync(
      process.execPath,
      ["-e", "require('fs').writeFileSync(process.argv[1], process.argv[2])", writeBack, invalidToon],
      { encoding: "utf8" },
    );

    const run = runCli(["validate", "--json", writeBack]);
    expect(run.status).toBe(1);
    const result = JSON.parse(run.stdout) as { valid: boolean; error: { code: string } };
    expect(result.valid).toBe(false);
    expect(result.error.code).toBe("invalid_toon");
  });
});

describe("commander-level argument errors (decision 8 envelope)", () => {
  it("unknown option under --json: bad_request envelope on stdout, exit 1", () => {
    const run = runCli(["profile", "--json", "--bogus", "examples/prose.md"]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("unknown option");
    const envelope = JSON.parse(run.stdout) as { error: { code: string; message: string } };
    expect(envelope.error.code).toBe("bad_request");
    expect(envelope.error.message).toContain("--bogus");
  });

  it("missing required argument under --json: bad_request envelope, exit 1", () => {
    const run = runCli(["validate", "--json"]);

    expect(run.status).toBe(1);
    const envelope = JSON.parse(run.stdout) as { error: { code: string } };
    expect(envelope.error.code).toBe("bad_request");
  });

  it("unknown option without --json: stderr only, empty stdout, exit 1", () => {
    const run = runCli(["profile", "--bogus", "examples/prose.md"]);

    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("unknown option");
  });

  it("--help still exits 0 with usage on stdout", () => {
    const run = runCli(["--help"]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Usage:");
  });
});

describe("toon-doc wrapper bin (decision 7)", () => {
  it("warns on stderr through the dedicated bin and keeps stdout intact", () => {
    const wrapper = join(root, "dist", "cli-toon-doc.js");
    const result = spawnSync(process.execPath, [wrapper, "--version"], { cwd: root, encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("toon-doc command is deprecated");
    const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    expect(result.stdout.trim()).toBe(version);
  });
});

describe("--json-sidecar interactions", () => {
  it("rejects --json-sidecar without --out (bad_request)", () => {
    const run = runCli(["convert", "--json", "--json-sidecar", "examples/definitions.md"]);

    expect(run.status).toBe(1);
    const envelope = JSON.parse(run.stdout) as { error: { code: string; message: string } };
    expect(envelope.error.code).toBe("bad_request");
    expect(envelope.error.message).toContain("--json-sidecar");
  });

  it("writes the sidecar next to --out under --json with stdout staying pure JSON", () => {
    const outPath = join(tmpDir, "sidecar.toon");
    const run = runCli([
      "convert",
      "--json",
      "--json-sidecar",
      "examples/definitions.md",
      "--mode",
      "record",
      "--out",
      outPath,
    ]);

    expect(run.status).toBe(0);
    parseVerdict(run);
    expect(existsSync(outPath)).toBe(true);
    expect(existsSync(join(tmpDir, "sidecar.json"))).toBe(true);
  });
});

describe("error envelope and version", () => {
  it("missing --out fails before any input is read (flag checks precede ingestion)", () => {
    const run = runCli(["convert", "--stdin"], "# Doc\n\nBody that should never need to be consumed.\n");

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Missing --out");
  });

  it("missing input file: exit 1 with input_not_found", () => {
    const run = runCli(["profile", "--json", "no-such-file.md"]);

    expect(run.status).toBe(1);
    const envelope = JSON.parse(run.stdout) as { error: { code: string; message: string } };
    expect(envelope.error.code).toBe("input_not_found");
  });

  it("bad arguments: exit 1 with bad_request (budget without targets)", () => {
    const run = runCli(["convert", "--json", "examples/prose.md", "--mode", "budget"]);

    expect(run.status).toBe(1);
    const envelope = JSON.parse(run.stdout) as { error: { code: string } };
    expect(envelope.error.code).toBe("bad_request");
  });

  it("--version matches package.json", () => {
    const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    const run = runCli(["--version"]);

    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(version);
  });
});
