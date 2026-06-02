import type { CompactSection, DocumentProfile, OptimizerWarning, RuleRecord } from "./types.js";

type OptimizerProfileInput = Pick<DocumentProfile, "sourceText" | "sections" | "rules">;

interface SourceLine {
  line: number;
  text: string;
  charStart: number;
  charEnd: number;
}

interface SourceLocation {
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
}

interface SectionLocation extends SourceLocation {
  h: string;
}

interface WarningDraft extends Omit<OptimizerWarning, "id"> {}

const LONG_SECTION_CHAR_THRESHOLD = 720;
const LONG_SECTION_LINE_THRESHOLD = 10;
const MAX_EVIDENCE_CHARS = 180;

const VAGUE_PATTERNS: RegExp[] = [
  /\bbe\s+(smart|helpful|careful|thoughtful|good|better|clear|useful)\b/i,
  /\buse\s+(good\s+)?judg(e)?ment\b/i,
  /\bmake\s+(it|the output|the result|things?)\s+(better|good|clear|useful)\b/i,
  /\bhandle\s+(edge cases|errors|issues|problems)\s+gracefully\b/i,
  /\bdo\s+the\s+right\s+thing\b/i,
  /\bkeep\s+(quality|the quality)\s+high\b/i,
  /\bas\s+appropriate\b/i,
];

const SPLIT_TOPIC_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "conversion", pattern: /\b(convert|conversion|parser|canonical|toon|profile)\b/i },
  { label: "release", pattern: /\b(release|changelog|version|publish)\b/i },
  { label: "privacy", pattern: /\b(privacy|telemetry|storage|secrets?|source document)\b/i },
  { label: "ui", pattern: /\b(ui|interface|copy|screen|browser)\b/i },
  { label: "testing", pattern: /\b(test|smoke|build|validation|round trip)\b/i },
  { label: "docs", pattern: /\b(docs?|readme|documentation|examples?)\b/i },
  { label: "skills", pattern: /\b(skill|workflow|procedure|on-demand)\b/i },
];

export function analyzeOptimizerWarnings(profile: OptimizerProfileInput): OptimizerWarning[] {
  const lines = buildSourceLines(profile.sourceText);
  const sectionLocations = buildSectionLocations(lines, profile.sourceText);
  const drafts: WarningDraft[] = [];

  drafts.push(...findDuplicateRules(profile.rules, lines));
  drafts.push(...findVagueRules(profile.rules, lines));
  drafts.push(...findLongSections(profile.sections, sectionLocations, profile.sourceText));
  drafts.push(...findSplitCandidates(profile.sections, sectionLocations, profile.sourceText));

  return drafts.map((draft, index) => ({
    id: `ow${String(index + 1).padStart(3, "0")}`,
    ...draft,
  }));
}

function findDuplicateRules(rules: RuleRecord[], lines: SourceLine[]): WarningDraft[] {
  const warnings: WarningDraft[] = [];
  const seen = new Map<string, RuleRecord>();
  const usedLines = new Set<number>();

  for (const rule of rules) {
    const key = normalizeRule(rule.rule);
    const location = findLineForText(rule.rule, lines, usedLines);
    if (location) {
      usedLines.add(location.lineStart);
    }
    if (key.length < 12) {
      continue;
    }

    const previous = seen.get(key);
    if (!previous) {
      seen.set(key, rule);
      continue;
    }

    warnings.push({
      kind: "duplicate_rule",
      severity: "warning",
      message: `Possible duplicate rule in "${rule.scope}".`,
      suggestion: "Consolidate repeated rules or keep both only if the distinction supports traceability or task accuracy.",
      evidence: truncateEvidence(rule.rule),
      ...location,
    });
  }

  return warnings;
}

function findVagueRules(rules: RuleRecord[], lines: SourceLine[]): WarningDraft[] {
  const warnings: WarningDraft[] = [];
  const usedLines = new Set<number>();

  for (const rule of rules) {
    if (!VAGUE_PATTERNS.some((pattern) => pattern.test(rule.rule))) {
      continue;
    }

    const location = findLineForText(rule.rule, lines, usedLines);
    if (location) {
      usedLines.add(location.lineStart);
    }

    warnings.push({
      kind: "vague_rule",
      severity: "warning",
      message: `Possibly vague instruction in "${rule.scope}".`,
      suggestion: "Replace vague phrasing with a concrete trigger, action, constraint, or acceptance criterion.",
      evidence: truncateEvidence(rule.rule),
      ...location,
    });
  }

  return warnings;
}

function findLongSections(
  sections: CompactSection[],
  sectionLocations: SectionLocation[],
  sourceText: string,
): WarningDraft[] {
  const warnings: WarningDraft[] = [];
  const usedSectionIndexes = new Set<number>();

  for (const section of sections) {
    const bodyLines = section.body.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
    const bodyChars = section.body.trim().length;
    if (bodyChars < LONG_SECTION_CHAR_THRESHOLD && bodyLines.length < LONG_SECTION_LINE_THRESHOLD) {
      continue;
    }

    const location = findSectionLocation(section, sectionLocations, usedSectionIndexes, sourceText);
    warnings.push({
      kind: "long_section",
      severity: "info",
      message: `Long section: "${section.h}".`,
      suggestion: "Review whether this section mixes concerns or should move procedural detail into an on-demand skill.",
      evidence: `${bodyChars} chars across ${bodyLines.length} non-empty lines`,
      ...location,
    });
  }

  return warnings;
}

function findSplitCandidates(
  sections: CompactSection[],
  sectionLocations: SectionLocation[],
  sourceText: string,
): WarningDraft[] {
  const warnings: WarningDraft[] = [];
  const usedSectionIndexes = new Set<number>();

  for (const section of sections) {
    const triggerLabels = extractTaskTriggers(section.body);
    const topicLabels = extractTopicLabels(section.body);
    const overloaded = triggerLabels.length >= 3 || (section.body.length >= 420 && topicLabels.length >= 4);
    if (!overloaded) {
      continue;
    }

    const location = findSectionLocation(section, sectionLocations, usedSectionIndexes, sourceText);
    const labels = triggerLabels.length >= 3 ? triggerLabels.slice(0, 4) : topicLabels.slice(0, 5);
    warnings.push({
      kind: "split_candidate",
      severity: "info",
      message: `Possible split candidate: "${section.h}".`,
      suggestion: "Separate always-on rules from task-triggered workflows, policies, or skills before converting.",
      evidence: labels.length > 0 ? truncateEvidence(`Detected themes: ${labels.join(", ")}`) : undefined,
      ...location,
    });
  }

  return warnings;
}

function buildSourceLines(sourceText: string): SourceLine[] {
  const rawLines = sourceText.split(/\r\n|\r|\n/);
  const lines: SourceLine[] = [];
  let charStart = 0;

  for (let index = 0; index < rawLines.length; index += 1) {
    const text = rawLines[index] ?? "";
    const charEnd = charStart + text.length;
    lines.push({
      line: index + 1,
      text,
      charStart,
      charEnd,
    });

    const nextTwo = sourceText.slice(charEnd, charEnd + 2);
    const nextOne = sourceText.slice(charEnd, charEnd + 1);
    const newlineLength = nextTwo === "\r\n" ? 2 : nextOne === "\n" || nextOne === "\r" ? 1 : 0;
    charStart = charEnd + newlineLength;
  }

  return lines;
}

function buildSectionLocations(lines: SourceLine[], sourceText: string): SectionLocation[] {
  const headingLines = lines
    .map((line, index) => ({ line, index, heading: parseMarkdownHeading(line.text) }))
    .filter((entry): entry is { line: SourceLine; index: number; heading: string } => entry.heading !== undefined);

  if (headingLines.length === 0) {
    const lastLine = lines.at(-1);
    return [
      {
        h: "Document",
        lineStart: 1,
        lineEnd: lastLine?.line ?? 1,
        charStart: 0,
        charEnd: sourceText.length,
      },
    ];
  }

  return headingLines.map((entry, index) => {
    const next = headingLines[index + 1];
    const endLine = next ? lines[Math.max(0, next.index - 1)] : lines.at(-1);
    return {
      h: entry.heading,
      lineStart: entry.line.line,
      lineEnd: endLine?.line ?? entry.line.line,
      charStart: entry.line.charStart,
      charEnd: endLine?.charEnd ?? entry.line.charEnd,
    };
  });
}

function parseMarkdownHeading(line: string): string | undefined {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  return match?.[2]?.trim();
}

function findLineForText(text: string, lines: SourceLine[], usedLines: Set<number>): SourceLocation | undefined {
  const wanted = normalizeLineText(text);
  if (!wanted) {
    return undefined;
  }

  for (const line of lines) {
    if (usedLines.has(line.line)) {
      continue;
    }
    const candidate = normalizeLineText(line.text);
    if (candidate === wanted || candidate.includes(wanted)) {
      return {
        lineStart: line.line,
        lineEnd: line.line,
        charStart: line.charStart,
        charEnd: line.charEnd,
      };
    }
  }

  return undefined;
}

function findSectionLocation(
  section: CompactSection,
  locations: SectionLocation[],
  usedIndexes: Set<number>,
  sourceText: string,
): SourceLocation | undefined {
  const normalizedHeading = normalizeLineText(section.h);
  for (let index = 0; index < locations.length; index += 1) {
    const location = locations[index];
    if (usedIndexes.has(index)) {
      continue;
    }
    if (normalizeLineText(location.h) === normalizedHeading) {
      usedIndexes.add(index);
      return {
        lineStart: location.lineStart,
        lineEnd: location.lineEnd,
        charStart: location.charStart,
        charEnd: location.charEnd,
      };
    }
  }

  const charStart = sourceText.indexOf(section.body.trim());
  if (charStart < 0) {
    return undefined;
  }
  return {
    lineStart: sourceText.slice(0, charStart).split(/\r\n|\r|\n/).length,
    lineEnd: sourceText.slice(0, charStart + section.body.length).split(/\r\n|\r|\n/).length,
    charStart,
    charEnd: charStart + section.body.length,
  };
}

function extractTaskTriggers(body: string): string[] {
  const triggers: string[] = [];
  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^(when|before|after|if)\s+([^,.]{8,90})/i);
    if (!match) {
      continue;
    }
    triggers.push(`${match[1].toLowerCase()} ${match[2].trim().toLowerCase()}`);
  }
  return uniqueLabels(triggers);
}

function extractTopicLabels(body: string): string[] {
  const labels: string[] = [];
  for (const topic of SPLIT_TOPIC_PATTERNS) {
    if (topic.pattern.test(body)) {
      labels.push(topic.label);
    }
  }
  return labels;
}

function normalizeRule(rule: string): string {
  return normalizeLineText(rule).replace(/[.!?]+$/g, "");
}

function normalizeLineText(text: string): string {
  return text
    .replace(/^[-+*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function truncateEvidence(evidence: string): string {
  const normalized = evidence.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_EVIDENCE_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_EVIDENCE_CHARS - 3).trimEnd()}...`;
}

function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of labels) {
    if (seen.has(label)) {
      continue;
    }
    seen.add(label);
    result.push(label);
  }
  return result;
}
