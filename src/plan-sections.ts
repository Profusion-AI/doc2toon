import type { PlanSectionKind } from "./types.js";

// Source-range-preserving section splitter for context plans (docs/context-plan-design.md §2.1).
// The contract this module owes the plan builder: the returned slices PARTITION the source —
// [charStart, charEnd) ranges tile the document with no gaps or overlaps, and concatenating
// every slice's raw text reproduces the source byte-for-byte. The parser's { h, body } sections
// cannot provide this (bodies are re-rendered text); hybrids and reassembly verification hang on
// it. Boundaries are the author's own ATX headings, fence-aware exactly as parseMarkdown is.
// This module must stay browser-safe: no Node-only imports.

export interface PlanSectionSlice {
  kind: PlanSectionKind;
  /** Heading text (trimmed, as the parser reports it); null for preamble and frontmatter. */
  heading: string | null;
  /** The raw source bytes of the slice, untouched. */
  raw: string;
  /** Whole-document character offset of the first character of the slice. */
  charStart: number;
  /** Whole-document character offset one past the last character of the slice. */
  charEnd: number;
  /** 1-based line number of the slice's first character. */
  lineStart: number;
  /** 1-based line number of the slice's last character. */
  lineEnd: number;
  /**
   * Length of the leading heading line including its line terminator (0 for preamble and
   * frontmatter). The hybrid renderer keeps exactly this prefix as Markdown when it replaces
   * the rest of a converted slice with a fenced TOON block.
   */
  headingPartLength: number;
}

interface SourceLine {
  /** 1-based. */
  line: number;
  /** Line text without its terminator. */
  text: string;
  /** Offset of the line's first character. */
  charStart: number;
  /** Offset one past the line's terminator (or past its last character at EOF). */
  charEnd: number;
}

// The parser's own patterns (src/parser.ts), mirrored so plan boundaries are the boundaries
// the profile already reasons about: ATX headings only, no leading whitespace, fences win.
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_OPEN_PATTERN = /^\s*(```+|~~~+)/;
const FRONTMATTER_DELIMITER = /^---[ \t]*$/;
const FRONTMATTER_CLOSER = /^(---|\.\.\.)[ \t]*$/;

export function splitPlanSections(source: string): PlanSectionSlice[] {
  if (source.length === 0) {
    return [];
  }

  const lines = splitSourceLines(source);
  const slices: PlanSectionSlice[] = [];

  const frontmatterEndLine = findFrontmatterEnd(lines);
  if (frontmatterEndLine !== undefined) {
    slices.push(buildSlice("frontmatter", null, lines, 0, frontmatterEndLine, source));
  }

  const bodyStart = frontmatterEndLine !== undefined ? frontmatterEndLine + 1 : 0;
  const headings = findHeadingLines(lines, bodyStart);

  const preambleEnd = (headings[0]?.index ?? lines.length) - 1;
  if (preambleEnd >= bodyStart) {
    slices.push(buildSlice("preamble", null, lines, bodyStart, preambleEnd, source));
  }

  headings.forEach((entry, position) => {
    const next = headings[position + 1];
    const endLine = (next?.index ?? lines.length) - 1;
    slices.push(buildSlice("section", entry.heading, lines, entry.index, endLine, source));
  });

  assertPartition(slices, source);
  return slices;
}

function splitSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let charStart = 0;

  // A document ending in a newline has no phantom empty final line: the terminator belongs to
  // the line it ends, so the last line's charEnd is always source.length.
  while (charStart < source.length) {
    let terminatorStart = source.length;
    for (let index = charStart; index < source.length; index += 1) {
      const char = source[index];
      if (char === "\n" || char === "\r") {
        terminatorStart = index;
        break;
      }
    }
    const terminatorLength =
      terminatorStart >= source.length ? 0 : source.startsWith("\r\n", terminatorStart) ? 2 : 1;
    const charEnd = terminatorStart + terminatorLength;

    lines.push({
      line: lines.length + 1,
      text: source.slice(charStart, terminatorStart),
      charStart,
      charEnd,
    });
    charStart = charEnd;
  }

  return lines;
}

/** 0-based index of the closing delimiter line, or undefined when the document has no frontmatter. */
function findFrontmatterEnd(lines: SourceLine[]): number | undefined {
  if (lines.length < 2 || !FRONTMATTER_DELIMITER.test(lines[0].text)) {
    return undefined;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_CLOSER.test(lines[index].text)) {
      return index;
    }
  }
  // An unclosed opening "---" is a thematic break, not frontmatter — exactly what the parser sees.
  return undefined;
}

function findHeadingLines(
  lines: SourceLine[],
  fromLineIndex: number,
): Array<{ index: number; heading: string }> {
  const headings: Array<{ index: number; heading: string }> = [];
  let fenceToken: string | null = null;

  for (let index = fromLineIndex; index < lines.length; index += 1) {
    const text = lines[index].text;

    if (fenceToken !== null) {
      if (text.trimStart().startsWith(fenceToken)) {
        fenceToken = null;
      }
      continue;
    }

    const fence = text.match(FENCE_OPEN_PATTERN);
    if (fence) {
      fenceToken = fence[1];
      continue;
    }

    const heading = text.match(HEADING_PATTERN);
    if (heading) {
      headings.push({ index, heading: heading[2].trim() });
    }
  }

  return headings;
}

function buildSlice(
  kind: PlanSectionKind,
  heading: string | null,
  lines: SourceLine[],
  startLineIndex: number,
  endLineIndex: number,
  source: string,
): PlanSectionSlice {
  const startLine = lines[startLineIndex];
  const endLine = lines[endLineIndex];
  const charStart = startLine.charStart;
  const charEnd = endLine.charEnd;

  return {
    kind,
    heading,
    raw: source.slice(charStart, charEnd),
    charStart,
    charEnd,
    lineStart: startLine.line,
    lineEnd: endLine.line,
    headingPartLength: kind === "section" ? startLine.charEnd - startLine.charStart : 0,
  };
}

/**
 * The §2.1 partition property, asserted at runtime: a violated partition means this module
 * malfunctioned, and silently emitting a plan over wrong ranges would be a confident wrong
 * answer — the one failure mode the product exists to avoid.
 */
function assertPartition(slices: PlanSectionSlice[], source: string): void {
  let cursor = 0;
  for (const slice of slices) {
    if (slice.charStart !== cursor || slice.charEnd < slice.charStart) {
      throw new Error(
        `Internal error: plan sections do not partition the document (gap or overlap at char ${cursor}).`,
      );
    }
    cursor = slice.charEnd;
  }
  if (cursor !== source.length) {
    throw new Error(
      `Internal error: plan sections cover ${cursor} of ${source.length} source characters.`,
    );
  }
  if (slices.map((slice) => slice.raw).join("") !== source) {
    throw new Error("Internal error: reassembled plan sections are not byte-identical to the source.");
  }
}
