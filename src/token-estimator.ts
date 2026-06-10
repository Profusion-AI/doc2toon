import type { EstimateTokenCount } from "./types.js";

export const DEFAULT_CHARS_PER_TOKEN_RATIOS = [3.5, 4, 4.5];
export const DEFAULT_CHARS_PER_TOKEN = 4;

/** Estimator identity carried in VerdictV1.token_estimates.estimator (docs/verdict-schema-v1.md, decision 3). */
export const CHARS_PER_TOKEN_ESTIMATOR_ID = `chars-per-token:${DEFAULT_CHARS_PER_TOKEN}`;

export const estimateTokensByChars: EstimateTokenCount = (text: string) =>
  Math.round(text.length / DEFAULT_CHARS_PER_TOKEN);
