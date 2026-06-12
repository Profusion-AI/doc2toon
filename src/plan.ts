import { splitPlanSections } from "./plan-sections.js";
import { decodeToJson } from "./toon.js";
import { MIN_CONVERT_SAVINGS_PCT, roundPercent, runVerdict } from "./verdict.js";
import type { PlanSectionSlice } from "./plan-sections.js";
import type {
  CodedWarning,
  ContextPlan,
  ContextPlanSection,
  EstimateTokenCount,
  ParseFlavor,
  SourceType,
  VerdictV1,
} from "./types.js";

// Context plans (docs/context-plan-design.md): per-section verdicts under the unchanged frozen
// policy — policy composition, zero new tunable constants. Every section is measured as if it
// were a standalone document via the same runVerdict every surface calls; a section "converts"
// iff it would earn `convert` as a document. Only the plan surface emits the resulting
// schema_version "1.1" object; profile/convert output stays 1.0 byte-for-byte.
// This module must stay browser-safe: no Node-only imports, no tokenizer dependencies.

export const CONTEXT_PLAN_SCHEMA_VERSION = "1.1";

export interface BuildContextPlanOptions {
  sourceType?: SourceType;
  flavor?: ParseFlavor;
  charsPerTokenRatios?: number[];
  estimateTokenCount?: EstimateTokenCount;
  /** Estimator identity for the advisory token numbers, as in BuildVerdictOptions. */
  estimator?: string;
}

/** One contiguous piece of the assembled hybrid document, in section order. */
export interface HybridSegment {
  /** Index into ContextPlan.sections. */
  sectionIndex: number;
  kind: "raw" | "converted";
  /** The exact text this segment contributes to the hybrid. */
  text: string;
  /** Converted segments only: the TOON candidate embedded between the fences. */
  toon?: string;
}

export interface ContextPlanResult {
  /** The whole-document verdict (profile-shaped, toon_candidate null) carrying context_plan, schema_version "1.1". */
  verdict: VerdictV1;
  /** Convenience alias for verdict.context_plan. */
  plan: ContextPlan;
  /** The assembled hybrid document. Equals the source byte-for-byte when no section converts. */
  hybrid: string;
  /** The hybrid's segments, for consumers (web, tests) that need per-section artifacts. */
  segments: HybridSegment[];
}

export function buildContextPlan(text: string, options: BuildContextPlanOptions = {}): ContextPlanResult {
  const verdictOptions = {
    sourceType: options.sourceType,
    flavor: options.flavor,
    mode: "lossless" as const, // v1 plans are lossless-only by design
    charsPerTokenRatios: options.charsPerTokenRatios,
    estimateTokenCount: options.estimateTokenCount,
    estimator: options.estimator,
  };

  const documentVerdict = runVerdict(text, { ...verdictOptions, includeToonCandidate: false });
  const slices = splitPlanSections(text);

  const sections: ContextPlanSection[] = [];
  const segments: HybridSegment[] = [];

  slices.forEach((slice, index) => {
    if (slice.kind === "frontmatter") {
      // Never measured: running the markdown policy on YAML metadata is the documented profiler
      // caveat — a labeled null measurement is honest, a garbage verdict is not (§2.1).
      sections.push({
        heading: null,
        kind: "frontmatter",
        range: sliceRange(slice),
        profile: null,
        verdict: null,
        action: "keep",
        measured_chars: null,
        warnings: [],
        safe_to_auto_apply: false,
      });
      segments.push({ sectionIndex: index, kind: "raw", text: slice.raw });
      return;
    }

    const sectionVerdict = runVerdict(slice.raw, { ...verdictOptions, includeToonCandidate: true });
    const convert =
      sectionVerdict.verdict === "convert" &&
      sectionVerdict.flags.valid &&
      sectionVerdict.toon_candidate !== null;

    sections.push({
      heading: slice.heading,
      kind: slice.kind,
      range: sliceRange(slice),
      profile: sectionVerdict.profile.name,
      verdict: sectionVerdict.verdict,
      action: convert ? "convert" : "keep",
      measured_chars: sectionVerdict.measured_chars,
      warnings: sectionVerdict.warnings.map((warning) => offsetWarning(warning, slice)),
      safe_to_auto_apply: sectionVerdict.safe_to_auto_apply,
    });
    segments.push(
      convert
        ? {
            sectionIndex: index,
            kind: "converted",
            text: renderConvertedSection(slice, sectionVerdict.toon_candidate as string),
            toon: sectionVerdict.toon_candidate as string,
          }
        : { sectionIndex: index, kind: "raw", text: slice.raw },
    );
  });

  const hybrid = segments.map((segment) => segment.text).join("");
  const savings = text.length - hybrid.length;
  const rawSavingsPct = text.length === 0 ? 0 : (savings / text.length) * 100;
  const convertedCount = segments.filter((segment) => segment.kind === "converted").length;

  // The frozen band, reused at plan level on the raw percentage — exactly how decideVerdict
  // applies it to a whole document. A plan that converts nothing recommends nothing.
  const recommendHybrid = convertedCount > 0 && savings > 0 && rawSavingsPct >= MIN_CONVERT_SAVINGS_PCT;
  const reassemblyVerified = verifyReassembly(text, slices, segments, hybrid);
  const convertedSections = sections.filter((section) => section.action === "convert");
  const safeToAutoApply =
    recommendHybrid &&
    convertedSections.length > 0 &&
    convertedSections.every((section) => section.safe_to_auto_apply) &&
    reassemblyVerified;

  const plan: ContextPlan = {
    sections,
    net: {
      source: text.length,
      hybrid: hybrid.length,
      savings,
      savings_pct: roundPercent(rawSavingsPct),
    },
    recommend_hybrid: recommendHybrid,
    reassembly_verified: reassemblyVerified,
    safe_to_auto_apply: safeToAutoApply,
  };

  return {
    verdict: { ...documentVerdict, schema_version: CONTEXT_PLAN_SCHEMA_VERSION, context_plan: plan },
    plan,
    hybrid,
    segments,
  };
}

function sliceRange(slice: PlanSectionSlice): ContextPlanSection["range"] {
  return {
    line_start: slice.lineStart,
    line_end: slice.lineEnd,
    char_start: slice.charStart,
    char_end: slice.charEnd,
  };
}

/**
 * Warnings from a standalone section measurement carry slice-relative ranges; the plan emits
 * whole-document coordinates (§2.1). Line 1 of the slice is the slice's first document line.
 */
function offsetWarning(warning: CodedWarning, slice: PlanSectionSlice): CodedWarning {
  if (!warning.range) {
    return warning;
  }
  const range: NonNullable<CodedWarning["range"]> = {};
  if (warning.range.line_start !== undefined) {
    range.line_start = warning.range.line_start + slice.lineStart - 1;
  }
  if (warning.range.line_end !== undefined) {
    range.line_end = warning.range.line_end + slice.lineStart - 1;
  }
  if (warning.range.char_start !== undefined) {
    range.char_start = warning.range.char_start + slice.charStart;
  }
  if (warning.range.char_end !== undefined) {
    range.char_end = warning.range.char_end + slice.charStart;
  }
  return { ...warning, range };
}

/**
 * Hybrid rendering of a converted section (design §2, normative): the heading line stays as
 * Markdown byte-identical; the rest of the slice becomes a fenced block whose content is exactly
 * the measured TOON candidate; the slice's trailing newline run is preserved after the closing
 * fence. The fence and the kept heading are the splice overhead — counted via net.hybrid.
 */
function renderConvertedSection(slice: PlanSectionSlice, toon: string): string {
  const headingPart = slice.raw.slice(0, slice.headingPartLength);
  const body = slice.raw.slice(slice.headingPartLength);
  const trailing = body.match(/(?:\r\n|\n|\r)+$/)?.[0] ?? "";
  // A heading line unterminated at EOF needs a separator so the fence starts on its own line.
  const separator = headingPart === "" || /(?:\n|\r)$/.test(headingPart) ? "" : "\n";
  const fence = fenceFor(toon);
  return `${headingPart}${separator}${fence}toon\n${toon}\n${fence}${trailing}`;
}

/** One backtick longer than the longest run inside the TOON, so embedded backticks cannot close the fence early. */
function fenceFor(toon: string): string {
  let longest = 0;
  for (const run of toon.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * Mechanical reassembly verification (design §2): kept sections byte-identical in the hybrid,
 * converted candidates decode as embedded, slices re-stitch to the full document. Computed,
 * never asserted — safe_to_auto_apply must not rest on the renderer's own claims about itself.
 */
function verifyReassembly(
  source: string,
  slices: PlanSectionSlice[],
  segments: HybridSegment[],
  hybrid: string,
): boolean {
  if (segments.length !== slices.length) {
    return false;
  }

  let cursor = 0;
  let stitched = "";
  for (const slice of slices) {
    if (slice.charStart !== cursor) {
      return false;
    }
    cursor = slice.charEnd;
    stitched += slice.raw;
  }
  if (cursor !== source.length || stitched !== source) {
    return false;
  }

  let assembled = "";
  for (const segment of segments) {
    const slice = slices[segment.sectionIndex];
    if (segment.kind === "raw") {
      if (segment.text !== slice.raw) {
        return false;
      }
    } else {
      if (segment.toon === undefined || !segment.text.includes(`\n${segment.toon}\n`)) {
        return false;
      }
      if (!segment.text.startsWith(slice.raw.slice(0, slice.headingPartLength))) {
        return false;
      }
      try {
        decodeToJson(segment.toon);
      } catch {
        return false;
      }
    }
    assembled += segment.text;
  }

  return assembled === hybrid;
}
