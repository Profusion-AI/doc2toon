export type SourceType = "markdown" | "text" | "stdin";

export type ParseFlavor = "markdown" | "text";

export type OutputMode = "lossless" | "record" | "budget";

export type ProfileName = "raw_prose" | "definitions" | "requirements" | "table" | "mixed";

export type ToonDelimiter = "," | "\t" | "|";

export type DelimiterOption = "auto" | ToonDelimiter;

export type LosslessBlockType =
  | "heading"
  | "paragraph"
  | "list_item"
  | "code"
  | "quote"
  | "table"
  | "divider";

export interface LosslessDocBlock {
  id: string;
  type: LosslessBlockType;
  level: number;
  text: string;
  parent: string | null;
}

export interface LosslessDocJson {
  document: {
    title: string | null;
    source_type: SourceType;
    blocks: LosslessDocBlock[];
  };
}

export interface CompactSection {
  h: string;
  body: string;
}

export interface DefinitionRecord {
  id: string;
  term: string;
  type: string;
  def: string;
  ex: string;
  tags: string;
}

export interface RuleRecord {
  id: string;
  scope: string;
  rule: string;
  exception: string;
  risk: string;
}

export interface CoverageRecord {
  h: string;
  kept: number;
  dropped: number;
}

export interface CompactDocJson {
  doc: {
    title: string | null;
    profile: ProfileName;
    lossy: false;
  };
  sections: CompactSection[];
}

export interface DefinitionsJson {
  defs: DefinitionRecord[];
}

export interface RulesJson {
  rules: RuleRecord[];
}

export interface TableJson {
  rows: Array<Record<string, string>>;
}

export interface MixedJson {
  doc: {
    title: string | null;
    profile: ProfileName;
    lossy: false;
  };
  defs?: DefinitionRecord[];
  rules?: RuleRecord[];
  rows?: Array<Record<string, string>>;
  sections?: CompactSection[];
}

export interface BudgetJson {
  doc: {
    title: string | null;
    profile: ProfileName;
    lossy: true;
    source_chars: number;
    target_chars: number | null;
    target_tokens: number | null;
    coverage_notes: string;
  };
  defs?: DefinitionRecord[];
  rules?: RuleRecord[];
  sections?: Array<{ h: string; pts: string }>;
  cov: CoverageRecord[];
}

export type CanonicalDocument = CompactDocJson | DefinitionsJson | RulesJson | TableJson | MixedJson | BudgetJson;

export interface StructureStats {
  sourceChars: number;
  lineCount: number;
  headingCount: number;
  paragraphCount: number;
  listItemCount: number;
  tableCount: number;
  tableRowCount: number;
  definitionCount: number;
  ruleCount: number;
}

export interface DocumentProfile {
  name: ProfileName;
  title: string | null;
  sourceType: SourceType;
  flavor: ParseFlavor;
  sourceText: string;
  sourceChars: number;
  losslessBlocks: LosslessDocJson;
  sections: CompactSection[];
  definitions: DefinitionRecord[];
  rules: RuleRecord[];
  tables: Array<Record<string, string>[]>;
  stats: StructureStats;
}

export interface ParseOptions {
  sourceType: SourceType;
  flavor: ParseFlavor;
  mode: OutputMode;
  targetChars?: number;
  targetTokens?: number;
  maxSnippetChars?: number;
}

export interface RoundTripResult {
  toon: string;
  decoded: unknown;
  valid: boolean;
}

export interface EncodingSelection extends RoundTripResult {
  delimiter: ToonDelimiter;
  toonChars: number;
  toonTokens: number;
}

export interface TokenRatioEstimate {
  charsPerToken: number;
  sourceTokens: number;
  toonTokens: number;
  tokensSaved: number;
  savingsPercent: number;
}

export interface ConversionStats {
  sourceChars: number;
  toonChars: number;
  charSavings: number;
  charSavingsPercent: number;
  sourceTokens: number;
  toonTokens: number;
  tokenSavings: number;
  tokenSavingsPercent: number;
  ratioEstimates: TokenRatioEstimate[];
  jsonBytes: number;
  toonBytes: number;
  jsonChars: number;
  jsonTokens: number;
  jsonToonTokenSavings: number;
  jsonToonTokenSavingsPercent: number;
}
