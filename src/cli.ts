#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { inspect } from "node:util";
import { BudgetRefusedError, convertTextToToon, decodeToJsonText, validateToonText } from "./core.js";
import { estimateNodeTokenCount, NODE_TOKEN_ESTIMATOR_ID } from "./node-token-estimator.js";
import { prettyJson } from "./normalize.js";
import { buildContextPlan } from "./plan.js";
import { buildVerdict, runVerdict, VERDICT_SCHEMA_VERSION } from "./verdict.js";
import type {
  CodedWarning,
  ContextPlan,
  ContextPlanSection,
  ConversionResult,
  DelimiterOption,
  OutputMode,
  ParseFlavor,
  SourceType,
  ToonDelimiter,
  VerdictV1,
} from "./types.js";

// Every subcommand builds its data object first (the VerdictV1 wire object where one applies),
// then routes to the pretty renderer or JSON.stringify on --json. Exit-code contract
// (docs/verdict-schema-v1.md, decision 8): profile/convert/plan --json exit 0 for any
// representable verdict, including refused and keep_markdown; exit 1 with a JSON
// {"error":{code,message}} envelope on I/O, argument, and internal failures; validate --json
// keeps exit 1 on invalid TOON; --fail-on lets CI fail builds deliberately, never accidentally.
// plan is profile-shaped (toon_candidate withheld) and is the only surface that emits
// schema_version "1.1" with context_plan (docs/context-plan-design.md §3).

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
  json?: boolean;
  failOn?: string;
}

interface ProfileOptions {
  stdin?: boolean;
  type?: "markdown" | "md" | "text" | "txt";
  charsPerToken?: string;
  json?: boolean;
  failOn?: string;
}

interface PlanOptions {
  stdin?: boolean;
  type?: "markdown" | "md" | "text" | "txt";
  charsPerToken?: string;
  out?: string;
  json?: boolean;
  failOn?: string;
}

interface ValidateOptions {
  json?: boolean;
}

interface DecodeOptions {
  out?: string;
}

/** Carries the stable error code for the --json error envelope (mirrors the spec's Error component). */
class CliError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

// package.json sits one level above both src/ (dev via tsx) and dist/ (published build).
const { version: packageVersion } = createRequire(import.meta.url)("../package.json") as { version: string };

// Module-level consts used by command actions must initialize BEFORE program.parseAsync below:
// actions run during that top-level await, when anything declared after it is still in the
// temporal dead zone (functions hoist; consts do not).
const FAIL_ON_VERDICTS = new Set(["convert", "keep_markdown", "split_first", "review", "refused"]);
const FAIL_ON_SEVERITIES = new Set(["info", "warning"]);

const program = new Command();

// exitOverride is set before the subcommands are defined (settings are copied to subcommands at
// creation): commander-raised argument errors must reach the catch around parseAsync below so
// --json consumers get the decision-8 error envelope instead of an empty stdout.
program.exitOverride();

program
  .name("doc2toon")
  .description("Profile text documents, choose compact canonical schemas, and encode valid TOON with official tooling.")
  .version(packageVersion);

program
  .command("profile")
  .argument("[input]", "Input .md or .txt file. Omit with --stdin or piped stdin.")
  .option("--stdin", "Read pasted/piped input from stdin.")
  .option("--type <type>", "Override parser type: markdown, md, text, txt.")
  .option("--chars-per-token <ratios>", "Comma-separated token-estimate ratios.", "3.5,4,4.5")
  .option("--json", "Emit the verdict (schemas/verdict.v1.json) as JSON; the TOON candidate is withheld.")
  .option(
    "--fail-on <list>",
    'Comma-separated verdicts and/or severities that set exit code 1, e.g. "split_first,review" or "warning". "info" fails on any warning.',
  )
  .action(async (input: string | undefined, options: ProfileOptions) => {
    try {
      const failOn = parseFailOn(options.failOn);
      const { text, sourceType, flavor } = await ingestInput(input, options);
      const verdict = runVerdict(text, {
        sourceType,
        flavor,
        mode: "lossless",
        charsPerTokenRatios: parseCharsPerTokenRatios(options.charsPerToken),
        estimateTokenCount: estimateNodeTokenCount,
        estimator: NODE_TOKEN_ESTIMATOR_ID,
        includeToonCandidate: false,
      });

      if (options.json) {
        console.log(JSON.stringify(verdict, null, 2));
      } else {
        printVerdictReport(verdict);
      }
      applyFailOn(verdict, failOn);
    } catch (error) {
      fail(error, Boolean(options.json));
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
  .option("--out <path>", "Output .toon path. Required unless --json is set.")
  .option("--json-sidecar", "Also write canonical JSON sidecar next to the .toon output. Requires --out.")
  .option("--stats", "Include JSON-vs-TOON stats in the pretty report (no effect with --json).")
  .option("--json", "Emit the verdict (schemas/verdict.v1.json) with toon_candidate as JSON. A budget refusal is verdict \"refused\", exit 0.")
  .option(
    "--fail-on <list>",
    'Comma-separated verdicts and/or severities that set exit code 1, e.g. "split_first,review" or "warning". "info" fails on any warning.',
  )
  .action(async (input: string | undefined, options: ConvertOptions) => {
    try {
      await convertCommand(input, options);
    } catch (error) {
      fail(error, Boolean(options.json));
    }
  });

program
  .command("plan")
  .argument("[input]", "Input .md or .txt file. Omit with --stdin or piped stdin.")
  .option("--stdin", "Read pasted/piped input from stdin.")
  .option("--type <type>", "Override parser type: markdown, md, text, txt.")
  .option("--chars-per-token <ratios>", "Comma-separated token-estimate ratios.", "3.5,4,4.5")
  .option("--out <path>", "Write the hybrid Markdown document (converted sections become fenced toon blocks; kept sections stay byte-identical).")
  .option(
    "--json",
    "Emit the verdict (schema 1.1) with context_plan as JSON; the TOON candidate is withheld — the hybrid document is the artifact (--out).",
  )
  .option(
    "--fail-on <list>",
    'Comma-separated verdicts and/or severities that set exit code 1, keyed on the whole-document verdict, e.g. "split_first,review" or "warning". "info" fails on any warning.',
  )
  .action(async (input: string | undefined, options: PlanOptions) => {
    try {
      await planCommand(input, options);
    } catch (error) {
      fail(error, Boolean(options.json));
    }
  });

program
  .command("validate")
  .argument("<input>", "Input .toon file to decode with the official TOON decoder.")
  .option("--json", "Emit a ValidationResult JSON object. Invalid TOON still exits 1 (CI ergonomics).")
  .action(async (input: string, options: ValidateOptions) => {
    try {
      const toon = await readInputFile(input);
      const validation = validateToonText(toon);

      if (options.json) {
        const result = {
          schema_version: VERDICT_SCHEMA_VERSION,
          valid: validation.valid,
          error: validation.valid
            ? null
            : { code: "invalid_toon", message: validation.error ?? "TOON validation failed." },
        };
        console.log(JSON.stringify(result, null, 2));
        if (!validation.valid) {
          process.exitCode = 1;
        }
        return;
      }

      if (!validation.valid) {
        throw new Error(validation.error ?? "TOON validation failed.");
      }
      console.log(`Valid TOON: ${input}`);
    } catch (error) {
      fail(error, Boolean(options.json));
    }
  });

program
  .command("decode")
  .argument("<input>", "Input .toon file.")
  .option("--out <path>", "Write decoded JSON to this file. Defaults to stdout.")
  .action(async (input: string, options: DecodeOptions) => {
    try {
      const toon = await readInputFile(input);
      const decoded = decodeToJsonText(toon);
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

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (!(error instanceof CommanderError)) {
    throw error;
  }
  // Help and --version exit cleanly; argument errors get the decision-8 envelope under --json.
  // Commander has already written its human-readable message to stderr either way. Parsing
  // failed, so the raw argv scan is the only reliable --json signal.
  if (error.exitCode === 0) {
    process.exitCode = 0;
  } else {
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify({ error: { code: "bad_request", message: error.message } }, null, 2));
    }
    process.exitCode = error.exitCode ?? 1;
  }
}

async function convertCommand(input: string | undefined, options: ConvertOptions): Promise<void> {
  const json = Boolean(options.json);
  const failOn = parseFailOn(options.failOn);
  const mode = parseMode(options.mode);
  const delimiter = parseDelimiter(options.delimiter ?? "auto");
  const targetChars = parsePositiveInteger(options.targetChars, "--target-chars");
  const targetTokens = parsePositiveInteger(options.targetTokens, "--target-tokens");
  if (mode === "budget" && targetChars === undefined && targetTokens === undefined) {
    throw new CliError("bad_request", "Budget mode requires --target-chars or --target-tokens.");
  }
  const charsPerTokenRatios = parseCharsPerTokenRatios(options.charsPerToken);
  // Flag validation happens before any input is read: a missing --out must fail immediately,
  // not after stdin has been consumed to EOF (which never arrives for a streaming pipe).
  const outPath = options.out ? resolve(options.out) : undefined;
  if (!outPath && !json) {
    throw new CliError("bad_request", "Missing --out path. Required unless --json is set.");
  }
  if (options.jsonSidecar && !outPath) {
    throw new CliError("bad_request", "--json-sidecar requires --out.");
  }
  const { text, sourceType, flavor } = await ingestInput(input, options);

  let result: ConversionResult;
  try {
    result = convertTextToToon({
      text,
      sourceType,
      flavor,
      mode,
      delimiter,
      targetChars,
      targetTokens,
      allowLossy: Boolean(options.allowLossy),
      charsPerTokenRatios,
      estimateTokenCount: estimateNodeTokenCount,
    });
  } catch (error) {
    if (error instanceof BudgetRefusedError && json) {
      // In-band refusal (decision 6): the canonical wrapper maps the refusal to a verdict.
      // The refused path re-runs one cheap lossless trial; no output files are written.
      const refused = runVerdict(text, {
        sourceType,
        flavor,
        mode,
        delimiter,
        targetChars,
        targetTokens,
        allowLossy: Boolean(options.allowLossy),
        charsPerTokenRatios,
        estimateTokenCount: estimateNodeTokenCount,
        estimator: NODE_TOKEN_ESTIMATOR_ID,
      });
      console.log(JSON.stringify(refused, null, 2));
      applyFailOn(refused, failOn);
      return;
    }
    throw error; // pretty mode keeps the existing refusal error and exit 1
  }

  const verdict = buildVerdict(result, { estimator: NODE_TOKEN_ESTIMATOR_ID });

  if (!result.valid) {
    // A candidate that fails its own round-trip means the tool malfunctioned, not the input:
    // internal error on both renderings (decision 8), never a confident exit-0 verdict.
    if (outPath) {
      await writeDebugFiles(outPath, result.canonicalJson, result.toon);
      throw new CliError("internal", `Round-trip validation failed. Debug files written beside ${outPath}.`);
    }
    throw new CliError("internal", "Round-trip validation failed; no files were written.");
  }

  if (outPath) {
    await writeOutput(outPath, `${result.toon.trimEnd()}\n`);
    if (options.jsonSidecar) {
      await writeOutput(jsonSidecarPath(outPath), prettyJson(result.canonicalJson));
    }
  }

  if (json) {
    console.log(JSON.stringify(verdict, null, 2));
    if (outPath) {
      console.error(`TOON written: ${outPath}`); // stderr keeps stdout pure JSON
    }
  } else {
    printConversionReport(result, verdict, {
      targetChars,
      targetTokens,
      includeJsonStats: Boolean(options.stats),
    });
    console.log(`TOON written: ${outPath}`);
  }
  applyFailOn(verdict, failOn);
}

async function planCommand(input: string | undefined, options: PlanOptions): Promise<void> {
  const failOn = parseFailOn(options.failOn);
  const charsPerTokenRatios = parseCharsPerTokenRatios(options.charsPerToken);
  // Flag validation before input is read, for the same streaming-stdin reason convert validates early.
  const outPath = options.out ? resolve(options.out) : undefined;
  const { text, sourceType, flavor } = await ingestInput(input, options);

  const { verdict, plan, hybrid } = buildContextPlan(text, {
    sourceType,
    flavor,
    charsPerTokenRatios,
    estimateTokenCount: estimateNodeTokenCount,
    estimator: NODE_TOKEN_ESTIMATOR_ID,
  });

  // The hybrid is written even when the plan recommends against it (recommend_hybrid false):
  // the plan informs, the user decides. With zero converted sections it equals the source.
  if (outPath) {
    await writeOutput(outPath, hybrid);
  }

  if (options.json) {
    console.log(JSON.stringify(verdict, null, 2));
    if (outPath) {
      console.error(`Hybrid written: ${outPath}`); // stderr keeps stdout pure JSON
    }
  } else {
    printPlanReport(verdict, plan);
    if (outPath) {
      console.log(`Hybrid written: ${outPath}`);
    }
  }
  applyFailOn(verdict, failOn);
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
    throw new CliError("bad_request", "Missing input file. Pass a .md/.txt file or use --stdin.");
  }

  const inputPath = resolve(input);
  if (!existsSync(inputPath)) {
    throw new CliError("input_not_found", `Input file not found: ${input}`);
  }

  const text = await readFile(inputPath, "utf8");
  const flavor = parseFlavorOverride(options.type) ?? inferFlavor(inputPath);
  const sourceType: SourceType = flavor === "markdown" ? "markdown" : "text";
  return { text, sourceType, flavor };
}

async function readInputFile(input: string): Promise<string> {
  const inputPath = resolve(input);
  if (!existsSync(inputPath)) {
    throw new CliError("input_not_found", `Input file not found: ${input}`);
  }
  return readFile(inputPath, "utf8");
}

function parseMode(value: string): OutputMode {
  if (value === "lossless" || value === "record" || value === "budget") {
    return value;
  }
  if (value === "lossless-doc") {
    warnDeprecated('mode alias "lossless-doc"', '"lossless"');
    return "lossless";
  }
  if (value === "llm-context") {
    warnDeprecated('mode alias "llm-context"', '"budget"');
    return "budget";
  }
  throw new CliError("bad_request", `Unsupported mode: ${value}. Expected lossless, record, or budget.`);
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
  throw new CliError("bad_request", `Unsupported input type: ${value}. Expected markdown, md, text, or txt.`);
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
  throw new CliError("bad_request", `Unsupported delimiter: ${value}. Expected auto, comma, tab, or pipe.`);
}

function parsePositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError("bad_request", `${label} must be a positive integer.`);
  }
  return parsed;
}

function parseCharsPerTokenRatios(value: string | undefined): number[] {
  const parsed = (value ?? "3.5,4,4.5")
    .split(",")
    .map((part) => Number.parseFloat(part.trim()))
    .filter((part) => Number.isFinite(part) && part > 0);

  if (parsed.length === 0) {
    throw new CliError("bad_request", "--chars-per-token must include at least one positive number.");
  }

  return parsed;
}

interface FailOnSpec {
  verdicts: Set<string>;
  severities: Set<string>;
}

function parseFailOn(value: string | undefined): FailOnSpec | undefined {
  if (!value) {
    return undefined;
  }
  const verdicts = new Set<string>();
  const severities = new Set<string>();
  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (FAIL_ON_VERDICTS.has(entry)) {
      verdicts.add(entry);
    } else if (FAIL_ON_SEVERITIES.has(entry)) {
      severities.add(entry);
    } else {
      throw new CliError(
        "bad_request",
        `Unsupported --fail-on value: ${entry}. Expected verdicts (convert, keep_markdown, split_first, review, refused) or severities (info, warning).`,
      );
    }
  }
  return { verdicts, severities };
}

function applyFailOn(verdict: VerdictV1, failOn: FailOnSpec | undefined): void {
  if (!failOn) {
    return;
  }
  // Severity entries are thresholds: "info" fails on any warning, "warning" only on
  // warning-severity warnings. The verdict (or verdict JSON) is still printed first —
  // the check ran; --fail-on only decides the exit code.
  const verdictHit = failOn.verdicts.has(verdict.verdict);
  const severityHit =
    (failOn.severities.has("info") && verdict.warnings.length > 0) ||
    (failOn.severities.has("warning") && verdict.warnings.some((warning) => warning.severity === "warning"));
  if (verdictHit || severityHit) {
    process.exitCode = 1;
  }
}

function inferFlavor(inputPath: string): ParseFlavor {
  const extension = extname(inputPath).toLowerCase();
  if (extension === ".md" || extension === ".markdown") {
    return "markdown";
  }
  if (extension === ".txt" || extension === ".text") {
    return "text";
  }
  throw new CliError("bad_request", `Unsupported input extension: ${extension || "(none)"}. Use --type to override.`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
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

function printVerdictReport(verdict: VerdictV1): void {
  console.log(`Verdict: ${verdict.verdict}`);
  console.log(`  safe to auto-apply: ${verdict.safe_to_auto_apply}`);
  console.log("Profile:");
  console.log(`  detected: ${verdict.profile.name}`);
  console.log(`  source type: ${verdict.profile.source_type}`);
  console.log(`  source chars: ${verdict.measured_chars.source}`);
  console.log(`  headings: ${verdict.profile.stats.headings}`);
  console.log(`  paragraphs: ${verdict.profile.stats.paragraphs}`);
  console.log(`  list items: ${verdict.profile.stats.list_items}`);
  console.log(`  tables: ${verdict.profile.stats.tables} (${verdict.profile.stats.table_rows} rows)`);
  console.log(`  definitions: ${verdict.profile.stats.definitions}`);
  console.log(`  rules: ${verdict.profile.stats.rules}`);
  console.log("Measured (lossless trial conversion):");
  console.log(`  TOON chars: ${verdict.measured_chars.toon}`);
  console.log(
    `  character savings: ${verdict.measured_chars.savings} (${verdict.measured_chars.savings_pct.toFixed(1)}%)`,
  );
  console.log(
    `  token estimate (${verdict.token_estimates.estimator}): ~${verdict.token_estimates.source} -> ~${verdict.token_estimates.toon} (${verdict.token_estimates.savings_pct.toFixed(1)}%)`,
  );
  console.log(`  ratio estimates: ${verdict.token_estimates.ratio_estimates.map(formatVerdictRatioEstimate).join("; ")}`);
  printCodedWarnings(verdict.warnings, "  ");
}

function printPlanReport(verdict: VerdictV1, plan: ContextPlan): void {
  console.log(`Verdict: ${verdict.verdict}`);
  console.log(`  safe to auto-apply: ${verdict.safe_to_auto_apply}`);
  printCodedWarnings(verdict.warnings, "  ");

  const converted = plan.sections.filter((section) => section.action === "convert").length;
  console.log("Context plan (each section measured standalone under the unchanged policy):");
  console.log(`  sections: ${plan.sections.length} (${converted} convert, ${plan.sections.length - converted} keep)`);
  for (const section of plan.sections) {
    console.log(`  - ${formatPlanSection(section)}`);
  }
  console.log(
    `  net (hybrid vs source, splice overhead included): ${plan.net.source} -> ${plan.net.hybrid} chars (${plan.net.savings_pct.toFixed(1)}%)`,
  );
  console.log(`  recommend hybrid: ${plan.recommend_hybrid}`);
  console.log(`  reassembly verified: ${plan.reassembly_verified}`);
  console.log(`  plan safe to auto-apply: ${plan.safe_to_auto_apply}`);
}

function formatPlanSection(section: ContextPlanSection): string {
  const label =
    section.kind === "frontmatter"
      ? "frontmatter"
      : section.kind === "preamble"
        ? "(preamble)"
        : `"${section.heading}"`;
  const lines = `lines ${section.range.line_start}-${section.range.line_end}`;
  if (!section.measured_chars) {
    return `[${section.action}] ${label} (${lines}): never measured`;
  }
  const measured = `${section.measured_chars.source} -> ${section.measured_chars.toon} chars (${section.measured_chars.savings_pct.toFixed(1)}%)`;
  const warningSuffix =
    section.warnings.length > 0
      ? ` — ${section.warnings.length} warning${section.warnings.length === 1 ? "" : "s"}`
      : "";
  return `[${section.action}] ${label} (${lines}): ${measured}${warningSuffix}`;
}

function printConversionReport(
  result: ConversionResult,
  verdict: VerdictV1,
  options: {
    targetChars?: number;
    targetTokens?: number;
    includeJsonStats: boolean;
  },
): void {
  console.log(`Verdict: ${verdict.verdict}`);
  console.log(`  safe to auto-apply: ${verdict.safe_to_auto_apply}`);
  console.log("Metrics:");
  console.log(`  detected profile: ${result.profile.name}`);
  console.log(`  mode: ${result.mode}`);
  console.log(`  lossless: ${result.lossless ? "true" : "false"}`);
  console.log(`  delimiter: ${formatDelimiter(result.delimiter)}`);
  console.log(`  source chars: ${result.stats.sourceChars}`);
  console.log(`  TOON chars: ${result.stats.toonChars}`);
  console.log(`  character savings: ${result.stats.charSavings} (${result.stats.charSavingsPercent.toFixed(1)}%)`);
  console.log(`  source tokens: ~${result.stats.sourceTokens}`);
  console.log(`  TOON tokens: ~${result.stats.toonTokens}`);
  console.log(`  token savings: ~${result.stats.tokenSavings} (${result.stats.tokenSavingsPercent.toFixed(1)}%)`);
  console.log(
    `  chars/token estimates: ${verdict.token_estimates.ratio_estimates.map(formatVerdictRatioEstimate).join("; ")}`,
  );

  if (options.targetChars !== undefined) {
    console.log(`  target chars: ${options.targetChars}`);
  }
  if (options.targetTokens !== undefined) {
    console.log(`  target tokens: ${options.targetTokens}`);
  }
  if (verdict.flags.target_reached !== null) {
    console.log(`  target reached: ${verdict.flags.target_reached ? "true" : "false"}`);
  }

  if (options.includeJsonStats) {
    console.log(`  canonical JSON chars: ${result.stats.jsonChars}`);
    console.log(`  canonical JSON tokens: ~${result.stats.jsonTokens}`);
    console.log(
      `  JSON -> TOON token savings: ~${result.stats.jsonToonTokenSavings} (${result.stats.jsonToonTokenSavingsPercent.toFixed(1)}%)`,
    );
  }

  printCodedWarnings(verdict.warnings, "  ");
}

function printCodedWarnings(warnings: CodedWarning[], indent: string): void {
  if (warnings.length === 0) {
    return;
  }

  console.log(`${indent}warnings: ${warnings.length}`);
  for (const warning of warnings) {
    const lineStart = warning.range?.line_start;
    const lineEnd = warning.range?.line_end;
    const location =
      lineStart !== undefined
        ? ` (lines ${lineStart}${lineEnd !== undefined && lineEnd !== lineStart ? `-${lineEnd}` : ""})`
        : "";
    console.log(`${indent}- [${warning.code}] ${warning.message}${location}`);
    if (warning.suggestion) {
      console.log(`${indent}  suggestion: ${warning.suggestion}`);
    }
    if (warning.evidence) {
      console.log(`${indent}  evidence: ${warning.evidence}`);
    }
  }
}

function formatVerdictRatioEstimate(estimate: VerdictV1["token_estimates"]["ratio_estimates"][number]): string {
  return `${estimate.chars_per_token}cpt ${estimate.source}->${estimate.toon} (${estimate.savings_pct.toFixed(1)}%)`;
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

function warnDeprecated(what: string, useInstead: string): void {
  console.error(`Warning: ${what} is deprecated and will be removed in 1.0; use ${useInstead}.`);
}

function fail(error: unknown, json = false): void {
  const message = error instanceof Error ? error.message : inspect(error);

  if (json) {
    const code = error instanceof CliError ? error.code : "internal";
    console.log(JSON.stringify({ error: { code, message } }, null, 2));
  } else {
    console.error(`Error: ${message}`);
    if (process.env.DEBUG && error instanceof Error) {
      console.error(error.stack);
    }
  }
  // exitCode instead of process.exit: an immediate exit can truncate piped stdout on POSIX.
  process.exitCode = 1;
}
