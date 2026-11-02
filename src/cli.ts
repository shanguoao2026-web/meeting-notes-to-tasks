#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseIsoDate } from './dates.js';
import { InputError } from './errors.js';
import { createChatClient, DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL } from './llm.js';
import { parseMeeting } from './parse.js';
import { renderHtml, renderJson, renderMarkdown } from './render.js';
import type { ParseResult } from './types.js';

type OutputKind = 'json' | 'md' | 'html';
type Format = 'json' | 'md' | 'both' | 'html' | 'all';

interface Io {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  env: NodeJS.ProcessEnv;
}

interface ParsedArgs {
  help: boolean;
  version: boolean;
  command?: string;
  input?: string;
  out?: string;
  format?: string;
  defaultOwner?: string;
  referenceDate?: string;
  llm: boolean;
  llmModel?: string;
  llmBaseUrl?: string;
  apiKey?: string;
}

const HELP = `meeting-notes-to-tasks — extract action items from meeting transcripts

Usage:
  meeting-notes-to-tasks parse --in <file> --out <file|dir> [options]

Options:
  --in, --input <file>             Transcript (.txt, .vtt, or .srt, UTF-8)
  --out, --output <file|dir>       Output file or directory
  --format <name>                  json, md, both, html, or all
                                   Default: both for a directory, else the file extension
  --default-owner <name>           Owner when the note does not name one
  --reference-date <YYYY-MM-DD>    Resolve "Friday" and "下周" against this date
  --llm                            Enhance with an OpenAI-compatible chat model
  --llm-model <id>                 Model id (default: ${DEFAULT_LLM_MODEL})
  --llm-base-url <url>             API base URL (default: ${DEFAULT_LLM_BASE_URL})
  --api-key <key>                  API key (prefer the XAI_API_KEY environment variable)
  -h, --help                       Show this help
  -v, --version                    Show the version

Examples:
  meeting-notes-to-tasks parse --in notes.vtt --out ./out --format both
  meeting-notes-to-tasks parse --in notes.txt --out ./out.json --default-owner Alice
`;

const defaultIo: Io = {
  stdout: (message) => {
    process.stdout.write(message.endsWith('\n') ? message : `${message}\n`);
  },
  stderr: (message) => {
    process.stderr.write(message.endsWith('\n') ? message : `${message}\n`);
  },
  env: process.env,
};

/** Run the CLI. Returns a process exit code and does not exit the process. */
export async function run(argv: string[], io: Io = defaultIo): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.help || (argv.length === 0 && !args.command)) {
      io.stdout(HELP);
      return 0;
    }
    if (args.version) {
      io.stdout(readPackageVersion());
      return 0;
    }
    if (args.command !== 'parse') {
      throw new InputError(`Unknown command "${args.command ?? ''}". Try: meeting-notes-to-tasks parse --help`);
    }
    if (!args.input) throw new InputError('Missing --in <file>.');
    if (!args.out) throw new InputError('Missing --out <file|dir>.');
    if (args.referenceDate) parseIsoDate(args.referenceDate);

    const format = resolveFormat(args.format);
    const outputs = planOutputs(args.out, format);
    const llm = args.llm ? createChatClient(resolveLlm(args, io.env)) : null;
    const result = await parseMeeting(args.input, {
      defaultOwner: args.defaultOwner ?? null,
      referenceDate: args.referenceDate,
      llm,
      onWarning: (message) => io.stderr(message),
    });
    await writeOutputs(result, outputs, path.basename(args.input));
    const files = outputs.map((item) => item.file).join(', ');
    io.stdout(
      `Wrote ${result.meta.task_count} ${result.meta.task_count === 1 ? 'task' : 'tasks'} (${result.meta.language_guess}) to ${files}`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(message);
    if (error instanceof InputError) return error.exitCode;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 2;
    return 1;
  }
}

function resolveLlm(args: ParsedArgs, env: NodeJS.ProcessEnv): { apiKey: string; baseUrl: string; model: string } {
  const apiKey = args.apiKey ?? env.XAI_API_KEY ?? env.OPENAI_API_KEY ?? '';
  if (!apiKey.trim()) {
    throw new InputError(
      '--llm requires an API key. Set XAI_API_KEY (SpaceXAI / xAI) or OPENAI_API_KEY, or pass --api-key.',
    );
  }
  return {
    apiKey: apiKey.trim(),
    baseUrl: args.llmBaseUrl ?? env.LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL,
    model: args.llmModel ?? env.LLM_MODEL ?? DEFAULT_LLM_MODEL,
  };
}

function resolveFormat(value: string | undefined): Format | undefined {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  const alias = normalized === 'markdown' ? 'md' : normalized;
  if (alias === 'json' || alias === 'md' || alias === 'both' || alias === 'html' || alias === 'all') return alias;
  throw new InputError(`Unknown --format "${value}". Expected json, md, both, html, or all.`);
}

function planOutputs(out: string, format: Format | undefined): { file: string; kind: OutputKind }[] {
  const ext = path.extname(out).toLowerCase();
  const single = ext === '.json' || ext === '.md' || ext === '.markdown' || ext === '.html' || ext === '.htm';
  if (single) {
    const kind: OutputKind = ext === '.json' ? 'json' : ext === '.html' || ext === '.htm' ? 'html' : 'md';
    if (format === 'both' || format === 'all') {
      throw new InputError(`--format ${format} needs a directory output path.`);
    }
    if (format && format !== kind) {
      throw new InputError(`--format ${format} conflicts with output extension ${ext}.`);
    }
    return [{ file: out, kind }];
  }
  const selected = format ?? 'both';
  const files: { file: string; kind: OutputKind }[] = [];
  if (selected === 'json' || selected === 'both' || selected === 'all') {
    files.push({ file: path.join(out, 'tasks.json'), kind: 'json' });
  }
  if (selected === 'md' || selected === 'both' || selected === 'all') {
    files.push({ file: path.join(out, 'tasks.md'), kind: 'md' });
  }
  if (selected === 'html' || selected === 'all') {
    files.push({ file: path.join(out, 'tasks.html'), kind: 'html' });
  }
  return files;
}

async function writeOutputs(
  result: ParseResult,
  outputs: { file: string; kind: OutputKind }[],
  sourceName: string,
): Promise<void> {
  for (const output of outputs) {
    await mkdir(path.dirname(output.file), { recursive: true });
    const body =
      output.kind === 'json'
        ? renderJson(result)
        : output.kind === 'md'
          ? renderMarkdown(result, { sourceName })
          : renderHtml(result, { sourceName });
    await writeFile(output.file, body, 'utf8');
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { help: false, version: false, llm: false };
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    const eq = token.indexOf('=');
    const hasEq = token.startsWith('--') && eq > 2;
    const key = hasEq ? token.slice(0, eq) : token;
    const inline = hasEq ? token.slice(eq + 1) : undefined;
    const take = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) throw new InputError(`Missing value for ${key}.`);
      index += 1;
      return next;
    };
    switch (key) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '-v':
      case '--version':
        args.version = true;
        break;
      case '--in':
      case '--input':
        args.input = take();
        break;
      case '--out':
      case '--output':
        args.out = take();
        break;
      case '--format':
        args.format = take();
        break;
      case '--default-owner':
        args.defaultOwner = take();
        break;
      case '--reference-date':
        args.referenceDate = take();
        break;
      case '--llm':
        args.llm = true;
        break;
      case '--llm-model':
        args.llmModel = take();
        break;
      case '--llm-base-url':
        args.llmBaseUrl = take();
        break;
      case '--api-key':
        args.apiKey = take();
        break;
      default:
        if (key.startsWith('-')) throw new InputError(`Unknown option ${key}.`);
        positional.push(key);
    }
  }
  if (positional.length > 1) throw new InputError(`Unexpected argument "${positional[1]}".`);
  args.command = positional[0];
  return args;
}

export function readPackageVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
        if (pkg.name === 'meeting-notes-to-tasks' && pkg.version) return pkg.version;
      } catch {
        // Keep walking if a nearby package.json is unreadable.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.1.0';
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
