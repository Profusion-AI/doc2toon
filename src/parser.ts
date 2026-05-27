import type {
  BudgetJson,
  CanonicalDocument,
  CompactDocJson,
  CompactSection,
  DefinitionRecord,
  DocumentProfile,
  LosslessDocBlock,
  LosslessDocJson,
  MixedJson,
  ParseOptions,
  RuleRecord,
  StructureStats,
  TableJson,
} from "./types.js";

interface MarkdownState {
  blocks: LosslessDocBlock[];
  nextId: number;
  headingStack: Array<{ level: number; id: string }>;
  listStack: Array<string | undefined>;
  title: string | null;
}

interface DefinitionLabels {
  type: string;
  def: string;
  ex: string;
  tags: string;
  hasDefLabel: boolean;
  hasAnyLabel: boolean;
}

export function parseDocument(input: string, options: ParseOptions): CanonicalDocument {
  const profile = profileDocument(input, options);
  return buildCanonical(profile, options);
}

export function profileDocument(
  input: string,
  options: Pick<ParseOptions, "sourceType" | "flavor">,
): DocumentProfile {
  const losslessBlocks =
    options.flavor === "markdown"
      ? parseMarkdown(input, options.sourceType)
      : parsePlainText(input, options.sourceType);

  const sections = blocksToSections(losslessBlocks);
  const tables = extractTables(losslessBlocks);
  const definitions = extractDefinitions(sections);
  const rules = extractRules(sections);
  const stats = buildStats(input, losslessBlocks, tables, definitions, rules);
  const name = chooseProfile(stats);

  return {
    name,
    title: losslessBlocks.document.title,
    sourceType: options.sourceType,
    flavor: options.flavor,
    sourceText: input,
    sourceChars: input.length,
    losslessBlocks,
    sections,
    definitions,
    rules,
    tables,
    stats,
  };
}

export function buildCanonical(profile: DocumentProfile, options: Pick<ParseOptions, "mode">): CanonicalDocument {
  if (options.mode === "record") {
    return buildRecordCanonical(profile);
  }

  if (options.mode === "budget") {
    return buildBudgetCanonical(profile, {
      targetChars: null,
      targetTokens: null,
      maxSnippetChars: 360,
    });
  }

  return buildLosslessCanonical(profile);
}

export function buildLosslessCanonical(profile: DocumentProfile): CanonicalDocument {
  if (profile.name === "table" && profile.tables.length > 0) {
    return { rows: profile.tables.flat() };
  }

  return {
    doc: {
      title: profile.title,
      profile: profile.name,
      lossy: false,
    },
    sections: profile.sections.length > 0 ? profile.sections : [{ h: profile.title ?? "Document", body: profile.sourceText.trim() }],
  };
}

export function buildRecordCanonical(profile: DocumentProfile): CanonicalDocument {
  if (profile.name === "table" && profile.tables.length > 0) {
    return { rows: profile.tables.flat() };
  }

  if (profile.name === "requirements" && profile.rules.length > 0) {
    return { rules: profile.rules };
  }

  if ((profile.name === "definitions" || profile.name === "mixed") && profile.definitions.length > 0) {
    return { defs: profile.definitions };
  }

  if (profile.rules.length > 0) {
    return { rules: profile.rules };
  }

  return buildLosslessCanonical(profile);
}

export function buildBudgetCanonical(
  profile: DocumentProfile,
  options: {
    targetChars: number | null;
    targetTokens: number | null;
    maxSnippetChars: number;
  },
): BudgetJson {
  const definitions = profile.definitions
    .map((entry) => ({
      ...entry,
      def: truncateText(entry.def, options.maxSnippetChars),
      ex: truncateText(entry.ex, Math.floor(options.maxSnippetChars / 2)),
    }))
    .slice(0, 120);

  const rules = profile.rules
    .map((entry) => ({
      ...entry,
      rule: truncateText(entry.rule, options.maxSnippetChars),
      exception: truncateText(entry.exception, Math.floor(options.maxSnippetChars / 3)),
      risk: truncateText(entry.risk, Math.floor(options.maxSnippetChars / 3)),
    }))
    .slice(0, 160);

  const budgetSections = profile.sections
    .map((section) => {
      const points = extractBudgetPoints(section.body)
        .map((point) => truncateText(point, Math.floor(options.maxSnippetChars / 2)))
        .slice(0, 5);
      return {
        h: section.h,
        pts: points.length > 0 ? points.join(" | ") : truncateText(section.body, options.maxSnippetChars),
      };
    })
    .filter((section) => section.pts.length > 0)
    .slice(0, 80);

  const coverage = profile.sections
    .map((section) => ({
      h: section.h,
      kept: Math.min(section.body.length, options.maxSnippetChars),
      dropped: Math.max(0, section.body.length - options.maxSnippetChars),
    }))
    .slice(0, 120);

  const result: BudgetJson = {
    doc: {
      title: profile.title,
      profile: profile.name,
      lossy: true,
      source_chars: profile.sourceChars,
      target_chars: options.targetChars,
      target_tokens: options.targetTokens,
      coverage_notes: "Retained detected defs, rules, section points, examples, and caveats.",
    },
    cov: coverage,
  };

  if (definitions.length > 0) {
    result.defs = definitions;
  }
  if (rules.length > 0) {
    result.rules = rules;
  }
  if (budgetSections.length > 0) {
    result.sections = budgetSections;
  }

  return result;
}

export function parseMarkdown(input: string, sourceType: LosslessDocJson["document"]["source_type"]): LosslessDocJson {
  const lines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const state: MarkdownState = {
    blocks: [],
    nextId: 1,
    headingStack: [],
    listStack: [],
    title: null,
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      const fenceToken = fence[1];
      const codeLines = [line];
      i += 1;
      while (i < lines.length) {
        codeLines.push(lines[i] ?? "");
        if ((lines[i] ?? "").trimStart().startsWith(fenceToken)) {
          i += 1;
          break;
        }
        i += 1;
      }
      addBlock(state, "code", 0, codeLines.join("\n"), currentHeadingParent(state));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const parent = nearestHeadingParent(state, level);
      const block = addBlock(state, "heading", level, text, parent);
      state.headingStack = state.headingStack.filter((entry) => entry.level < level);
      state.headingStack.push({ level, id: block.id });
      state.listStack = [];
      if (level === 1 && state.title === null) {
        state.title = text;
      }
      i += 1;
      continue;
    }

    if (/^\s{0,3}(([-*_])\s*){3,}$/.test(line.trim())) {
      addBlock(state, "divider", 0, line, currentHeadingParent(state));
      state.listStack = [];
      i += 1;
      continue;
    }

    if (looksLikeTableStart(lines, i)) {
      const tableLines = [line, lines[i + 1] ?? ""];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") {
        tableLines.push(lines[i] ?? "");
        i += 1;
      }
      addBlock(state, "table", 0, tableLines.join("\n"), currentHeadingParent(state));
      state.listStack = [];
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines = [line];
      i += 1;
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) {
        quoteLines.push(lines[i] ?? "");
        i += 1;
      }
      addBlock(state, "quote", 0, quoteLines.join("\n"), currentHeadingParent(state));
      state.listStack = [];
      continue;
    }

    const listItem = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
    if (listItem) {
      const indent = listItem[1].replace(/\t/g, "    ").length;
      const level = Math.floor(indent / 2) + 1;
      const parent = level > 1 ? state.listStack[level - 2] ?? currentHeadingParent(state) : currentHeadingParent(state);
      const block = addBlock(state, "list_item", level, listItem[3], parent);
      state.listStack[level - 1] = block.id;
      state.listStack.length = level;
      i += 1;
      continue;
    }

    const paragraphLines = [line];
    i += 1;
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && !isMarkdownBlockStart(lines, i)) {
      paragraphLines.push(lines[i] ?? "");
      i += 1;
    }
    addBlock(state, "paragraph", 0, paragraphLines.join("\n"), currentHeadingParent(state));
    state.listStack = [];
  }

  return {
    document: {
      title: state.title,
      source_type: sourceType,
      blocks: state.blocks,
    },
  };
}

export function parsePlainText(input: string, sourceType: LosslessDocJson["document"]["source_type"]): LosslessDocJson {
  const chunks = input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const blocks: LosslessDocBlock[] = [];
  let title: string | null = null;
  let currentHeading: string | null = null;

  chunks.forEach((chunk) => {
    const isHeading = isObviousPlainTextHeading(chunk, blocks.length, chunks.length);
    if (isHeading) {
      blocks.push({ id: blockId(blocks.length + 1), type: "heading", level: 1, text: chunk, parent: null });
      currentHeading = blockId(blocks.length);
      if (title === null) {
        title = chunk;
      }
      return;
    }

    blocks.push({
      id: blockId(blocks.length + 1),
      type: "paragraph",
      level: 0,
      text: chunk,
      parent: currentHeading,
    });
  });

  return {
    document: {
      title,
      source_type: sourceType,
      blocks,
    },
  };
}

function blocksToSections(lossless: LosslessDocJson): CompactSection[] {
  const sections: CompactSection[] = [];
  let active: CompactSection | undefined;

  const flush = () => {
    if (!active) {
      return;
    }
    active.body = active.body.trim();
    sections.push(active);
  };

  for (const block of lossless.document.blocks) {
    if (block.type === "heading") {
      flush();
      active = { h: block.text, body: "" };
      continue;
    }

    if (!active) {
      active = { h: lossless.document.title ?? "Document", body: "" };
    }

    const text = blockToSectionText(block);
    if (text) {
      active.body += active.body ? `\n\n${text}` : text;
    }
  }

  flush();
  return sections;
}

function blockToSectionText(block: LosslessDocBlock): string {
  if (block.type === "divider") {
    return "";
  }
  if (block.type === "list_item") {
    return `${"  ".repeat(Math.max(0, block.level - 1))}- ${block.text}`;
  }
  return block.text;
}

function extractTables(lossless: LosslessDocJson): Array<Record<string, string>[]> {
  return lossless.document.blocks
    .filter((block) => block.type === "table")
    .map((block) => parseMarkdownTable(block.text))
    .filter((table) => table.length > 0);
}

function parseMarkdownTable(tableText: string): Record<string, string>[] {
  const lines = tableText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) {
    return [];
  }

  const headers = splitMarkdownTableRow(lines[0]).map(normalizeHeader);
  return lines.slice(2).map((line) => {
    const cells = splitMarkdownTableRow(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header || `c${index + 1}`] = cells[index] ?? "";
    });
    return row;
  });
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function extractDefinitions(sections: CompactSection[]): DefinitionRecord[] {
  const records: DefinitionRecord[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    const labeled = parseDefinitionLabels(section.body);
    const headingLooksTerm =
      looksLikeTerm(section.h) &&
      section.body.trim().length > 0 &&
      (labeled.hasDefLabel || (!labeled.hasAnyLabel && isDefinitionLikeSection(section.body)));
    if (headingLooksTerm) {
      const record = makeDefinitionRecord(records.length + 1, {
        term: section.h,
        type: labeled.type || inferDefinitionType(section.h, section.body),
        def: labeled.def || stripDefinitionNoise(section.body),
        ex: labeled.ex,
        tags: labeled.tags,
      });
      pushUniqueDefinition(records, seen, record);
    }

    for (const line of section.body.split("\n")) {
      const inline = parseInlineDefinition(line);
      if (inline) {
        pushUniqueDefinition(records, seen, makeDefinitionRecord(records.length + 1, inline));
      }
    }
  }

  return records.map((record, index) => ({ ...record, id: definitionId(index + 1) }));
}

function pushUniqueDefinition(records: DefinitionRecord[], seen: Set<string>, record: DefinitionRecord): void {
  const key = record.term.toLowerCase();
  if (seen.has(key) || record.def.length < 8) {
    return;
  }
  seen.add(key);
  records.push(record);
}

function makeDefinitionRecord(
  index: number,
  values: {
    term: string;
    type: string;
    def: string;
    ex?: string;
    tags?: string;
  },
): DefinitionRecord {
  return {
    id: definitionId(index),
    term: values.term.trim(),
    type: values.type.trim() || "concept",
    def: values.def.trim(),
    ex: values.ex?.trim() ?? "",
    tags: normalizeTags(values.tags ?? ""),
  };
}

function parseDefinitionLabels(body: string): DefinitionLabels {
  const result = {
    type: "",
    def: "",
    ex: "",
    tags: "",
    hasDefLabel: false,
    hasAnyLabel: false,
  };

  const labelPattern = /^(definition|def|type|example|ex|tags?)\s*:\s*(.+)$/i;
  const unlabeled: string[] = [];

  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/^[-*]\s+/, "").trim();
    const match = line.match(labelPattern);
    if (!match) {
      if (line) {
        unlabeled.push(line);
      }
      continue;
    }

    result.hasAnyLabel = true;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "definition" || key === "def") {
      result.def = appendText(result.def, value);
      result.hasDefLabel = true;
    } else if (key === "example" || key === "ex") {
      result.ex = appendText(result.ex, value);
    } else if (key === "tag" || key === "tags") {
      result.tags = normalizeTags(value);
    } else if (key === "type") {
      result.type = value.toLowerCase();
    }
  }

  if (!result.def && result.hasAnyLabel && unlabeled.length > 0) {
    result.def = unlabeled.join(" ");
  }

  return result;
}

function parseInlineDefinition(line: string): Omit<DefinitionRecord, "id"> | undefined {
  const cleaned = line.replace(/^[-*]\s+/, "").trim();
  const match =
    cleaned.match(/^\*\*([^*]{2,80})\*\*\s*[:\-]\s*(.{8,})$/) ??
    cleaned.match(/^([A-Z][A-Za-z0-9 /&'().-]{2,80})\s*[:\-]\s*(.{8,})$/);

  if (!match) {
    return undefined;
  }

  const term = match[1].trim();
  const def = match[2].trim();
  if (!looksLikeTerm(term) || /^(definition|example|type|tags?)$/i.test(term)) {
    return undefined;
  }

  return {
    term,
    type: inferDefinitionType(term, def),
    def,
    ex: "",
    tags: "",
  };
}

function extractRules(sections: CompactSection[]): RuleRecord[] {
  const rules: RuleRecord[] = [];

  for (const section of sections) {
    const candidates = section.body
      .split(/\n+|(?<=[.!?])\s+/)
      .map((candidate) => candidate.replace(/^[-*]\s+/, "").trim())
      .filter((candidate) => /\b(must|should|shall|required|requires|cannot|must not|prohibited|unless|except|risk)\b/i.test(candidate));

    for (const candidate of candidates) {
      rules.push({
        id: ruleId(rules.length + 1),
        scope: section.h,
        rule: candidate,
        exception: extractException(candidate),
        risk: /\brisk\b/i.test(candidate) ? candidate : "",
      });
    }
  }

  return rules;
}

function buildStats(
  sourceText: string,
  lossless: LosslessDocJson,
  tables: Array<Record<string, string>[]>,
  definitions: DefinitionRecord[],
  rules: RuleRecord[],
): StructureStats {
  const blocks = lossless.document.blocks;
  return {
    sourceChars: sourceText.length,
    lineCount: sourceText.split(/\r\n|\r|\n/).length,
    headingCount: blocks.filter((block) => block.type === "heading").length,
    paragraphCount: blocks.filter((block) => block.type === "paragraph").length,
    listItemCount: blocks.filter((block) => block.type === "list_item").length,
    tableCount: tables.length,
    tableRowCount: tables.reduce((sum, table) => sum + table.length, 0),
    definitionCount: definitions.length,
    ruleCount: rules.length,
  };
}

function chooseProfile(stats: StructureStats): DocumentProfile["name"] {
  const activeKinds = [
    stats.tableRowCount >= 2,
    stats.definitionCount >= 3,
    stats.ruleCount >= 3,
    stats.paragraphCount + stats.headingCount >= 4,
  ].filter(Boolean).length;

  if (activeKinds >= 3) {
    return "mixed";
  }
  if (
    stats.tableRowCount >= 2 &&
    stats.headingCount <= 1 &&
    stats.paragraphCount <= 1 &&
    stats.listItemCount === 0 &&
    stats.definitionCount === 0 &&
    stats.ruleCount === 0
  ) {
    return "table";
  }
  if (stats.definitionCount >= 3) {
    return stats.ruleCount >= 3 || stats.tableRowCount >= 2 ? "mixed" : "definitions";
  }
  if (stats.ruleCount >= 3) {
    return stats.tableRowCount >= 2 ? "mixed" : "requirements";
  }
  if (stats.tableRowCount >= 2) {
    return "mixed";
  }
  return "raw_prose";
}

function addBlock(
  state: MarkdownState,
  type: LosslessDocBlock["type"],
  level: number,
  text: string,
  parent: string | null,
): LosslessDocBlock {
  const block: LosslessDocBlock = {
    id: blockId(state.nextId),
    type,
    level,
    text,
    parent,
  };
  state.nextId += 1;
  state.blocks.push(block);
  return block;
}

function blockId(index: number): string {
  return `b${String(index).padStart(3, "0")}`;
}

function definitionId(index: number): string {
  return `d${String(index).padStart(3, "0")}`;
}

function ruleId(index: number): string {
  return `r${String(index).padStart(3, "0")}`;
}

function currentHeadingParent(state: MarkdownState): string | null {
  return state.headingStack.at(-1)?.id ?? null;
}

function nearestHeadingParent(state: MarkdownState, level: number): string | null {
  for (let index = state.headingStack.length - 1; index >= 0; index -= 1) {
    const heading = state.headingStack[index];
    if (heading.level < level) {
      return heading.id;
    }
  }
  return null;
}

function isMarkdownBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return (
    /^\s*(```+|~~~+)/.test(line) ||
    /^(#{1,6})\s+/.test(line) ||
    /^\s{0,3}(([-*_])\s*){3,}$/.test(line.trim()) ||
    looksLikeTableStart(lines, index) ||
    /^\s*>/.test(line) ||
    /^(\s*)([-+*]|\d+[.)])\s+/.test(line)
  );
}

function looksLikeTableStart(lines: string[], index: number): boolean {
  const header = lines[index] ?? "";
  const divider = lines[index + 1] ?? "";
  return header.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(divider);
}

function isObviousPlainTextHeading(chunk: string, index: number, chunkCount: number): boolean {
  if (chunkCount < 2 || chunk.includes("\n") || chunk.length > 80) {
    return false;
  }
  if (/[.!?,;:]$/.test(chunk)) {
    return false;
  }

  const letters = chunk.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) {
    return false;
  }

  const isAllCaps = letters === letters.toUpperCase();
  const words = chunk.split(/\s+/).filter(Boolean);
  const titleCaseWords = words.filter((word) => /^[A-Z][a-z0-9'/-]*$/.test(word));
  const isMostlyTitleCase = titleCaseWords.length >= Math.ceil(words.length * 0.75);

  return index === 0 && (isAllCaps || isMostlyTitleCase);
}

function normalizeHeader(header: string): string {
  const normalized = header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "col";
}

function looksLikeTerm(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 90) {
    return false;
  }
  if (/[.!?]$/.test(trimmed)) {
    return false;
  }
  return /[A-Za-z]/.test(trimmed);
}

function isDefinitionLikeSection(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length < 20 || trimmed.length > 700) {
    return false;
  }
  if (/^[-*]\s+/m.test(trimmed) || /^(```|~~~|\||>)/m.test(trimmed)) {
    return false;
  }
  return /\b(is\s+(a|an|the)|means|refers to|defined as|ability to|total amount|process of|method for)\b/i.test(trimmed);
}

function inferDefinitionType(term: string, body: string): string {
  const text = `${term} ${body}`.toLowerCase();
  if (/\b(metric|score|ratio|rate|index)\b/.test(text)) {
    return "metric";
  }
  if (/\b(method|process|workflow|practice|technique)\b/.test(text)) {
    return "method";
  }
  if (/\b(requirement|policy)\b/.test(text)) {
    return "rule";
  }
  return "concept";
}

function stripDefinitionNoise(body: string): string {
  return body
    .split("\n")
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => !/^(type|example|ex|tags?)\s*:/i.test(line))
    .map((line) => line.replace(/^(definition|def)\s*:\s*/i, ""))
    .filter(Boolean)
    .join(" ");
}

function normalizeTags(value: string): string {
  return value
    .split(/[,#]/)
    .map((tag) => tag.trim().replace(/\s+/g, "_").toLowerCase())
    .filter(Boolean)
    .join(",");
}

function appendText(current: string, next: string): string {
  return current ? `${current} ${next}` : next;
}

function extractException(rule: string): string {
  const match = rule.match(/\b(unless|except)\b(.+)$/i);
  return match ? `${match[1]}${match[2]}`.trim() : "";
}

function extractBudgetPoints(body: string): string[] {
  return body
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
    .filter((line) => {
      if (line.length <= 140 && /^([A-Z][A-Za-z0-9 -]+:|[0-9]+\.|- )/.test(line)) {
        return true;
      }
      return /\b(definition|means|principle|must|should|cannot|risk|caveat|example|because|therefore|important|target)\b/i.test(line);
    });
}

function truncateText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
}
