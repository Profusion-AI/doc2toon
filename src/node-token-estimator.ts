import { createRequire } from "node:module";
import { estimateTokenCount } from "tokenx";
import type { EstimateTokenCount } from "./types.js";

// tokenx does not export its package.json, but doc2toon pins it exactly, so our own
// manifest is a truthful single source for the estimator identity (decision 3).
// package.json sits one level above both src/ (dev via tsx) and dist/ (published build).
const { dependencies } = createRequire(import.meta.url)("../package.json") as {
  dependencies: Record<string, string>;
};

/** Estimator identity carried in VerdictV1.token_estimates.estimator (docs/verdict-schema-v1.md, decision 3). */
export const NODE_TOKEN_ESTIMATOR_ID = `tokenx@${dependencies.tokenx}`;

export const estimateNodeTokenCount: EstimateTokenCount = (text: string) => estimateTokenCount(text);
