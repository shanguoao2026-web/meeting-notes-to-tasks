import { parseIsoDate } from './dates.js';
import { cleanupText } from './extract.js';
import { clampConfidence } from './score.js';
import type { LlmClient, ParseResult, Task } from './types.js';

/** Default SpaceXAI / xAI OpenAI-compatible base URL. */
export const DEFAULT_LLM_BASE_URL = 'https://api.x.ai/v1';

/** Default model id from the xAI models docs (Grok 4.7). */
export const DEFAULT_LLM_MODEL = 'grok-4.7';

export const LLM_SYSTEM_PROMPT = [
  'You extract action items from meeting transcripts in Chinese, English, or a mix.',
  'The user message includes a reference date, rule-based tasks, and a numbered transcript.',
  'Return JSON only, no markdown, with this shape:',
  '{"tasks":[{"text":string,"owner":string|null,"due":string|null,"confidence":number,"source_line":number}]}',
  'Rules:',
  '- text is the action, without the owner prefix or the due phrase.',
  '- owner is a person named in the transcript. Use null when nobody is named. Do not invent people.',
  '- due is YYYY-MM-DD or null. Resolve relative dates from the reference date.',
  '- source_line is the transcript line where the action is stated.',
  '- confidence is a number between 0 and 1.',
  '- Keep every rule-based task. You may fill a null owner or due and add tasks the rules missed.',
].join('\n');

export interface ChatClientOptions {
  apiKey: string;
  /** OpenAI-compatible base URL. Defaults to https://api.x.ai/v1. */
  baseUrl?: string;
  /** Model id. Defaults to grok-4.7. */
  model?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;

interface LlmTask {
  text: string;
  owner: string | null;
  due: string | null;
  confidence: number;
  line: number;
}

/**
 * OpenAI-compatible chat client.
 * The default endpoint is SpaceXAI, served by the xAI API at https://api.x.ai/v1.
 */
export function createChatClient(options: ChatClientOptions): LlmClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new Error('An API key is required. Set XAI_API_KEY or OPENAI_API_KEY.');
  }
  const baseUrl = (options.baseUrl ?? DEFAULT_LLM_BASE_URL).replace(/\/$/, '');
  const model = options.model ?? DEFAULT_LLM_MODEL;
  const doFetch: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 60_000;

  return {
    async complete(system: string, user: string): Promise<string> {
      let response: FetchResponse;
      try {
        response = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 2048,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new Error(redact(`LLM request failed: ${errorMessage(error)}`, apiKey));
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(redact(`LLM request failed (${response.status}): ${body.slice(0, 300)}`, apiKey));
      }
      const payload = await response.json();
      const content = messageText(payload);
      if (!content) throw new Error('LLM response did not include message content.');
      return content;
    },
  };
}

export function buildLlmUserPrompt(transcript: string, rules: ParseResult, referenceDate: string): string {
  const numbered = transcript
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line, index) => `${index + 1}| ${line}`)
    .join('\n');
  return [
    `Reference date: ${referenceDate}`,
    'Rule-based tasks:',
    JSON.stringify(rules),
    'Transcript:',
    numbered,
  ].join('\n\n');
}

/**
 * Ask the client for tasks and merge them into the rule result.
 * Rule text, owners, and due dates are kept when the rules already have them.
 * LLM-only tasks are appended. Network and JSON failures throw.
 */
export async function enhanceWithLlm(
  transcript: string,
  rules: ParseResult,
  client: LlmClient,
  referenceDate: string,
): Promise<ParseResult> {
  const raw = await client.complete(LLM_SYSTEM_PROMPT, buildLlmUserPrompt(transcript, rules, referenceDate));
  const incoming = parseLlmTasks(raw);
  const tasks = mergeTasks(rules.tasks, incoming);
  return {
    tasks,
    meta: {
      language_guess: rules.meta.language_guess,
      task_count: tasks.length,
    },
  };
}

export function parseLlmTasks(content: string): LlmTask[] {
  let raw = content.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fence?.[1]) raw = fence[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM response was not JSON.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error('LLM response was not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    throw new Error('LLM JSON did not contain a tasks array.');
  }
  const tasks: LlmTask[] = [];
  for (const item of (parsed as { tasks: unknown[] }).tasks) {
    const normalized = normalizeLlmTask(item);
    if (normalized) tasks.push(normalized);
  }
  return tasks;
}

/** Rule tasks stay. The model may fill blanks and add tasks that do not overlap. */
export function mergeTasks(ruleTasks: Task[], llmTasks: LlmTask[]): Task[] {
  const used = new Set<number>();
  const merged: Task[] = ruleTasks.map((rule) => {
    const index = bestLlmMatch(rule, llmTasks, used);
    if (index < 0) return rule;
    used.add(index);
    const extra = llmTasks[index];
    if (!extra) return rule;
    return {
      ...rule,
      owner: rule.owner ?? extra.owner,
      due: rule.due ?? extra.due,
      confidence: clampConfidence(Math.max(rule.confidence, extra.confidence)),
    };
  });
  for (let index = 0; index < llmTasks.length; index += 1) {
    if (used.has(index)) continue;
    const extra = llmTasks[index];
    if (!extra) continue;
    if (ruleTasks.some((rule) => overlap(rule.text, extra.text) >= 0.6)) continue;
    merged.push({
      id: '',
      text: extra.text,
      owner: extra.owner,
      due: extra.due,
      confidence: extra.confidence,
      source: { line: extra.line },
    });
  }
  return reindex(merged);
}

function bestLlmMatch(rule: Task, llmTasks: LlmTask[], used: Set<number>): number {
  let best = -1;
  let bestScore = 0;
  for (let index = 0; index < llmTasks.length; index += 1) {
    if (used.has(index)) continue;
    const extra = llmTasks[index];
    if (!extra) continue;
    const sameLine = rule.source.line > 0 && extra.line === rule.source.line;
    const score = sameLine ? 1 : overlap(rule.text, extra.text);
    if (score >= 0.6 && score > bestScore) {
      best = index;
      bestScore = score;
    }
  }
  return best;
}

function overlap(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1),
  );
}

function reindex(tasks: Task[]): Task[] {
  const ordered = tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const lineA = a.task.source.line > 0 ? a.task.source.line : Number.MAX_SAFE_INTEGER;
      const lineB = b.task.source.line > 0 ? b.task.source.line : Number.MAX_SAFE_INTEGER;
      return lineA - lineB || a.index - b.index;
    });
  return ordered.map(({ task }, index) => ({ ...task, id: `t${index + 1}` }));
}

function normalizeLlmTask(value: unknown): LlmTask | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.text !== 'string') return null;
  const text = cleanupText(record.text).slice(0, 500);
  if (text.length < 2) return null;
  const owner = typeof record.owner === 'string' && record.owner.trim() ? record.owner.trim().slice(0, 80) : null;
  const due = normalizeDue(record.due);
  const confidence = clampConfidence(typeof record.confidence === 'number' ? record.confidence : 0.55);
  const lineValue = record.source_line ?? record.line;
  const line = typeof lineValue === 'number' && Number.isInteger(lineValue) && lineValue > 0 ? lineValue : 0;
  return { text, owner, due, confidence, line };
}

function normalizeDue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  try {
    parseIsoDate(trimmed);
  } catch {
    return null;
  }
  return trimmed;
}

function messageText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== 'object') return null;
  const content = (first as { message?: { content?: unknown } }).message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        return (part as { text: string }).text;
      }
      return '';
    })
    .join('');
  return text.trim() ? text : null;
}

export function redact(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join('[redacted]');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
