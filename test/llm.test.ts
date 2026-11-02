import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMeetingText } from '../src/parse.js';
import {
  createChatClient,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  enhanceWithLlm,
  mergeTasks,
  parseLlmTasks,
  redact,
} from '../src/llm.js';
import type { FetchLike } from '../src/llm.js';
import type { LlmClient, ParseResult } from '../src/types.js';
import { installNetworkGuard, REFERENCE } from './helpers.js';

installNetworkGuard();

const rules: ParseResult = {
  tasks: [
    {
      id: 't1',
      text: 'Send the report',
      owner: null,
      due: null,
      confidence: 0.8,
      source: { line: 3 },
    },
  ],
  meta: { language_guess: 'en', task_count: 1 },
};

test('LLM merge fills blanks and appends a new task', () => {
  const merged = mergeTasks(rules.tasks, [
    {
      text: 'Send the report',
      owner: 'Ada',
      due: '2026-11-06',
      confidence: 0.7,
      line: 3,
    },
    {
      text: 'Book the venue',
      owner: 'Bo',
      due: null,
      confidence: 0.6,
      line: 9,
    },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.owner, 'Ada');
  assert.equal(merged[0]?.due, '2026-11-06');
  assert.equal(merged[0]?.text, 'Send the report');
  assert.equal(merged[1]?.id, 't2');
  assert.equal(merged[1]?.text, 'Book the venue');
  assert.equal(merged[1]?.source.line, 9);
});

test('rule owners and due dates win over the model', () => {
  const merged = mergeTasks(
    [
      {
        id: 't1',
        text: 'Send the report',
        owner: 'Ada',
        due: '2026-11-06',
        confidence: 0.9,
        source: { line: 2 },
      },
    ],
    [{ text: 'Send the report soon', owner: 'Someone Else', due: '2026-12-01', confidence: 0.4, line: 2 }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.owner, 'Ada');
  assert.equal(merged[0]?.due, '2026-11-06');
});

test('fenced JSON from a model is accepted and invalid dates are dropped', () => {
  const tasks = parseLlmTasks('```json\n{"tasks":[{"text":"File the invoice","owner":"Grace","due":"next Friday","confidence":0.66,"source_line":4}]}\n```');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.due, null);
  assert.equal(tasks[0]?.owner, 'Grace');
  assert.equal(tasks[0]?.line, 4);
});

test('a stub client enriches tasks without using the network', async () => {
  const stub: LlmClient = {
    async complete(system: string, user: string) {
      assert.match(system, /JSON/);
      assert.match(user, /Reference date: 2026-11-02/);
      assert.match(user, /3\| ACTION: send the recap/);
      return JSON.stringify({
        tasks: [
          { text: 'Send the recap', owner: 'Alice', due: '2026-11-03', confidence: 0.9, source_line: 3 },
          { text: 'Order lunch', owner: 'Ben', due: null, confidence: 0.5, source_line: 4 },
        ],
      });
    },
  };
  const transcript = 'Intro\n\nACTION: send the recap by tomorrow.\nBen should order lunch.\n';
  const result = await parseMeetingText(transcript, 'notes.txt', {
    referenceDate: REFERENCE,
    llm: stub,
  });
  assert.equal(result.tasks[0]?.owner, 'Alice');
  assert.equal(result.tasks[0]?.due, '2026-11-03');
  assert.ok(result.tasks.some((task) => task.text === 'Order lunch' && task.owner === 'Ben'));
});

test('invalid model JSON falls back to rules unless strict', async () => {
  const warnings: string[] = [];
  const stub: LlmClient = {
    async complete() {
      return 'not json';
    },
  };
  const content = 'ACTION: Bob to send the report by Friday.\n';
  const fallback = await parseMeetingText(content, 'notes.txt', {
    referenceDate: REFERENCE,
    llm: stub,
    onWarning: (message) => warnings.push(message),
  });
  assert.equal(fallback.tasks.length, 1);
  assert.equal(fallback.tasks[0]?.owner, 'Bob');
  assert.match(warnings[0] ?? '', /rule-based/);
  await assert.rejects(
    () =>
      parseMeetingText(content, 'notes.txt', {
        referenceDate: REFERENCE,
        llm: stub,
        llmStrict: true,
      }),
    /not JSON/,
  );
});

test('chat client posts to SpaceXAI and redacts the API key', async () => {
  const secret = 'super-secret-key';
  let seenUrl = '';
  let seenAuth = '';
  let seenModel = '';
  let seenFormat = '';
  const fetchImpl: FetchLike = async (url, init) => {
    seenUrl = url;
    seenAuth = init?.headers?.Authorization ?? '';
    const body = JSON.parse(init?.body ?? '{}') as { model?: string; response_format?: { type?: string } };
    seenModel = body.model ?? '';
    seenFormat = body.response_format?.type ?? '';
    return {
      ok: true,
      status: 200,
      async text() {
        return '';
      },
      async json() {
        return { choices: [{ message: { content: '{"tasks":[]}' } }] };
      },
    };
  };
  const client = createChatClient({ apiKey: secret, fetchImpl });
  assert.equal(DEFAULT_LLM_BASE_URL, 'https://api.x.ai/v1');
  assert.equal(DEFAULT_LLM_MODEL, 'grok-4.7');
  const text = await client.complete('system', 'user');
  assert.equal(text, '{"tasks":[]}');
  assert.equal(seenUrl, 'https://api.x.ai/v1/chat/completions');
  assert.equal(seenAuth, `Bearer ${secret}`);
  assert.equal(seenModel, 'grok-4.7');
  assert.equal(seenFormat, 'json_object');

  const failing: FetchLike = async () => ({
    ok: false,
    status: 401,
    async text() {
      return `unauthorized ${secret}`;
    },
    async json() {
      return {};
    },
  });
  const broken = createChatClient({ apiKey: secret, fetchImpl: failing });
  await assert.rejects(() => broken.complete('system', 'user'), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /401/);
    assert.equal(error.message.includes(secret), false);
    assert.match(error.message, /\[redacted\]/);
    return true;
  });
  assert.equal(redact(`token ${secret}`, secret), 'token [redacted]');
});

test('enhanceWithLlm keeps the language guess from the transcript', async () => {
  const stub: LlmClient = {
    async complete() {
      return '{"tasks":[]}';
    },
  };
  const rulesOnly = await parseMeetingText('请李四提交预算。\n', 'notes.txt', { referenceDate: REFERENCE });
  const enhanced = await enhanceWithLlm('请李四提交预算。\n', rulesOnly, stub, REFERENCE);
  assert.equal(enhanced.meta.language_guess, 'zh');
  assert.equal(enhanced.meta.task_count, enhanced.tasks.length);
});
