import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  buildContextPlan,
  CONTEXT_PLAN_SCHEMA_VERSION,
  decodeToJson,
  MIN_CONVERT_SAVINGS_PCT,
  runVerdict,
  splitPlanSections,
} from "../src/index.js";
import { estimateNodeTokenCount, NODE_TOKEN_ESTIMATOR_ID } from "../src/node-token-estimator.js";

// Context plans (docs/context-plan-design.md). The two properties everything hangs on:
// (1) §2.1 partition — section slices tile the source byte-for-byte; (2) policy composition —
// a section converts iff it would earn `convert` as a standalone document under the unchanged
// frozen policy, so plans introduce zero new tunable constants. The reassembly property test
// here is the §10 done-criterion: kept bytes identical, converted blocks decode as embedded,
// zero-convert hybrids equal the source exactly.

const root = fileURLToPath(new URL("..", import.meta.url));
const schema = JSON.parse(readFileSync(join(root, "schemas", "verdict.v1.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true });
const validateVerdict = ajv.compile(schema);

const planOptions = {
  sourceType: "markdown" as const,
  flavor: "markdown" as const,
  estimateTokenCount: estimateNodeTokenCount,
  estimator: NODE_TOKEN_ESTIMATOR_ID,
};

function collectMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
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

const fixtures = ["fixtures", "examples"]
  .flatMap((dir) => collectMarkdownFiles(join(root, dir)))
  .sort()
  .map((file) => ({
    name: relative(root, file).replaceAll("\\", "/"),
    text: readFileSync(file, "utf8"),
  }));

/** Independent extraction of the fenced TOON block from a converted segment (backreference pins the fence length). */
function extractEmbeddedToon(segmentText: string): string {
  const match = segmentText.match(/(?:^|\n)(`{3,})toon\n([\s\S]*?)\n\1(?:\r\n|\n|\r|$)/);
  expect(match, "converted segment must contain exactly one well-formed toon fence").not.toBeNull();
  return (match as RegExpMatchArray)[2];
}

describe("reassembly property over the fixture corpus (design §10)", () => {
  it("found the fixture corpus", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(16);
  });

  for (const fixture of fixtures) {
    it(`${fixture.name}: slices partition the source and the hybrid reassembles`, () => {
      // §2.1 partition property, re-proved independently of the engine's own assertion.
      const slices = splitPlanSections(fixture.text);
      expect(slices.map((slice) => slice.raw).join("")).toBe(fixture.text);
      let cursor = 0;
      for (const slice of slices) {
        expect(slice.charStart).toBe(cursor);
        cursor = slice.charEnd;
      }
      expect(cursor).toBe(fixture.text.length);

      const result = buildContextPlan(fixture.text, planOptions);
      const plan = result.plan;
      expect(result.verdict.schema_version).toBe(CONTEXT_PLAN_SCHEMA_VERSION);
      expect(result.verdict.context_plan).toBe(plan);
      expect(plan.reassembly_verified).toBe(true);
      expect(plan.net.hybrid).toBe(result.hybrid.length);

      // Wire ranges, not engine slices, drive the checks: kept bytes sit in the hybrid at the
      // exact reassembly position; converted blocks decode as embedded.
      let hybridCursor = 0;
      plan.sections.forEach((section, index) => {
        const segment = result.segments[index];
        expect(segment.sectionIndex).toBe(index);
        const sliceBytes = fixture.text.slice(section.range.char_start, section.range.char_end);
        if (section.action === "keep") {
          expect(segment.kind).toBe("raw");
          expect(segment.text).toBe(sliceBytes);
        } else {
          expect(segment.kind).toBe("converted");
          const embedded = extractEmbeddedToon(segment.text);
          expect(embedded).toBe(segment.toon);
          expect(() => decodeToJson(embedded)).not.toThrow();
          // The plan's numbers are the artifact's bytes.
          expect(embedded.length).toBe(section.measured_chars?.toon);
        }
        expect(result.hybrid.slice(hybridCursor, hybridCursor + segment.text.length)).toBe(segment.text);
        hybridCursor += segment.text.length;
      });
      expect(hybridCursor).toBe(result.hybrid.length);

      // A zero-convert plan's hybrid is the source, byte-for-byte.
      if (plan.sections.every((section) => section.action === "keep")) {
        expect(result.hybrid).toBe(fixture.text);
        expect(plan.net.savings).toBe(0);
        expect(plan.recommend_hybrid).toBe(false);
        expect(plan.safe_to_auto_apply).toBe(false);
      }

      // Wire validity: the 1.1 object validates against the published schema.
      const valid = validateVerdict(result.verdict);
      expect(validateVerdict.errors ?? []).toEqual([]);
      expect(valid).toBe(true);

      // Per-section evidence (QC): every measured section carries verdict + measured_chars,
      // keep actions included; only frontmatter is exempt and is always keep.
      for (const section of plan.sections) {
        if (section.kind === "frontmatter") {
          expect(section.verdict).toBeNull();
          expect(section.profile).toBeNull();
          expect(section.measured_chars).toBeNull();
          expect(section.action).toBe("keep");
        } else {
          expect(section.verdict).not.toBeNull();
          expect(section.profile).not.toBeNull();
          expect(section.measured_chars).not.toBeNull();
        }
      }

      expect(plan).toMatchSnapshot();
    });
  }
});

describe("policy composition (zero new constants)", () => {
  it("a section converts iff it would earn convert as a standalone document", () => {
    const text = readFileSync(
      join(root, "fixtures", "agent-context", "problematic", "mixed-agent-context.md"),
      "utf8",
    );
    const { plan } = buildContextPlan(text, planOptions);

    for (const section of plan.sections) {
      if (section.kind === "frontmatter") {
        continue;
      }
      const standalone = runVerdict(text.slice(section.range.char_start, section.range.char_end), {
        ...planOptions,
        mode: "lossless",
        includeToonCandidate: false,
      });
      expect(section.verdict).toBe(standalone.verdict);
      expect(section.measured_chars).toEqual(standalone.measured_chars);
      expect(section.safe_to_auto_apply).toBe(standalone.safe_to_auto_apply);
      expect(section.action).toBe(standalone.verdict === "convert" ? "convert" : "keep");
    }
  });

  it("the whole-document verdict half is runVerdict's own output, not a re-derivation", () => {
    const text = readFileSync(join(root, "fixtures", "agent-context", "realistic", "CLAUDE.md"), "utf8");
    const { verdict } = buildContextPlan(text, planOptions);
    const { context_plan: _plan, schema_version: _version, ...planRest } = verdict;
    const profileShaped = runVerdict(text, { ...planOptions, mode: "lossless", includeToonCandidate: false });
    const { schema_version: _profileVersion, ...profileRest } = profileShaped;

    expect(profileShaped.schema_version).toBe("1.0");
    expect(planRest).toEqual(profileRest);
  });

  it("below-band net keeps the honest answer even when one small table wins standalone (mixed fixture)", () => {
    const text = readFileSync(
      join(root, "fixtures", "agent-context", "problematic", "mixed-agent-context.md"),
      "utf8",
    );
    const { plan } = buildContextPlan(text, planOptions);

    const converted = plan.sections.filter((section) => section.action === "convert");
    expect(converted.length).toBe(1);
    expect(converted[0].heading).toBe("Table");
    expect(converted[0].measured_chars!.savings_pct).toBeGreaterThan(MIN_CONVERT_SAVINGS_PCT);
    expect(plan.net.savings).toBeGreaterThan(0);
    expect(plan.net.savings_pct).toBeLessThan(MIN_CONVERT_SAVINGS_PCT);
    expect(plan.recommend_hybrid).toBe(false);
    expect(plan.safe_to_auto_apply).toBe(false);
    expect(plan.reassembly_verified).toBe(true);
  });

  it("recommends and auto-applies when the net clears the frozen band (config-reference)", () => {
    const text = readFileSync(
      join(root, "fixtures", "agent-context", "realistic", "config-reference.md"),
      "utf8",
    );
    const { plan, hybrid } = buildContextPlan(text, planOptions);

    expect(plan.sections.some((section) => section.action === "convert")).toBe(true);
    expect(plan.net.savings_pct).toBeGreaterThanOrEqual(MIN_CONVERT_SAVINGS_PCT);
    expect(plan.recommend_hybrid).toBe(true);
    expect(plan.reassembly_verified).toBe(true);
    expect(plan.safe_to_auto_apply).toBe(true);
    // Splice overhead is counted: the hybrid is larger than the bare candidate but smaller than the source.
    expect(hybrid.length).toBeLessThan(text.length);
  });

  it("plan-level safety is non-vacuous: zero converted sections is never safe (QC)", () => {
    const text = readFileSync(join(root, "fixtures", "agent-context", "realistic", "CLAUDE.md"), "utf8");
    const { plan, hybrid } = buildContextPlan(text, planOptions);

    expect(plan.sections.every((section) => section.action === "keep")).toBe(true);
    expect(hybrid).toBe(text);
    expect(plan.net).toEqual({ source: text.length, hybrid: text.length, savings: 0, savings_pct: 0 });
    expect(plan.recommend_hybrid).toBe(false);
    expect(plan.reassembly_verified).toBe(true);
    expect(plan.safe_to_auto_apply).toBe(false);
  });
});

describe("section splitter (design §2.1)", () => {
  it("sections frontmatter as keep, never measured, byte-preserved", () => {
    const text = "---\ntitle: Skill\ntags: [a, b]\n---\n\n# Skill\n\nBody text here.\n";
    const slices = splitPlanSections(text);

    expect(slices[0].kind).toBe("frontmatter");
    expect(slices[0].heading).toBeNull();
    expect(slices[0].raw).toBe("---\ntitle: Skill\ntags: [a, b]\n---\n");
    expect(slices[0].lineStart).toBe(1);
    expect(slices[0].lineEnd).toBe(4);

    const { plan, hybrid } = buildContextPlan(text, planOptions);
    expect(plan.sections[0].kind).toBe("frontmatter");
    expect(plan.sections[0].action).toBe("keep");
    expect(plan.sections[0].verdict).toBeNull();
    expect(plan.sections[0].measured_chars).toBeNull();
    expect(hybrid.startsWith("---\ntitle: Skill\n")).toBe(true);
    expect(plan.reassembly_verified).toBe(true);
  });

  it("an unclosed leading --- is a thematic break, not frontmatter", () => {
    const text = "---\n\n# Heading\n\nBody.\n";
    const slices = splitPlanSections(text);
    expect(slices.every((slice) => slice.kind !== "frontmatter")).toBe(true);
    expect(slices[0].kind).toBe("preamble");
    expect(slices.map((slice) => slice.raw).join("")).toBe(text);
  });

  it("headings inside code fences are not boundaries (parser parity)", () => {
    const text = "# Real\n\n```bash\n# not a heading\necho hi\n```\n\n## Also real\n\nBody.\n";
    const slices = splitPlanSections(text);
    expect(slices.map((slice) => slice.heading)).toEqual(["Real", "Also real"]);
    expect(slices.map((slice) => slice.raw).join("")).toBe(text);
  });

  it("content before the first heading is a preamble section", () => {
    const text = "Intro line.\n\n# First\n\nBody.\n";
    const slices = splitPlanSections(text);
    expect(slices[0].kind).toBe("preamble");
    expect(slices[0].heading).toBeNull();
    expect(slices[0].raw).toBe("Intro line.\n\n");
    expect(slices[1].heading).toBe("First");
  });

  it("a document with no headings is one preamble section", () => {
    const text = "Just prose.\n\nMore prose.";
    const slices = splitPlanSections(text);
    expect(slices).toHaveLength(1);
    expect(slices[0].kind).toBe("preamble");
    expect(slices[0].raw).toBe(text);
  });

  it("handles a missing trailing newline and an empty document", () => {
    const text = "# A\n\nBody\n\n# B\n\nNo trailing newline";
    const slices = splitPlanSections(text);
    expect(slices.map((slice) => slice.raw).join("")).toBe(text);
    expect(slices.at(-1)?.charEnd).toBe(text.length);

    expect(splitPlanSections("")).toEqual([]);
  });

  it("partitions CRLF documents without re-encoding line endings", () => {
    const text = "# A\r\n\r\nBody one.\r\n\r\n## B\r\n\r\nBody two.\r\n";
    const slices = splitPlanSections(text);
    expect(slices.map((slice) => slice.raw).join("")).toBe(text);
    expect(slices[0].headingPartLength).toBe("# A\r\n".length);

    const { plan, hybrid } = buildContextPlan(text, planOptions);
    expect(plan.reassembly_verified).toBe(true);
    expect(hybrid).toBe(text); // nothing converts; CRLF preserved byte-for-byte
  });
});

describe("warning range offsetting (QC: whole-document coordinates)", () => {
  it("offsets a mid-document section's warning to the source's own line numbers", () => {
    const filler = "# Doc\n\n## Filler\n\nPlain text that says nothing operational.\n\n";
    const rules =
      "## Rules\n\n- Reviewers must check the changelog before merging.\n- Reviewers must check the changelog before merging.\n";
    const text = filler + rules;
    const { plan } = buildContextPlan(text, planOptions);

    const rulesSection = plan.sections.find((section) => section.heading === "Rules");
    expect(rulesSection).toBeDefined();
    const duplicate = rulesSection!.warnings.find((warning) => warning.code === "duplicate_rule");
    expect(duplicate?.range?.line_start).toBeDefined();

    const docLines = text.split("\n");
    const flaggedLine = docLines[(duplicate!.range!.line_start as number) - 1];
    expect(flaggedLine).toContain("Reviewers must check the changelog");
    // The flagged line sits inside the Rules section, not at a slice-relative position.
    expect(duplicate!.range!.line_start).toBeGreaterThanOrEqual(rulesSection!.range.line_start);
    expect(duplicate!.range!.line_end).toBeLessThanOrEqual(rulesSection!.range.line_end);
    // Char offsets point at the same evidence in the raw source.
    if (duplicate!.range!.char_start !== undefined && duplicate!.range!.char_end !== undefined) {
      expect(text.slice(duplicate!.range!.char_start, duplicate!.range!.char_end)).toContain(
        "Reviewers must check the changelog",
      );
    }
  });
});

describe("hybrid fence safety", () => {
  it("lengthens the fence past embedded backtick runs and still decodes", () => {
    const rows = Array.from({ length: 14 }, (_, index) => {
      return `| cmd${String(index).padStart(2, "0")} | \`\`\`run --fast\`\`\` | tool${index} ok |`;
    }).join("\n");
    const text = `# Commands\n\n| Name | Invocation | Note |\n| --- | --- | --- |\n${rows}\n`;
    const { plan, segments } = buildContextPlan(text, planOptions);

    const converted = segments.find((segment) => segment.kind === "converted");
    expect(converted, "fixture must convert for the fence test to bite").toBeDefined();
    expect(converted!.toon).toContain("```");

    const fenceMatch = converted!.text.match(/(`{3,})toon\n/);
    const longestRun = Math.max(...(converted!.toon!.match(/`+/g) ?? [""]).map((run) => run.length));
    expect(fenceMatch![1].length).toBeGreaterThan(longestRun);

    const embedded = extractEmbeddedToon(converted!.text);
    expect(embedded).toBe(converted!.toon);
    expect(() => decodeToJson(embedded)).not.toThrow();
    expect(plan.reassembly_verified).toBe(true);
  });
});
