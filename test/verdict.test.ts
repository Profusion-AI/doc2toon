import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  CHARS_PER_TOKEN_ESTIMATOR_ID,
  estimateTokensByChars,
  NODE_TOKEN_ESTIMATOR_ID,
  runVerdict,
} from "../src/index.js";
import { estimateNodeTokenCount } from "../src/node-token-estimator.js";

// The three sync mechanisms (docs/verdict-schema-v1.md): (1) every fixture's verdict validates
// against schemas/verdict.v1.json via ajv; (2) per-fixture snapshots pin the full verdict JSON so
// behavioral drift is a visible diff, never silent; (3) the estimator-parity test proves the
// decision fields cannot flip between the chars-per-token and tokenx estimators.

const root = fileURLToPath(new URL("..", import.meta.url));
const schema = JSON.parse(readFileSync(join(root, "schemas", "verdict.v1.json"), "utf8"));

const ajv = new Ajv2020({ allErrors: true });
const validateVerdict = ajv.compile(schema);

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

const fixtureFiles = ["fixtures", "examples"]
  .flatMap((dir) => collectMarkdownFiles(join(root, dir)))
  .sort();

const fixtures = fixtureFiles.map((file) => ({
  name: relative(root, file).replaceAll("\\", "/"),
  text: readFileSync(file, "utf8"),
}));

describe("verdict contract over fixtures (lossless mode)", () => {
  it("found the fixture corpus", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(16);
  });

  for (const fixture of fixtures) {
    it(`${fixture.name}: validates against schemas/verdict.v1.json and matches its snapshot`, () => {
      const verdict = runVerdict(fixture.text, {
        sourceType: "markdown",
        flavor: "markdown",
        // Profile-shaped: candidate withheld so snapshots pin decisions and measurements,
        // not megabytes of TOON payload. measured_chars.toon still pins the candidate size.
        includeToonCandidate: false,
      });

      const valid = validateVerdict(verdict);
      expect(validateVerdict.errors ?? []).toEqual([]);
      expect(valid).toBe(true);

      expect(verdict).toMatchSnapshot();
    });
  }
});

describe("estimator parity (decision 2: decisions never flip between estimators)", () => {
  for (const fixture of fixtures) {
    it(`${fixture.name}: verdict identical under chars-per-token and tokenx`, () => {
      const byChars = runVerdict(fixture.text, {
        sourceType: "markdown",
        flavor: "markdown",
        includeToonCandidate: false,
        estimateTokenCount: estimateTokensByChars,
        estimator: CHARS_PER_TOKEN_ESTIMATOR_ID,
      });
      const byTokenx = runVerdict(fixture.text, {
        sourceType: "markdown",
        flavor: "markdown",
        includeToonCandidate: false,
        estimateTokenCount: estimateNodeTokenCount,
        estimator: NODE_TOKEN_ESTIMATOR_ID,
      });

      expect(byTokenx.verdict).toBe(byChars.verdict);
      expect(byTokenx.safe_to_auto_apply).toBe(byChars.safe_to_auto_apply);
    });
  }
});

describe("verdict policy outcomes", () => {
  const uniformTable = `# Service ports

| Service | Port | Protocol | Owner |
| --- | --- | --- | --- |
| gateway | 8080 | http | platform |
| ledger | 8081 | http | billing |
| notifier | 8082 | http | platform |
| indexer | 8083 | http | search |
| archiver | 8084 | http | data |
| resolver | 8085 | http | platform |
| metering | 8086 | http | billing |
| webhooks | 8087 | http | integrations |
| importer | 8088 | http | data |
| exporter | 8089 | http | data |
| scheduler | 8090 | http | platform |
| reaper | 8091 | http | platform |
`;

  it("convert with safe_to_auto_apply for a clean uniform table win", () => {
    const verdict = runVerdict(uniformTable, { sourceType: "markdown", flavor: "markdown" });

    expect(verdict.verdict).toBe("convert");
    expect(verdict.safe_to_auto_apply).toBe(true);
    expect(verdict.warnings).toEqual([]);
    expect(verdict.measured_chars.savings).toBeGreaterThan(0);
    expect(verdict.flags.lossless).toBe(true);
    expect(verdict.flags.valid).toBe(true);
    expect(verdict.toon_candidate).toBeTypeOf("string");
    expect(verdict.flags.target_reached).toBeNull();

    expect(validateVerdict(verdict)).toBe(true);
  });

  it("profile surface withholds the candidate without changing the decision", () => {
    const full = runVerdict(uniformTable, { sourceType: "markdown", flavor: "markdown" });
    const profileShaped = runVerdict(uniformTable, {
      sourceType: "markdown",
      flavor: "markdown",
      includeToonCandidate: false,
    });

    expect(profileShaped.toon_candidate).toBeNull();
    expect(profileShaped.verdict).toBe(full.verdict);
    expect(profileShaped.safe_to_auto_apply).toBe(full.safe_to_auto_apply);
    expect(profileShaped.measured_chars).toEqual(full.measured_chars);
  });

  it("represents budget refusal in-band as verdict refused (decision 6)", () => {
    const verdict = runVerdict(
      "# Prose\n\nThis is mostly prose that cannot be losslessly squeezed into ten characters.",
      {
        sourceType: "markdown",
        flavor: "markdown",
        mode: "budget",
        targetChars: 10,
      },
    );

    expect(verdict.verdict).toBe("refused");
    expect(verdict.safe_to_auto_apply).toBe(false);
    expect(verdict.toon_candidate).toBeNull();
    expect(verdict.delimiter).toBeNull();
    expect(verdict.flags.target_reached).toBe(false);
    expect(verdict.flags.lossless).toBe(true);
    expect(verdict.warnings.map((warning) => warning.code)).toContain("budget_refused");
    // measured_chars reports the shortest lossless candidate that was attempted.
    expect(verdict.measured_chars.toon).toBeGreaterThan(0);

    expect(validateVerdict(verdict)).toBe(true);
    expect(validateVerdict.errors ?? []).toEqual([]);
  });

  it("codes lossy budget output as lossy_applied and target_not_reached", () => {
    const verdict = runVerdict(
      `# Prose\n\n## Principle\n\nThe converter must tell the truth about token savings.\n\n## Background\n\n${"This paragraph is retained semantic prose, so lossless output cannot shrink below the actual words that must remain. ".repeat(25)}`,
      {
        sourceType: "markdown",
        flavor: "markdown",
        mode: "budget",
        targetChars: 1000,
        allowLossy: true,
      },
    );

    const codes = verdict.warnings.map((warning) => warning.code);
    expect(codes).toContain("lossy_applied");
    expect(codes).toContain("target_not_reached");
    expect(verdict.flags.lossless).toBe(false);
    expect(verdict.flags.target_reached).toBe(false);
    expect(verdict.safe_to_auto_apply).toBe(false);
    expect(verdict.mode).toBe("budget");

    expect(validateVerdict(verdict)).toBe(true);
  });

  it("still throws on unrepresentable caller errors (decision 8)", () => {
    expect(() => runVerdict("# Doc\n\nBody.", { mode: "budget" })).toThrow(
      "Budget mode requires",
    );
  });

  it("keeps markdown when measured savings sit below the convert band (MIN_CONVERT_SAVINGS_PCT)", () => {
    // architecture-rfc.md measures +0.4% lossless: a rounding-error win, not a format-change case.
    const text = readFileSync(
      join(root, "fixtures", "agent-context", "realistic", "architecture-rfc.md"),
      "utf8",
    );
    const verdict = runVerdict(text, {
      sourceType: "markdown",
      flavor: "markdown",
      includeToonCandidate: false,
    });

    expect(verdict.measured_chars.savings).toBeGreaterThan(0);
    expect(verdict.measured_chars.savings_pct).toBeLessThan(5);
    expect(verdict.verdict).toBe("keep_markdown");
    expect(verdict.safe_to_auto_apply).toBe(false);
  });

  it("fires low_coverage when record mode drops content, blocking the dishonest convert (decision 12)", () => {
    // The decision-12 demonstration case: record mode on the RFC reports ~+91% savings while
    // retaining a fraction of the source. The coverage check turns that into review, not convert.
    const text = readFileSync(
      join(root, "fixtures", "agent-context", "realistic", "architecture-rfc.md"),
      "utf8",
    );
    const verdict = runVerdict(text, {
      sourceType: "markdown",
      flavor: "markdown",
      mode: "record",
      includeToonCandidate: false,
    });

    expect(verdict.measured_chars.savings_pct).toBeGreaterThan(50);
    const lowCoverage = verdict.warnings.find((warning) => warning.code === "low_coverage");
    expect(lowCoverage).toBeDefined();
    expect(lowCoverage?.severity).toBe("warning");
    expect(verdict.verdict).toBe("review");
    expect(verdict.safe_to_auto_apply).toBe(false);
    expect(validateVerdict(verdict)).toBe(true);
  });

  it("split_first outranks keep_markdown when split warnings fire on a negative-savings doc", () => {
    const text = readFileSync(
      join(root, "fixtures", "agent-context", "realistic", "CLAUDE.md"),
      "utf8",
    );
    const verdict = runVerdict(text, {
      sourceType: "markdown",
      flavor: "markdown",
      includeToonCandidate: false,
    });

    expect(verdict.measured_chars.savings).toBeLessThan(0);
    expect(verdict.verdict).toBe("split_first");
  });

  it("negative savings outranks review-class warnings (the AGENTS.md precedence case)", () => {
    const text = readFileSync(
      join(root, "fixtures", "agent-context", "realistic", "AGENTS.md"),
      "utf8",
    );
    const verdict = runVerdict(text, {
      sourceType: "markdown",
      flavor: "markdown",
      includeToonCandidate: false,
    });

    expect(verdict.measured_chars.savings).toBeLessThan(0);
    expect(verdict.warnings.length).toBeGreaterThan(0);
    expect(verdict.verdict).toBe("keep_markdown");
  });
});
