import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { profileText } from "../src/index.js";
import { analyzeOptimizerWarnings } from "../src/optimizer.js";
import { stableJson } from "../src/normalize.js";
import type { OptimizerWarningKind } from "../src/types.js";

const fixtureBase = new URL("../fixtures/agent-context/", import.meta.url);

async function readAgentFixture(path: string): Promise<string> {
  return readFile(new URL(path, fixtureBase), "utf8");
}

function warningKinds(markdown: string): OptimizerWarningKind[] {
  const profile = profileText(markdown, { flavor: "markdown", sourceType: "markdown" });
  return profile.optimizerWarnings.map((warning) => warning.kind);
}

describe("optimizer warning primitives", () => {
  it("detects exact duplicate rules with advisory evidence and location", async () => {
    const markdown = await readAgentFixture("problematic/duplicate-rules.md");
    const profile = profileText(markdown, { flavor: "markdown", sourceType: "markdown" });
    const duplicateWarnings = profile.optimizerWarnings.filter((warning) => warning.kind === "duplicate_rule");

    expect(duplicateWarnings).toHaveLength(2);
    expect(duplicateWarnings[0]).toMatchObject({
      id: "ow001",
      severity: "warning",
      message: 'Possible duplicate rule in "Build Gate".',
      evidence: "The converter must validate official TOON round trips before writing output.",
      lineStart: 7,
      lineEnd: 7,
    });
    expect(duplicateWarnings[0]?.suggestion).toContain("clearest action and scope");
  });

  it("detects near duplicate rules deterministically", () => {
    const profile = profileText(
      [
        "# Near Duplicate Rules",
        "",
        "## Build Gate",
        "",
        "- The converter must validate official TOON round trips before writing output.",
        "- The converter must validate the official TOON round trip before output is written.",
      ].join("\n"),
      { flavor: "markdown", sourceType: "markdown" },
    );

    const duplicateWarnings = profile.optimizerWarnings.filter((warning) => warning.kind === "duplicate_rule");
    expect(duplicateWarnings).toHaveLength(1);
    expect(duplicateWarnings[0]).toMatchObject({
      message: 'Possible duplicate rule in "Build Gate".',
      lineStart: 6,
    });
  });

  it("does not mark unrelated rules as duplicates", () => {
    const profile = profileText(
      [
        "# Focused Rules",
        "",
        "## Build Gate",
        "",
        "- The converter must validate official TOON round trips before writing output.",
        "- Public docs must avoid universal savings claims.",
        "- The reviewer must check profile output.",
        "- The reviewer must check conversion output.",
      ].join("\n"),
      { flavor: "markdown", sourceType: "markdown" },
    );

    expect(profile.optimizerWarnings.filter((warning) => warning.kind === "duplicate_rule")).toHaveLength(0);
  });

  it("detects vague rules without rewriting them", async () => {
    const markdown = await readAgentFixture("problematic/vague-rules.md");
    const profile = profileText(markdown, { flavor: "markdown", sourceType: "markdown" });
    const vagueWarnings = profile.optimizerWarnings.filter((warning) => warning.kind === "vague_rule");

    expect(vagueWarnings).toHaveLength(4);
    expect(vagueWarnings.map((warning) => warning.message)).toEqual([
      'Possibly vague instruction in "Operating Guidance".',
      'Possibly vague instruction in "Operating Guidance".',
      'Possibly vague instruction in "Operating Guidance".',
      'Possibly vague instruction in "Operating Guidance".',
    ]);
    expect(vagueWarnings[0]?.suggestion).toContain("verification step");
  });

  it("does not mark concrete rules as vague", () => {
    const profile = profileText(
      [
        "# Concrete Rule",
        "",
        "## Build Gate",
        "",
        "- The CLI must validate official TOON round trips before writing output.",
        "- The report should include measured character and token savings.",
      ].join("\n"),
      { flavor: "markdown", sourceType: "markdown" },
    );

    expect(profile.optimizerWarnings.filter((warning) => warning.kind === "vague_rule")).toHaveLength(0);
  });

  it("detects long sections as context-density risks", async () => {
    const markdown = await readAgentFixture("problematic/long-section.md");
    const profile = profileText(markdown, { flavor: "markdown", sourceType: "markdown" });
    const longWarning = profile.optimizerWarnings.find((warning) => warning.kind === "long_section");

    expect(longWarning).toMatchObject({
      severity: "info",
      message: 'Long section: "Always-On Review Procedure".',
      lineStart: 3,
    });
    expect(longWarning?.evidence).toContain("bullets");
    expect(longWarning?.suggestion).toContain("task-specific skill");
  });

  it("does not mark short sections as long", () => {
    const profile = profileText(
      [
        "# Short Section",
        "",
        "## Build Gate",
        "",
        "- The converter must validate official TOON round trips before writing output.",
        "- The report should include measured savings.",
      ].join("\n"),
      { flavor: "markdown", sourceType: "markdown" },
    );

    expect(profile.optimizerWarnings.filter((warning) => warning.kind === "long_section")).toHaveLength(0);
  });

  it("detects possible split candidates", async () => {
    const markdown = await readAgentFixture("problematic/split-candidate.md");
    const profile = profileText(markdown, { flavor: "markdown", sourceType: "markdown" });
    const splitWarning = profile.optimizerWarnings.find((warning) => warning.kind === "split_candidate");

    expect(splitWarning).toMatchObject({
      severity: "info",
      message: 'Possible split candidate: "Conversion, Release, Privacy, And UI Workflow".',
      lineStart: 3,
    });
    expect(splitWarning?.evidence).toContain("when reviewing conversion behavior");
    expect(splitWarning?.suggestion).toContain("focused skill file");
  });

  it("does not mark normal focused sections as split candidates", () => {
    const profile = profileText(
      [
        "# Focused Workflow",
        "",
        "## Build Validation",
        "",
        "When parser behavior changes, run the existing build, test, and smoke scripts.",
        "",
        "- The CLI must validate official TOON round trips before writing output.",
        "- The report should include measured savings.",
      ].join("\n"),
      { flavor: "markdown", sourceType: "markdown" },
    );

    expect(profile.optimizerWarnings.filter((warning) => warning.kind === "split_candidate")).toHaveLength(0);
  });

  it("handles mixed agent context and keeps output deterministic", async () => {
    const markdown = await readAgentFixture("problematic/mixed-agent-context.md");
    const profile = profileText(markdown, { flavor: "markdown", sourceType: "markdown" });
    const directWarnings = analyzeOptimizerWarnings(profile);

    expect(warningKinds(markdown)).toEqual(
      expect.arrayContaining(["duplicate_rule", "vague_rule", "long_section", "split_candidate"]),
    );
    expect(stableJson(profile.optimizerWarnings)).toBe(stableJson(directWarnings));
    for (const warning of profile.optimizerWarnings) {
      expect(warning.id).toMatch(/^ow\d{3}$/);
      expect(warning.message.length).toBeGreaterThan(0);
      expect(warning.suggestion.length).toBeGreaterThan(0);
      expect(warning.evidence?.length ?? 0).toBeGreaterThan(0);
      expect(warning.lineStart).toBeGreaterThan(0);
      expect(warning.charStart).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps clean AGENTS.md fixture low-noise", async () => {
    const markdown = await readAgentFixture("AGENTS.md");
    const profile = profileText(markdown, { flavor: "markdown", sourceType: "markdown" });

    expect(profile.optimizerWarnings.length).toBeLessThanOrEqual(1);
  });
});
