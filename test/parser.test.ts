import { describe, expect, it } from "vitest";
import {
  buildBudgetCanonical,
  buildCanonical,
  parseDocument,
  profileDocument,
} from "../src/parser.js";
import { decodeToJson, selectEncoding } from "../src/toon.js";
import { stableJson } from "../src/normalize.js";

const mixedMarkdown = `# Operating Framework

## Attention Intelligence

Definition: Ability to direct and protect human attention in AI-mediated environments.
Tags: attention, ai

## Rules

- The converter must validate round trips.
- The tool should report measured savings.
- Budget mode cannot claim lossless compression unless measurements prove it.

| Scope | Owner |
| --- | --- |
| Validation | CLI |
| Metrics | Reporter |

## Notes

This section provides prose context that should stay available without block-object scaffolding.
`;

describe("profile-first conversion", () => {
  it("uses section-level lossless output for prose-heavy Markdown instead of block objects", () => {
    const markdown = `# Attention Intelligence

Attention is not merely something users spend. It is a strategic substrate for learning and agency.

## Applications

In education, this can reshape how learners interact with AI tutors.
`;

    const profile = profileDocument(markdown, { sourceType: "markdown", flavor: "markdown" });
    const canonical = buildCanonical(profile, { mode: "lossless" });

    expect(profile.name).toBe("raw_prose");
    expect(canonical).toMatchObject({
      doc: {
        title: "Attention Intelligence",
        profile: "raw_prose",
        lossy: false,
      },
    });
    expect(JSON.stringify(canonical)).not.toContain("blocks");
    expect("sections" in canonical).toBe(true);
  });

  it("profiles glossary-style documents as definitions and emits compact defs records", () => {
    const markdown = `# Framework Definitions

## Attention Intelligence

Definition: Ability to direct, protect, and compound human attention in AI-mediated environments.
Example: A learner chooses when an AI tutor should explain versus quiz.
Tags: attention, ai, pedagogy

## Cognitive Surface Area

Definition: Total amount of mental context a user must hold to act effectively.
Tags: ux, learning

## Agentic Compression

Definition: Converting long context into compact structures an agent can reliably act on.
Type: method
`;

    const profile = profileDocument(markdown, { sourceType: "markdown", flavor: "markdown" });
    const canonical = buildCanonical(profile, { mode: "record" });
    const encoding = selectEncoding(canonical, "\t");

    expect(profile.name).toBe("definitions");
    expect("defs" in canonical ? canonical.defs[0] : undefined).toMatchObject({
      id: "d001",
      term: "Attention Intelligence",
      type: "concept",
      tags: "attention,ai,pedagogy",
    });
    expect(encoding.valid).toBe(true);
    expect(encoding.toon).toContain("defs[3\t]{id\tterm\ttype\tdef\tex\ttags}:");
    expect(stableJson(decodeToJson(encoding.toon))).toBe(stableJson(canonical));
  });

  it("uses rows for Markdown tables", () => {
    const markdown = `| Term | Definition |
| --- | --- |
| Attention | Directed focus |
| Compression | Reduced representation |
`;

    const profile = profileDocument(markdown, { sourceType: "markdown", flavor: "markdown" });
    const canonical = buildCanonical(profile, { mode: "lossless" });
    const encoding = selectEncoding(canonical, "auto");

    expect(profile.name).toBe("table");
    expect(canonical).toEqual({
      rows: [
        { term: "Attention", definition: "Directed focus" },
        { term: "Compression", definition: "Reduced representation" },
      ],
    });
    expect(encoding.valid).toBe(true);
    expect(encoding.toon).toContain("rows[2");
  });

  it("profiles repeated requirement language into rules records", () => {
    const markdown = `# Operating Rules

## Conversion

- The converter must use the official encoder.
- The converter should validate round trips.
- The tool cannot claim savings unless measurements prove it.
`;

    const profile = profileDocument(markdown, { sourceType: "markdown", flavor: "markdown" });
    const canonical = buildCanonical(profile, { mode: "record" });

    expect(profile.name).toBe("requirements");
    expect("rules" in canonical ? canonical.rules[0] : undefined).toMatchObject({
      id: "r001",
      scope: "Conversion",
      rule: "The converter must use the official encoder.",
    });
  });

  it("keeps mixed documents as compact typed arrays plus section context", () => {
    const profile = profileDocument(mixedMarkdown, { sourceType: "markdown", flavor: "markdown" });
    const canonical = buildCanonical(profile, { mode: "lossless" });

    expect(profile.name).toBe("mixed");
    expect(JSON.stringify(canonical)).not.toContain("blocks");
    expect("sections" in canonical ? canonical.sections?.length : 0).toBeGreaterThan(0);
    expect("defs" in canonical ? canonical.defs?.length : 0).toBeGreaterThan(0);
    expect("rules" in canonical ? canonical.rules?.length : 0).toBeGreaterThan(0);
    expect("rows" in canonical ? canonical.rows?.length : 0).toBeGreaterThan(0);
  });

  it("record mode keeps every detected record family for mixed documents", () => {
    const profile = profileDocument(mixedMarkdown, { sourceType: "markdown", flavor: "markdown" });
    const canonical = buildCanonical(profile, { mode: "record" });
    const encoding = selectEncoding(canonical, "auto");

    expect(profile.name).toBe("mixed");
    expect("doc" in canonical ? canonical.doc.profile : undefined).toBe("mixed");
    expect("defs" in canonical ? canonical.defs?.[0]?.term : undefined).toBe("Attention Intelligence");
    expect("rules" in canonical ? canonical.rules?.map((rule) => rule.rule) : []).toContain(
      "The converter must validate round trips.",
    );
    expect("rows" in canonical ? canonical.rows?.[0] : undefined).toEqual({ scope: "Validation", owner: "CLI" });
    expect("sections" in canonical ? canonical.sections?.some((section) => section.h === "Notes") : false).toBe(true);
    expect(encoding.valid).toBe(true);
  });

  it("marks budget output as lossy with target and coverage metadata", () => {
    const markdown = `# Framework

## Principle One

The converter must tell the truth about token savings. This matters because prose-heavy documents cannot shrink below their retained semantic text.

## Principle Two

Example: Use record extraction for definition-like documents. Caveat: do not claim lossless compression when semantic compression was used.
`;

    const profile = profileDocument(markdown, { sourceType: "markdown", flavor: "markdown" });
    const canonical = buildBudgetCanonical(profile, {
      targetChars: 200,
      targetTokens: null,
      maxSnippetChars: 90,
    });

    expect(canonical.doc.lossy).toBe(true);
    expect(canonical.doc.target_chars).toBe(200);
    expect(canonical.cov.length).toBeGreaterThan(0);
    expect(canonical.sections?.[0]?.pts).toContain("must tell the truth");
  });

  it("parseDocument keeps official round-trip compatibility", () => {
    const canonical = parseDocument(`# Terms

## Retrieval Usefulness

Definition: Whether the output helps an LLM find and apply the right source content.

## Budget Honesty

Definition: Whether measured output actually reaches the requested size.

## Compression Boundary

Definition: The line between syntactic compaction and semantic summarization.
`, {
      sourceType: "markdown",
      flavor: "markdown",
      mode: "record",
    });
    const encoding = selectEncoding(canonical, "auto");

    expect(encoding.valid).toBe(true);
    expect(stableJson(decodeToJson(encoding.toon))).toBe(stableJson(canonical));
  });
});
