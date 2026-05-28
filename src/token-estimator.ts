import type { EstimateTokenCount } from "./types.js";

export const DEFAULT_CHARS_PER_TOKEN_RATIOS = [3.5, 4, 4.5];
export const DEFAULT_CHARS_PER_TOKEN = 4;

export const estimateTokensByChars: EstimateTokenCount = (text: string) =>
  Math.round(text.length / DEFAULT_CHARS_PER_TOKEN);
