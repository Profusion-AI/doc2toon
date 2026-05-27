#!/usr/bin/env node
import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { inspect } from "node:util";
import {
  buildBudgetCanonical,
  buildCanonical,
  buildLosslessCanonical,
  profileDocument,
} from "./parser.js";
import { prettyJson } from "./normalize.js";
import { calculateStats, decodeToJson, selectEncoding, targetReached } from "./toon.js";
import type {
  CanonicalDocument,
  ConversionStats,
  DelimiterOption,
  DocumentProfile,
  EncodingSelection,
  OutputMode,
  ParseFlavor,
  SourceType,
  ToonDelimiter,
} from "./types.js";

interface ConvertOptions {
  out?: string;
  mode: string;
  stdin?: boolean;
  type?: "markdown" | "md" | "text" | "txt";
  jsonSidecar?: boolean;
  stats?: boolean;
  delimiter?: string;
  targetChars?: string;
  targetTokens?: string;
  allowLossy?: boolean;
  charsPerToken?: string;
}

interface ProfileOptions {
  stdin?: boolean;
  type?: "markdown" | "md" | "text" | "txt";
  charsPerToken?: string;
}

interface DecodeOptions {
  out?: string;
}

const program = new Command();

program
  .name("doc2toon")
  .description("Profile text documents, choose compact canonical schemas, and encode valid TOON with official tooling.")
  .version("0.1.0");

program
  .command("profile")
  .argument("[input]", "Input .md or .txt file. Omit with --stdin or piped stdin.")
  .option("--stdin", "Read pasted/piped input from stdin.")
  .option("--type <type>", "Override parser type: markdown, md, text, txt.")
  .option("--chars-per-token <ratios>", "Comma-separated token-estimate ratios.", "3.5,4,4.5")
  .action(async (input: string | undefined, options: ProfileOptions) => {
    try {
      const { text, sourceType, flavor } = await ingestInput(input, options);
      const profile = profileDocument(text, { sourceType, flavor });
      printProfileReport(profile, parseCharsPerTokenRatios(options.charsPerToken));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("convert")
  .argument("[input]", "Input .md or .txt file. Omit with --stdin or piped stdin.")
  .option("--stdin", "Read pasted/piped input from stdin.")
  .option("--type <type>", "Override parser type: markdown, md, text, txt.")
  .option("--mode <mode>", "Output mode: lossless, record, or budget.", "lossless")
  .option("--delimiter <delimiter>", "TOON delimiter: auto, comma, tab, pipe, ',', '\\t', or '|'.", "auto")
  .option("--target-chars <chars>", "Target TOON character budget, mainly for budget mode.")
  .option("--target-tokens <tokens>", "Target estimated TOON token budget, mainly for budget mode.")
  .option("--chars-per-token <ratios>", "Comma-separated token-estimate ratios.", "3.5,4,4.5")
  .option("--allow-lossy", "Allow semantic compression when a budget cannot be reached losslessly.")
  .requiredOption("--out <path>", "Output .toon path.")
  .option("--json-sidecar", "Also write canonical JSON sidecar next to the .toon output.")
  .option("--stats", "Include JSON-vs-TOON stats in addition to source-vs-TOON metrics.")
  .action(async (input: string | undefined, options: ConvertOptions) => {
    try {
      await convertCommand(input, options);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("validate")
  .argument("<input>", "Input .toon file to decode with the official TOON decoder.")
  .action(async (input: string) => {
    try {
      const toon = await readFile(resolve(input), "utf8");
      decodeToJson(toon);
      console.log(`Valid TOON: ${input}`);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("decode")
  .argument("<input>", "Input .toon file.")
  .option("--out <path>", "Write decoded JSON to this file. Defaults to stdout.")
  .action(async (input: string, options: DecodeOptions) => {
    try {
      const toon = await readFile(resolve(input), "utf8");
      const decoded = decodeToJson(toon);
      if (options.out) {
        await writeOutput(resolve(options.out), prettyJson(decoded));
        console.log(`Decoded JSON written: ${options.out}`);
      } else {
        process.stdout.write(prettyJson(decoded));
      }
    } catch (error) {
      fail(error);
    }
  });

await program.parseAsync(process.argv);

async function convertCommand(input: string | undefined, options: ConvertOptions): Promise<void> {
  const mode = parseMode(options.mode);
  const delimiter = parseDelimiter(options.delimiter ?? "auto");
  const targetChars = parsePositiveInteger(options.targetChars, "--target-chars");
  const targetTokens = parsePositiveInteger(options.targetTokens, "--target-tokens");
  const charsPerTokenRatios = parseCharsPerTokenRatios(options.charsPerToken);
  const { text, sourceType, flavor } = await ingestInput(input, options);
  const profile = profileDocument(text, { sourceType, flavor });
  const outPath = resolveRequiredOut(options.out);

  const { canonicalJson, encoding, stats, lossless } = buildConversion(profile, {
    mode,
    delimiter,
    targetChars,
    targetTokens,
    allowLossy: Boolean(options.allowLossy),
    charsPerTokenRatios,
  });

  if (!encoding.valid) {
    await writeDebugFiles(outPath, canonicalJson, encoding.toon);
    throw new Error(`Round-trip validation failed. Debug files written beside ${outPath}.`);
  }

  await writeOutput(outPath, `${encoding.toon.trimEnd()}\n`);

  if (options.jsonSidecar) {
    await writeOutput(jsonSidecarPath(outPath), prettyJson(canonicalJson));
  }

  printConversionReport(profile, mode, lossless, encoding.delimiter, stats, {
    targetChars,
    targetTokens,
    charsPerTokenRatios,
    includeJsonStats: Boolean(options.stats),
  });

  console.log(`TOON written: ${outPath}`);
}

function buildConversion(
  profile: DocumentProfile,
  options: {
    mode: OutputMode;
    delimiter: DelimiterOption;
    targetChars?: number;
    targetTokens?: number;
    allowLossy: boolean;
    charsPerTokenRatios: number[];
  },
): {
  canonicalJson: CanonicalDocument;
  encoding: EncodingSelection;
  stats: ConversionStats;
  lossless: boolean;
} {
  if (options.mode !== "budget") {
    const canonicalJson = buildCanonical(profile, { mode: options.mode });
    const encoding = selectEncoding(canonicalJson, options.delimiter);
    const stats = calculateStats(profile.sourceText, canonicalJson, encoding.toon, options.charsPerTokenRatios);
    return { canonicalJson, encoding, stats, lossless: true };
  }

  if (options.targetChars === undefined && options.targetTokens === undefined) {
    throw new Error("Budget mode requires --target-chars or --target-tokens.");
  }

  const losslessCanonical = buildLosslessCanonical(profile);
  const losslessEncoding = selectEncoding(losslessCanonical, options.delimiter);
  const losslessStats = calculateStats(profile.sourceText, losslessCanonical, losslessEncoding.toon, options.charsPerTokenRatios);

  if (targetReached(losslessStats, options.targetChars, options.targetTokens)) {
    return {
      canonicalJson: losslessCanonical,
      encoding: losslessEncoding,
      stats: losslessStats,
      lossless: true,
    };
  }

  if (!options.allowLossy) {
    throw new Error(
      `Target cannot be reached losslessly. Source is ${profile.sourceChars} chars; shortest lossless TOON is ${losslessStats.toonChars} chars / ~${losslessStats.toonTokens} tokens. Use --mode budget --allow-lossy to produce semantic compression.`,
    );
  }

  return buildLossyBudgetConversion(profile, options);
}

function buildLossyBudgetConversion(
  profile: DocumentProfile,
  options: {
    delimiter: DelimiterOption;
    targetChars?: number;
    targetTokens?: number;
    charsPerTokenRatios: number[];
  },
): {
  canonicalJson: CanonicalDocument;
  encoding: EncodingSelection;
  stats: ConversionStats;
  lossless: boolean;
} {
  const maxSnippetAttempts = [720, 480, 320, 220, 140, 90, 55];
  let best:
    | {
        canonicalJson: CanonicalDocument;
        encoding: EncodingSelection;
        stats: ConversionStats;
        lossless: boolean;
      }
    | undefined;

  for (const maxSnippetChars of maxSnippetAttempts) {
    const canonicalJson = buildBudgetCanonical(profile, {
      targetChars: options.targetChars ?? null,
      targetTokens: options.targetTokens ?? null,
      maxSnippetChars,
    });
    const encoding = selectEncoding(canonicalJson, options.delimiter);
    const stats = calculateStats(profile.sourceText, canonicalJson, encoding.toon, options.charsPerTokenRatios);
    const candidate = { canonicalJson, encoding, stats, lossless: false };
    best = candidate;

    if (targetReached(stats, options.targetChars, options.targetTokens)) {
      return candidate;
    }
  }

  if (!best) {
    throw new Error("Budget conversion failed before a candidate could be generated.");
  }

  return best;
}

async function ingestInput(
  input: string | undefined,
  options: { stdin?: boolean; type?: "markdown" | "md" | "text" | "txt" },
): Promise<{ text: string; sourceType: SourceType; flavor: ParseFlavor }> {
  if (options.stdin || (!input && !process.stdin.isTTY)) {
    const text = await readStdin();
    const flavor = parseFlavorOverride(options.type) ?? "text";
    return { text, sourceType: "stdin", flavor };
  }

  if (!input) {
    throw new Error("Missing input file. Pass a .md/.txt file or use --stdin.");
  }

  const inputPath = resolve(input);
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${input}`);
  }

  const text = await readFile(inputPath, "utf8");
  const flavor = parseFlavorOverride(options.type) ?? inferFlavor(inputPath);
  const sourceType: SourceType = flavor === "markdown" ? "markdown" : "text";
  return { text, sourceType, flavor };
}

function parseMode(value: string): OutputMode {
  if (value === "lossless" || value === "record" || value === "budget") {
    return value;
  }
  if (value === "lossless-doc") {
    return "lossless";
  }
  if (value === "llm-context") {
    return "budget";
  }
  throw new Error(`Unsupported mode: ${value}. Expected lossless, record, or budget.`);
}

function parseFlavorOverride(value: "markdown" | "md" | "text" | "txt" | undefined): ParseFlavor | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "markdown" || value === "md") {
    return "markdown";
  }
  if (value === "text" || value === "txt") {
    return "text";
  }
  throw new Error(`Unsupported input type: ${value}. Expected markdown, md, text, or txt.`);
}

function parseDelimiter(value: string): DelimiterOption {
  if (value === "auto") {
    return "auto";
  }
  if (value === "comma" || value === ",") {
    return ",";
  }
  if (value === "tab" || value === "\\t" || value === "\t") {
    return "\t";
  }
  if (value === "pipe" || value === "|") {
    return "|";
  }
  throw new Error(`Unsupported delimiter: ${value}. Expected auto, comma, tab, or pipe.`);
}

function parsePositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseCharsPerTokenRatios(value: string | undefined): number[] {
  const parsed = (value ?? "3.5,4,4.5")
    .split(",")
    .map((part) => Number.parseFloat(part.trim()))
    .filter((part) => Number.isFinite(part) && part > 0);

  if (parsed.length === 0) {
    throw new Error("--chars-per-token must include at least one positive number.");
  }

  return parsed;
}

function inferFlavor(inputPath: string): ParseFlavor {
  const extension = extname(inputPath).toLowerCase();
  if (extension === ".md" || extension === ".markdown") {
    return "markdown";
  }
  if (extension === ".txt" || extension === ".text") {
    return "text";
  }
  throw new Error(`Unsupported input extension: ${extension || "(none)"}. Use --type to override.`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function resolveRequiredOut(out: string | undefined): string {
  if (!out) {
    throw new Error("Missing --out path.");
  }
  return resolve(out);
}

async function writeOutput(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function jsonSidecarPath(outPath: string): string {
  return outPath.endsWith(".toon") ? outPath.replace(/\.toon$/i, ".json") : `${outPath}.json`;
}

async function writeDebugFiles(outPath: string, canonicalJson: unknown, attemptedToon: string): Promise<void> {
  await writeOutput(`${outPath}.debug.json`, prettyJson(canonicalJson));
  await writeOutput(`${outPath}.failed.toon`, `${attemptedToon.trimEnd()}\n`);
}

function printProfileReport(profile: DocumentProfile, charsPerTokenRatios: number[]): void {
  console.log("Profile:");
  console.log(`  detected: ${profile.name}`);
  console.log(`  source type: ${profile.sourceType}`);
  console.log(`  source chars: ${profile.sourceChars}`);
  console.log(`  token estimates: ${formatRatioEstimates(profile.sourceChars, charsPerTokenRatios)}`);
  console.log(`  headings: ${profile.stats.headingCount}`);
  console.log(`  paragraphs: ${profile.stats.paragraphCount}`);
  console.log(`  list items: ${profile.stats.listItemCount}`);
  console.log(`  tables: ${profile.stats.tableCount} (${profile.stats.tableRowCount} rows)`);
  console.log(`  definitions: ${profile.stats.definitionCount}`);
  console.log(`  rules: ${profile.stats.ruleCount}`);
}

function printConversionReport(
  profile: DocumentProfile,
  mode: OutputMode,
  lossless: boolean,
  delimiter: ToonDelimiter,
  stats: ConversionStats,
  options: {
    targetChars?: number;
    targetTokens?: number;
    charsPerTokenRatios: number[];
    includeJsonStats: boolean;
  },
): void {
  const reached =
    options.targetChars !== undefined || options.targetTokens !== undefined
      ? targetReached(stats, options.targetChars, options.targetTokens)
      : undefined;

  console.log("Metrics:");
  console.log(`  detected profile: ${profile.name}`);
  console.log(`  mode: ${mode}`);
  console.log(`  lossless: ${lossless ? "true" : "false"}`);
  console.log(`  delimiter: ${formatDelimiter(delimiter)}`);
  console.log(`  source chars: ${stats.sourceChars}`);
  console.log(`  TOON chars: ${stats.toonChars}`);
  console.log(`  character savings: ${stats.charSavings} (${stats.charSavingsPercent.toFixed(1)}%)`);
  console.log(`  source tokens: ~${stats.sourceTokens}`);
  console.log(`  TOON tokens: ~${stats.toonTokens}`);
  console.log(`  token savings: ~${stats.tokenSavings} (${stats.tokenSavingsPercent.toFixed(1)}%)`);
  console.log(`  chars/token estimates: ${stats.ratioEstimates.map(formatRatioEstimate).join("; ")}`);

  if (options.targetChars !== undefined) {
    console.log(`  target chars: ${options.targetChars}`);
  }
  if (options.targetTokens !== undefined) {
    console.log(`  target tokens: ${options.targetTokens}`);
  }
  if (reached !== undefined) {
    console.log(`  target reached: ${reached ? "true" : "false"}`);
    if (!reached) {
      console.log("  warning: target was not reached; the budget is probably below the retained semantic payload.");
    }
  }

  if (options.includeJsonStats) {
    console.log(`  canonical JSON chars: ${stats.jsonChars}`);
    console.log(`  canonical JSON tokens: ~${stats.jsonTokens}`);
    console.log(
      `  JSON -> TOON token savings: ~${stats.jsonToonTokenSavings} (${stats.jsonToonTokenSavingsPercent.toFixed(1)}%)`,
    );
  }
}

function formatRatioEstimates(chars: number, charsPerTokenRatios: number[]): string {
  return charsPerTokenRatios
    .map((charsPerToken) => `${charsPerToken}cpt=~${Math.round(chars / charsPerToken)}`)
    .join(", ");
}

function formatRatioEstimate(estimate: ConversionStats["ratioEstimates"][number]): string {
  return `${estimate.charsPerToken}cpt ${estimate.sourceTokens}->${estimate.toonTokens} (${estimate.savingsPercent.toFixed(1)}%)`;
}

function formatDelimiter(delimiter: ToonDelimiter): string {
  if (delimiter === "\t") {
    return "tab";
  }
  if (delimiter === "|") {
    return "pipe";
  }
  return "comma";
}

function fail(error: unknown): never {
  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
  } else {
    console.error(`Error: ${inspect(error)}`);
  }
  process.exit(1);
}
