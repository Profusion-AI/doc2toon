import { BudgetRefusedError, convertTextToToon } from "./core.js";
import { CHARS_PER_TOKEN_ESTIMATOR_ID } from "./token-estimator.js";
import type {
  CodedWarning,
  ConversionResult,
  ConversionStats,
  CoreConvertOptions,
  DocumentProfile,
  OptimizerWarning,
  VerdictDecision,
  VerdictMeasuredChars,
  VerdictProfile,
  VerdictTokenEstimates,
  VerdictV1,
} from "./types.js";

// The verdict contract (schemas/verdict.v1.json, docs/verdict-schema-v1.md). Every surface —
// web app, CLI --json, MCP tools, serve, hosted API — calls buildVerdict/runVerdict; no surface
// ever re-derives a verdict. This module must stay browser-safe: no Node-only imports, no
// tokenizer dependencies (enforced by the purity test in test/core.test.ts).

export const VERDICT_SCHEMA_VERSION = "1.0";

/**
 * Decision-policy constants (docs/verdict-schema-v1.md): minor-version-tunable, never schema
 * changes. Calibrated against the fixture corpus on day 4 — see docs/calibration-v1.md.
 */

/**
 * Measured char savings below this percentage do not justify a format change: the verdict stays
 * keep_markdown. Calibration: measurements near zero are noise-sensitive (EOL encoding alone
 * moved a fixture from -1.5% to +0.4%), and the corpus separates real wins (+21.1%, +6.4%) from
 * marginal ones (+4.7%) with a clear gap at 5.
 */
export const MIN_CONVERT_SAVINGS_PCT = 5;

/**
 * Below this share of retained content characters, a low_coverage warning fires. Calibration:
 * legitimate conversions measure 0.88-1.0; the content-loss cases measure 0.08-0.66.
 */
export const LOW_COVERAGE_RATIO = 0.7;

export interface BuildVerdictOptions {
  /**
   * Identity of the estimator that produced the token numbers in the ConversionResult,
   * e.g. NODE_TOKEN_ESTIMATOR_ID or CHARS_PER_TOKEN_ESTIMATOR_ID ("chars-per-token:4").
   * Defaults to the chars-per-token identity because that is core's default estimator.
   * Advisory payload only — never a decision input (decision 2).
   */
  estimator?: string;
  /**
   * False on profile surfaces (CLI profile --json, POST /v1/profile): the verdict is returned
   * with toon_candidate null so an agent can decide before spending context (decision 9).
   * Defaults to true (convert surfaces).
   */
  includeToonCandidate?: boolean;
}

export interface RunVerdictOptions extends Omit<CoreConvertOptions, "text">, BuildVerdictOptions {}

/**
 * Map a ConversionResult to the VerdictV1 wire object. Decision fields derive exclusively from
 * deterministic inputs: measured chars, fired warning codes, and the lossless/valid flags.
 */
export function buildVerdict(result: ConversionResult, options: BuildVerdictOptions = {}): VerdictV1 {
  const warnings = buildCodedWarnings(result);
  const verdict = decideVerdict(result.stats, warnings);
  const includeToonCandidate = options.includeToonCandidate ?? true;

  return {
    schema_version: VERDICT_SCHEMA_VERSION,
    verdict,
    safe_to_auto_apply: isSafeToAutoApply(verdict, result, warnings),
    profile: buildProfileBlock(result.profile),
    measured_chars: buildMeasuredChars(result.stats),
    token_estimates: buildTokenEstimates(result.stats, options.estimator),
    toon_candidate: includeToonCandidate ? result.toon : null,
    warnings,
    flags: {
      lossless: result.lossless,
      valid: result.valid,
      target_reached: result.targetReached,
    },
    mode: result.mode,
    delimiter: result.delimiter,
  };
}

/**
 * Convert text and return a verdict without throwing on representable outcomes: a budget
 * refusal is `verdict: "refused"`, not an error (decision 6). Throwing is reserved for
 * unrepresentable failures (I/O, internal errors, invalid caller contracts).
 */
export function runVerdict(text: string, options: RunVerdictOptions = {}): VerdictV1 {
  const { estimator, includeToonCandidate, ...convertOptions } = options;

  try {
    const result = convertTextToToon({ text, ...convertOptions });
    return buildVerdict(result, { estimator, includeToonCandidate });
  } catch (error) {
    if (error instanceof BudgetRefusedError) {
      return buildRefusedVerdict(error, estimator);
    }
    throw error;
  }
}

function buildRefusedVerdict(refusal: BudgetRefusedError, estimator: string | undefined): VerdictV1 {
  const warnings = refusal.profile.optimizerWarnings.map(mapOptimizerWarning);
  if (refusal.losslessAttempt.stats.charSavings < 0) {
    warnings.push(negativeSavingsWarning());
  }
  warnings.push({
    code: "budget_refused",
    severity: "warning",
    message: "The budget target cannot be reached losslessly and lossy output was not permitted.",
    suggestion: "Allow lossy output to compress semantically, or raise the target.",
  });

  return {
    schema_version: VERDICT_SCHEMA_VERSION,
    verdict: "refused",
    safe_to_auto_apply: false,
    profile: buildProfileBlock(refusal.profile),
    // The shortest lossless candidate that was attempted — the same numbers the error quotes.
    measured_chars: buildMeasuredChars(refusal.losslessAttempt.stats),
    token_estimates: buildTokenEstimates(refusal.losslessAttempt.stats, estimator),
    toon_candidate: null,
    warnings,
    flags: {
      lossless: true,
      valid: refusal.losslessAttempt.valid,
      target_reached: false,
    },
    mode: "budget",
    delimiter: null,
  };
}

/** The normative decision policy, evaluated in priority order (docs/verdict-schema-v1.md). */
function decideVerdict(stats: ConversionStats, warnings: CodedWarning[]): VerdictDecision {
  // Priority 1 (refused) is decided upstream in runVerdict: it is a refusal to convert,
  // so there is no ConversionResult to judge.
  if (warnings.some((warning) => warning.code === "long_section" || warning.code === "split_candidate")) {
    return "split_first";
  }
  if (stats.charSavings <= 0 || stats.charSavingsPercent < MIN_CONVERT_SAVINGS_PCT) {
    return "keep_markdown";
  }
  if (warnings.length > 0) {
    return "review";
  }
  return "convert";
}

function isSafeToAutoApply(
  verdict: VerdictDecision,
  result: ConversionResult,
  warnings: CodedWarning[],
): boolean {
  return (
    verdict === "convert" &&
    result.mode === "lossless" &&
    result.lossless &&
    result.valid &&
    result.stats.charSavings > 0 &&
    !warnings.some((warning) => warning.severity === "warning")
  );
}

function buildCodedWarnings(result: ConversionResult): CodedWarning[] {
  const warnings = result.optimizerWarnings.map(mapOptimizerWarning);

  // Conversion-state codes derive from result fields, never from the prose strings in
  // result.warnings — prose is a rendering of codes, not the data (decision 5).
  const coverage = measureContentCoverage(result);
  if (coverage !== null && coverage < LOW_COVERAGE_RATIO) {
    warnings.push({
      code: "low_coverage",
      severity: "warning",
      message: `Output retains ~${Math.round(coverage * 100)}% of the source's content characters.`,
      suggestion: "Use lossless mode, or review what was dropped before trusting the savings.",
    });
  }
  if (!result.lossless) {
    warnings.push({
      code: "lossy_applied",
      severity: "warning",
      message: "Output used semantic compression and is not lossless.",
    });
  }
  if (result.stats.charSavings < 0) {
    warnings.push(negativeSavingsWarning());
  }
  if (result.targetReached === false) {
    warnings.push({
      code: "target_not_reached",
      severity: "warning",
      message: "Target was not reached; the budget is probably below the retained semantic payload.",
    });
  }

  return warnings;
}

function negativeSavingsWarning(): CodedWarning {
  return {
    code: "negative_savings",
    severity: "warning",
    message: "TOON output is larger than the source text for this input.",
  };
}

function mapOptimizerWarning(warning: OptimizerWarning): CodedWarning {
  const coded: CodedWarning = {
    code: warning.kind,
    severity: warning.severity,
    message: warning.message,
  };
  if (warning.suggestion) {
    coded.suggestion = warning.suggestion;
  }
  if (warning.evidence !== undefined) {
    coded.evidence = warning.evidence;
  }
  const range = buildRange(warning);
  if (range) {
    coded.range = range;
  }
  return coded;
}

function buildRange(warning: OptimizerWarning): CodedWarning["range"] {
  if (
    warning.lineStart === undefined &&
    warning.lineEnd === undefined &&
    warning.charStart === undefined &&
    warning.charEnd === undefined
  ) {
    return undefined;
  }

  const range: NonNullable<CodedWarning["range"]> = {};
  if (warning.lineStart !== undefined) {
    range.line_start = warning.lineStart;
  }
  if (warning.lineEnd !== undefined) {
    range.line_end = warning.lineEnd;
  }
  if (warning.charStart !== undefined) {
    range.char_start = warning.charStart;
  }
  if (warning.charEnd !== undefined) {
    range.char_end = warning.charEnd;
  }
  return range;
}

function buildProfileBlock(profile: DocumentProfile): VerdictProfile {
  return {
    name: profile.name,
    title: profile.title,
    source_type: profile.sourceType,
    stats: {
      lines: profile.stats.lineCount,
      headings: profile.stats.headingCount,
      paragraphs: profile.stats.paragraphCount,
      list_items: profile.stats.listItemCount,
      tables: profile.stats.tableCount,
      table_rows: profile.stats.tableRowCount,
      definitions: profile.stats.definitionCount,
      rules: profile.stats.ruleCount,
    },
  };
}

function buildMeasuredChars(stats: ConversionStats): VerdictMeasuredChars {
  return {
    source: stats.sourceChars,
    toon: stats.toonChars,
    savings: stats.charSavings,
    savings_pct: roundPercent(stats.charSavingsPercent),
  };
}

function buildTokenEstimates(stats: ConversionStats, estimator: string | undefined): VerdictTokenEstimates {
  return {
    estimator: estimator ?? CHARS_PER_TOKEN_ESTIMATOR_ID,
    source: stats.sourceTokens,
    toon: stats.toonTokens,
    savings: stats.tokenSavings,
    savings_pct: roundPercent(stats.tokenSavingsPercent),
    ratio_estimates: stats.ratioEstimates.map((estimate) => ({
      chars_per_token: estimate.charsPerToken,
      source: estimate.sourceTokens,
      toon: estimate.toonTokens,
      savings: estimate.tokensSaved,
      savings_pct: roundPercent(estimate.savingsPercent),
    })),
  };
}

/**
 * Wire percentages carry one decimal; the raw integer counts stay exact (and are the decision
 * inputs). Shared with the plan builder (src/plan.ts) so net and per-section percentages round
 * identically.
 */
export function roundPercent(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Share of the source's content characters (alphanumerics — markdown syntax deliberately doesn't
 * count) retained by the canonical document's string values. This is the mechanical coverage
 * check decision 12 calls for: the lossless flag asserts mode intent; this measures what actually
 * survived. Clamped to 1 because the mixed canonical duplicates content across record kinds.
 * Null when the source has no content characters (nothing to lose).
 */
export function measureContentCoverage(result: ConversionResult): number | null {
  const sourceContentChars = countContentChars(result.profile.sourceText);
  if (sourceContentChars === 0) {
    return null;
  }
  const retained: string[] = [];
  collectStringValues(result.canonicalJson, retained);
  return Math.min(1, countContentChars(retained.join("")) / sourceContentChars);
}

function collectStringValues(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStringValues(entry, out);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) {
      collectStringValues(entry, out);
    }
  }
}

function countContentChars(text: string): number {
  return text.match(/[A-Za-z0-9]/g)?.length ?? 0;
}
