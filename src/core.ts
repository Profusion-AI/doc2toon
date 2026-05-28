import {
  buildBudgetCanonical,
  buildCanonical,
  buildLosslessCanonical,
  profileDocument,
} from "./parser.js";
import { calculateStats } from "./stats.js";
import { DEFAULT_CHARS_PER_TOKEN_RATIOS, estimateTokensByChars } from "./token-estimator.js";
import { decodeToJson, selectEncoding, targetReached } from "./toon.js";
import type {
  CanonicalDocument,
  CoreBuildOptions,
  ConversionResult,
  CoreConvertOptions,
  DocumentProfile,
  ParseFlavor,
  SourceType,
  ToonValidationResult,
} from "./types.js";

type BuildCandidate = Pick<
  ConversionResult,
  "canonicalJson" | "decodedJson" | "toon" | "stats" | "delimiter" | "lossless" | "valid"
>;

export function profileText(
  text: string,
  options: { sourceType?: SourceType; flavor?: ParseFlavor } = {},
): DocumentProfile {
  return profileDocument(text, {
    sourceType: options.sourceType ?? "paste",
    flavor: options.flavor ?? "text",
  });
}

export function convertTextToToon(options: CoreConvertOptions): ConversionResult {
  const profile = profileText(options.text, {
    sourceType: options.sourceType,
    flavor: options.flavor,
  });

  return buildConversionResult(profile, {
    mode: options.mode ?? "lossless",
    delimiter: options.delimiter ?? "auto",
    targetChars: options.targetChars,
    targetTokens: options.targetTokens,
    allowLossy: Boolean(options.allowLossy),
    charsPerTokenRatios: options.charsPerTokenRatios ?? DEFAULT_CHARS_PER_TOKEN_RATIOS,
    estimateTokenCount: options.estimateTokenCount ?? estimateTokensByChars,
  });
}

export function buildConversionResult(profile: DocumentProfile, options: CoreBuildOptions): ConversionResult {
  const candidate = buildConversion(profile, options);
  const reached =
    options.targetChars !== undefined || options.targetTokens !== undefined
      ? targetReached(candidate.stats, options.targetChars, options.targetTokens)
      : null;
  const warnings = buildWarnings(candidate.lossless, candidate.stats.charSavings, reached);

  return {
    ...candidate,
    profile,
    mode: options.mode,
    warnings,
    targetReached: reached,
    sourceChars: candidate.stats.sourceChars,
    toonChars: candidate.stats.toonChars,
    sourceTokens: candidate.stats.sourceTokens,
    toonTokens: candidate.stats.toonTokens,
  };
}

export function validateToonText(toon: string): ToonValidationResult {
  try {
    return {
      valid: true,
      decodedJson: decodeToJson(toon),
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function decodeToJsonText(toon: string): unknown {
  return decodeToJson(toon);
}

function buildConversion(profile: DocumentProfile, options: CoreBuildOptions): BuildCandidate {
  if (options.mode !== "budget") {
    const canonicalJson = buildCanonical(profile, { mode: options.mode });
    return encodeCandidate(profile.sourceText, canonicalJson, true, options);
  }

  if (options.targetChars === undefined && options.targetTokens === undefined) {
    throw new Error("Budget mode requires --target-chars or --target-tokens.");
  }

  const losslessCanonical = buildLosslessCanonical(profile);
  const losslessCandidate = encodeCandidate(profile.sourceText, losslessCanonical, true, options);

  if (targetReached(losslessCandidate.stats, options.targetChars, options.targetTokens)) {
    return losslessCandidate;
  }

  if (!options.allowLossy) {
    throw new Error(
      `Target cannot be reached losslessly. Source is ${profile.sourceChars} chars; shortest lossless TOON is ${losslessCandidate.stats.toonChars} chars / ~${losslessCandidate.stats.toonTokens} tokens. Use --mode budget --allow-lossy to produce semantic compression.`,
    );
  }

  return buildLossyBudgetConversion(profile, options);
}

function buildLossyBudgetConversion(profile: DocumentProfile, options: CoreBuildOptions): BuildCandidate {
  const maxSnippetAttempts = [720, 480, 320, 220, 140, 90, 55];
  let best: BuildCandidate | undefined;

  for (const maxSnippetChars of maxSnippetAttempts) {
    const canonicalJson = buildBudgetCanonical(profile, {
      targetChars: options.targetChars ?? null,
      targetTokens: options.targetTokens ?? null,
      maxSnippetChars,
    });
    const candidate = encodeCandidate(profile.sourceText, canonicalJson, false, options);
    best = candidate;

    if (targetReached(candidate.stats, options.targetChars, options.targetTokens)) {
      return candidate;
    }
  }

  if (!best) {
    throw new Error("Budget conversion failed before a candidate could be generated.");
  }

  return best;
}

function encodeCandidate(
  sourceText: string,
  canonicalJson: CanonicalDocument,
  lossless: boolean,
  options: CoreBuildOptions,
): BuildCandidate {
  const encoding = selectEncoding(canonicalJson, options.delimiter, options.estimateTokenCount);
  const stats = calculateStats(
    sourceText,
    canonicalJson,
    encoding.toon,
    options.charsPerTokenRatios,
    options.estimateTokenCount,
  );

  return {
    canonicalJson,
    decodedJson: encoding.decoded,
    toon: encoding.toon,
    stats,
    delimiter: encoding.delimiter,
    lossless,
    valid: encoding.valid,
  };
}

function buildWarnings(lossless: boolean, charSavings: number, reached: boolean | null): string[] {
  const warnings: string[] = [];

  if (!lossless) {
    warnings.push("Output used semantic compression and is not lossless.");
  }
  if (charSavings < 0) {
    warnings.push("TOON output is larger than the source text for this input.");
  }
  if (reached === false) {
    warnings.push("Target was not reached; the budget is probably below the retained semantic payload.");
  }

  return warnings;
}
