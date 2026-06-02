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

const LONG_SECTION_CHAR_THRESHOLD = 1500;
const LONG_SECTION_LINE_THRESHOLD = 40;
const LONG_SECTION_BULLET_THRESHOLD = 12;
const MAX_EVIDENCE_CHARS = 180;
const NEAR_DUPLICATE_DICE_THRESHOLD = 0.72;
const DUPLICATE_TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "or",
  "that",
  "this",
  "these",
  "those",
  "with",
  "before",
  "after",
  "when",
  "where",
  "must",
  "should",
  "shall",
  "required",
  "requires",
  "ensure",
  "make",
  "sure",
  "please",
  "agent",
  "reviewer",
  "converter",
  "tool",
  "cli",
  "document",
  "documents",
  "doc",
  "docs",
  "file",
  "files",
  "rule",
  "rules",
  "check",
]);

const VAGUE_PATTERNS: RegExp[] = [
  /\bbe\s+(smart|helpful|careful|thoughtful|good|better|clear|useful)\b/i,
  /\buse\s+(good\s+)?judg(e)?ment\b/i,
  /\bmake\s+(it|the output|the result|things?)\s+(better|good|clear|useful)\b/i,
  /\bhandle\s+(edge cases|errors|issues|problems)\s+gracefully\b/i,
  /\bdo\s+the\s+right\s+thing\b/i,
  /\buse\s+common\s+sense\b/i,
  /\bimprove\s+quality\b/i,
  /\bkeep\s+(quality|the quality)\s+high\b/i,
  /\b(be\s+concise|optimi[sz]e)\s+where\s+(possible|appropriate)\b/i,
  /\b(as|where)\s+appropriate\b/i,
  /\bmake\s+sure\s+everything\s+is\s+good\b/i,
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
  const seenRules: string[][] = [];
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
    if (previous) {
      warnings.push(buildDuplicateRuleWarning(rule, location));
      continue;
    }

    const tokens = tokenizeRule(key);
    const nearDuplicate = seenRules.find((previousTokens) => ruleSimilarity(tokens, previousTokens) >= NEAR_DUPLICATE_DICE_THRESHOLD);
    if (nearDuplicate) {
      warnings.push(buildDuplicateRuleWarning(rule, location));
      continue;
    }

    seen.set(key, rule);
    seenRules.push(tokens);
  }

  return warnings;
}

function buildDuplicateRuleWarning(rule: RuleRecord, location: SourceLocation | undefined): WarningDraft {
  return {
    kind: "duplicate_rule",
    severity: "warning",
    message: `Possible duplicate rule in "${rule.scope}".`,
    suggestion: "Merge these rules or keep only the version with the clearest action and scope.",
    evidence: truncateEvidence(rule.rule),
    ...location,
  };
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
      suggestion: "Rewrite as a concrete rule with an action, condition, and verification step.",
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
    const bulletCount = section.body.split(/\r\n|\r|\n/).filter((line) => /^\s*(?:[-+*]|\d+[.)])\s+/.test(line)).length;
    const bodyChars = section.body.trim().length;
    if (
      bodyChars <= LONG_SECTION_CHAR_THRESHOLD &&
      bodyLines.length <= LONG_SECTION_LINE_THRESHOLD &&
      bulletCount <= LONG_SECTION_BULLET_THRESHOLD
    ) {
      continue;
    }

    const location = findSectionLocation(section, sectionLocations, usedSectionIndexes, sourceText);
    warnings.push({
      kind: "long_section",
      severity: "info",
      message: `Long section: "${section.h}".`,
      suggestion: "Consider splitting this into a shorter canonical rule plus one or more task-specific skill files.",
      evidence: `${bodyChars} chars, ${bodyLines.length} non-empty lines, ${bulletCount} bullets`,
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
    const bulletClusters = countBulletClusters(section.body);
    const hasPolicyAndProcedure = hasPolicyRules(section.body) && hasProcedureSteps(section.body);
    const hasMixedSupportMaterial = countSupportMaterialTypes(section.body) >= 3;
    const genericTitle = isGenericSectionTitle(section.h);
    const overloaded =
      triggerLabels.length >= 3 ||
      (section.body.length >= 420 && topicLabels.length >= 4) ||
      (genericTitle && (bulletClusters >= 2 || hasPolicyAndProcedure || hasMixedSupportMaterial));
    if (!overloaded) {
      continue;
    }

    const location = findSectionLocation(section, sectionLocations, usedSectionIndexes, sourceText);
    const labels = triggerLabels.length >= 3 ? triggerLabels.slice(0, 4) : topicLabels.slice(0, 5);
    warnings.push({
      kind: "split_candidate",
      severity: "info",
      message: `Possible split candidate: "${section.h}".`,
      suggestion: "Keep the short canonical instruction here and move detailed procedure into a focused skill file.",
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
  return normalizeLineText(rule)
    .replace(/^please\s+/, "")
    .replace(/^make sure to\s+/, "")
    .replace(/^ensure that\s+/, "ensure ")
    .replace(/[.!?]+$/g, "");
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

function tokenizeRule(rule: string): string[] {
  return uniqueLabels(
    rule
      .split(/[^a-z0-9]+/i)
      .map(normalizeRuleToken)
      .filter((token) => token.length >= 3 && !DUPLICATE_TOKEN_STOPWORDS.has(token)),
  );
}

function normalizeRuleToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower.length > 4 && lower.endsWith("ies")) {
    return `${lower.slice(0, -3)}y`;
  }
  if (lower.length > 4 && lower.endsWith("s")) {
    return lower.slice(0, -1);
  }
  return lower;
}

function ruleSimilarity(left: string[], right: string[]): number {
  if (left.length < 4 || right.length < 4) {
    return 0;
  }

  const rightTokens = new Set(right);
  const shared = left.filter((token) => rightTokens.has(token)).length;
  return (2 * shared) / (left.length + right.length);
}

function countBulletClusters(body: string): number {
  let clusters = 0;
  let inCluster = false;

  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) {
      inCluster = false;
      continue;
    }
    if (!/^(?:[-+*]|\d+[.)])\s+/.test(line)) {
      continue;
    }
    if (!inCluster) {
      clusters += 1;
      inCluster = true;
    }
  }

  return clusters;
}

function hasPolicyRules(body: string): boolean {
  return /\b(must|must not|should|always|never|do not|requires?|prohibited|privacy|policy|approval)\b/i.test(body);
}

function hasProcedureSteps(body: string): boolean {
  return /\b(when|if|before|after|step|run|check|validate|write|update|prepare)\b/i.test(body);
}

function countSupportMaterialTypes(body: string): number {
  return [
    /\bexample\b/i,
    /\bcaveat|exception|unless\b/i,
    /\bcommand|npm run|```/i,
    /\bapproval|policy|privacy\b/i,
    /\bwhen|if|before|after\b/i,
  ].filter((pattern) => pattern.test(body)).length;
}

function isGenericSectionTitle(title: string): boolean {
  return /^(guidelines?|process|instructions?|workflow|notes?|procedure|policy|rules?)$/i.test(title.trim());
}
