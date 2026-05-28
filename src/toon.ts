import { decode, encode } from "@toon-format/toon";
import { stableJson } from "./normalize.js";
import { estimateTokensByChars } from "./token-estimator.js";
import type { DelimiterOption, EncodingSelection, EstimateTokenCount, RoundTripResult, ToonDelimiter } from "./types.js";

export const TOON_DELIMITERS: ToonDelimiter[] = [",", "\t", "|"];

export function encodeToToon(canonicalJson: unknown, delimiter: ToonDelimiter = ","): string {
  return encode(canonicalJson, { delimiter });
}

export function decodeToJson(toon: string): unknown {
  return decode(toon);
}

export function roundTrip(canonicalJson: unknown, delimiter: ToonDelimiter = ","): RoundTripResult {
  const toon = encodeToToon(canonicalJson, delimiter);
  const decoded = decodeToJson(toon);
  const valid = stableJson(canonicalJson) === stableJson(decoded);

  return {
    toon,
    decoded,
    valid,
  };
}

export function selectEncoding(
  canonicalJson: unknown,
  delimiterOption: DelimiterOption,
  estimateTokenCount: EstimateTokenCount = estimateTokensByChars,
): EncodingSelection {
  const delimiters = delimiterOption === "auto" ? TOON_DELIMITERS : [delimiterOption];
  const candidates = delimiters.map((delimiter) => {
    const result = roundTrip(canonicalJson, delimiter);
    return {
      ...result,
      delimiter,
      toonChars: result.toon.length,
      toonTokens: estimateTokenCount(result.toon),
    };
  });

  const invalid = candidates.find((candidate) => !candidate.valid);
  if (invalid) {
    return invalid;
  }

  return candidates.sort((a, b) => a.toonTokens - b.toonTokens || a.toonChars - b.toonChars)[0];
}

export function targetReached(
  stats: Pick<EncodingSelection, "toonChars" | "toonTokens">,
  targetChars?: number,
  targetTokens?: number,
): boolean {
  if (targetChars !== undefined && stats.toonChars > targetChars) {
    return false;
  }
  if (targetTokens !== undefined && stats.toonTokens > targetTokens) {
    return false;
  }
  return targetChars !== undefined || targetTokens !== undefined;
}
