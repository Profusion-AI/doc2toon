import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { convertTextToToon, decodeToJsonText, profileText, validateToonText } from "../src/index.js";
import * as browserApi from "../src/browser.js";

describe("core library API", () => {
  it("converts raw text without filesystem or CLI orchestration", () => {
    const result = convertTextToToon({
      text: `# Definitions

## Evidence Receipt

Definition: A reviewer-readable record of workflow inputs, artifacts, gates, approvals, and limits.
Tags: evidence, workflow

## Review Gate

Definition: A point where a human confirms the next workflow step before execution.
Tags: review, approval

## Capability Boundary

Definition: The stated limit of what a tool can safely claim or perform.
Tags: safety, scope
`,
      flavor: "markdown",
      sourceType: "paste",
      mode: "record",
      delimiter: "\t",
      estimateTokenCount: (text) => Math.round(text.length / 4),
    });

    expect(result.valid).toBe(true);
    expect(result.profile.name).toBe("definitions");
    expect(result.lossless).toBe(true);
    expect(result.delimiter).toBe("\t");
    expect(result.toon).toContain("defs[3\t]");
    expect("defs" in result.canonicalJson ? result.canonicalJson.defs[0] : undefined).toMatchObject({
      id: "d001",
      term: "Evidence Receipt",
    });
  });

  it("profiles text without converting", () => {
    const profile = profileText("First paragraph.\n\nSecond paragraph.", {
      flavor: "text",
      sourceType: "paste",
    });

    expect(profile.name).toBe("raw_prose");
    expect(profile.sourceType).toBe("paste");
    expect(profile.sourceChars).toBeGreaterThan(0);
  });

  it("validates and decodes TOON without file paths", () => {
    const result = convertTextToToon({
      text: "| Term | Definition |\n| --- | --- |\n| TOON | Token-Oriented Object Notation |\n",
      flavor: "markdown",
      sourceType: "paste",
      mode: "lossless",
    });

    const validation = validateToonText(result.toon);

    expect(validation.valid).toBe(true);
    expect(decodeToJsonText(result.toon)).toEqual(result.decodedJson);
  });

  it("browser entrypoint exposes only reusable conversion functions", async () => {
    expect(browserApi.convertTextToToon).toBeTypeOf("function");
    expect(browserApi.profileText).toBeTypeOf("function");
    expect(browserApi.validateToonText).toBeTypeOf("function");

    const browserSource = await readFile(new URL("../src/browser.ts", import.meta.url), "utf8");
    expect(browserSource).not.toContain("node:fs");
    expect(browserSource).not.toContain("node:path");
    expect(browserSource).not.toContain("node:buffer");
    expect(browserSource).not.toContain("tokenx");
  });

  it("refuses impossible budget conversion unless lossy output is allowed", () => {
    expect(() =>
      convertTextToToon({
        text: "# Prose\n\nThis is mostly prose that cannot be losslessly squeezed into ten characters.",
        flavor: "markdown",
        sourceType: "paste",
        mode: "budget",
        targetChars: 10,
      }),
    ).toThrow("Target cannot be reached losslessly");
  });

  it("marks allowed budget output as lossy and target-aware", () => {
    const result = convertTextToToon({
      text: `# Prose

## Principle

The converter must tell the truth about token savings. This matters because prose-heavy documents cannot shrink below retained semantic text.

## Background

${"This paragraph is retained semantic prose, so lossless output cannot shrink below the actual words that must remain. ".repeat(25)}
`,
      flavor: "markdown",
      sourceType: "paste",
      mode: "budget",
      targetChars: 1000,
      allowLossy: true,
    });

    expect(result.valid).toBe(true);
    expect(result.lossless).toBe(false);
    expect(result.targetReached).toBe(false);
    expect(result.warnings).toContain("Output used semantic compression and is not lossless.");
    expect(result.warnings).toContain("Target was not reached; the budget is probably below the retained semantic payload.");
  });
});
