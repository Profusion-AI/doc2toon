import { DEFAULT_CHARS_PER_TOKEN_RATIOS, estimateTokensByChars } from "./token-estimator.js";
import type { ConversionStats, EstimateTokenCount } from "./types.js";

const encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function calculateStats(
  sourceText: string,
  canonicalJson: unknown,
  toon: string,
  charsPerTokenRatios = DEFAULT_CHARS_PER_TOKEN_RATIOS,
  estimateTokenCount: EstimateTokenCount = estimateTokensByChars,
): ConversionStats {
  const json = JSON.stringify(canonicalJson);
  const sourceChars = sourceText.length;
  const toonChars = toon.length;
  const jsonBytes = utf8ByteLength(json);
  const toonBytes = utf8ByteLength(toon);
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
