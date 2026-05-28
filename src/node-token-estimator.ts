import { estimateTokenCount } from "tokenx";
import type { EstimateTokenCount } from "./types.js";

export const estimateNodeTokenCount: EstimateTokenCount = (text: string) => estimateTokenCount(text);
