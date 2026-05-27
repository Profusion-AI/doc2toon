import { decode, encode } from "@toon-format/toon";
import { Buffer } from "node:buffer";
import { estimateTokenCount } from "tokenx";
import { stableJson } from "./normalize.js";
import type { ConversionStats, DelimiterOption, EncodingSelection, RoundTripResult, ToonDelimiter } from "./types.js";

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

export function selectEncoding(canonicalJson: unknown, delimiterOption: DelimiterOption): EncodingSelection {
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
  stats: Pick<ConversionStats, "toonChars" | "toonTokens">,
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

export function calculateStats(
  sourceText: string,
  canonicalJson: unknown,
  toon: string,
  charsPerTokenRatios = [3.5, 4, 4.5],
): ConversionStats {
  const json = JSON.stringify(canonicalJson);
  const sourceChars = sourceText.length;
  const toonChars = toon.length;
  const jsonBytes = Buffer.byteLength(json, "utf8");
  const toonBytes = Buffer.byteLength(toon, "utf8");
  const sourceTokens = estimateTokenCount(sourceText);
  const toonTokens = estimateTokenCount(toon);
  const jsonTokens = estimateTokenCount(json);
  const charSavings = sourceChars - toonChars;
  const tokenSavings = sourceTokens - toonTokens;
  const jsonToonTokenSavings = jsonTokens - toonTokens;

  return {
    sourceChars,
    toonChars,
    charSavings,
    charSavingsPercent: sourceChars === 0 ? 0 : (charSavings / sourceChars) * 100,
    sourceTokens,
    toonTokens,
    tokenSavings,
    tokenSavingsPercent: sourceTokens === 0 ? 0 : (tokenSavings / sourceTokens) * 100,
    ratioEstimates: charsPerTokenRatios.map((charsPerToken) => {
      const estimatedSource = sourceChars / charsPerToken;
      const estimatedToon = toonChars / charsPerToken;
      const estimatedSavings = estimatedSource - estimatedToon;
      return {
        charsPerToken,
        sourceTokens: Math.round(estimatedSource),
        toonTokens: Math.round(estimatedToon),
        tokensSaved: Math.round(estimatedSavings),
        savingsPercent: estimatedSource === 0 ? 0 : (estimatedSavings / estimatedSource) * 100,
      };
    }),
    jsonBytes,
    toonBytes,
    jsonChars: json.length,
    jsonTokens,
    jsonToonTokenSavings,
    jsonToonTokenSavingsPercent: jsonTokens === 0 ? 0 : (jsonToonTokenSavings / jsonTokens) * 100,
  };
}
