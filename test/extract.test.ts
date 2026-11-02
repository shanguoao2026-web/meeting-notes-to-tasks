import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { guessLanguage } from '../src/language.js';
import { parseMeetingText } from '../src/index.js';
import { renderHtml, renderJson, renderMarkdown } from '../src/render.js';
import type { ParseResult, Task } from '../src/types.js';
import { examplesDir, installNetworkGuard, lineOf, REFERENCE } from './helpers.js';

installNetworkGuard();

const options = { referenceDate: REFERENCE };

function project(result: ParseResult): Array<Pick<Task, 'id' | 'text' | 'owner' | 'due'> & { line: number }> {
  return result.tasks.map((task) => ({
    id: task.id,
    text: task.text,
    owner: task.owner,
    due: task.due,
    line: task.source.line,
  }));
}

test('English stand-up notes become owned tasks', async () => {
  const file = path.join(examplesDir, 'en-standup.txt');
  const content = await readFile(file, 'utf8');
  const result = await parseMeetingText(content, file, options);
  assert.equal(result.meta.language_guess, 'en');
  assert.equal(result.meta.task_count, 5);
  assert.deepEqual(project(result), [
    {
      id: 't1',
      text: 'Send the Q3 report',
      owner: 'Bob',
      due: '2026-11-06',
      line: lineOf(content, 'ACTION: Bob'),
    },
    {
      id: 't2',
      text: 'Update the roadmap',
      owner: 'Carol',
      due: '2026-11-09',
      line: lineOf(content, 'Carol will update'),
    },
    {
      id: 't3',
      text: 'Book the customer call',
      owner: 'Dana',
      due: '2026-11-05',
      line: lineOf(content, 'Please ask Dana'),
    },
    {
      id: 't4',
      text: 'Draft the release notes',
      owner: 'Bob',
      due: '2026-11-06',
      line: lineOf(content, "I'll draft"),
    },
    {
      id: 't5',
      text: 'Review the pull request',
      owner: 'Eve',
      due: null,
      line: lineOf(content, 'Eve should review'),
    },
  ]);
  const action = result.tasks[0];
  const self = result.tasks[3];
  const soft = result.tasks[4];
  assert.ok(action && action.confidence >= 0.9);
  assert.ok(self && self.confidence >= 0.8);
  assert.ok(soft && soft.confidence >= 0.6 && soft.confidence < 0.85);
  for (const task of result.tasks) {
    assert.ok(task.confidence >= 0.35 && task.confidence <= 0.95);
    assert.match(task.id, /^t\d+$/);
    assert.equal(Object.keys(task).join(','), 'id,text,owner,due,confidence,source');
    assert.deepEqual(Object.keys(task.source), ['line']);
  }
  assert.ok(result.tasks.every((task) => !/ACTION:|lunch|weather|design review/i.test(task.text)));
});

test('Chinese weekly notes become owned tasks', async () => {
  const file = path.join(examplesDir, 'zh-weekly.txt');
  const content = await readFile(file, 'utf8');
  const result = await parseMeetingText(content, file, options);
  assert.equal(result.meta.language_guess, 'zh');
  assert.equal(result.meta.task_count, 5);
  assert.deepEqual(project(result), [
    {
      id: 't1',
      text: '整理会议纪要',
      owner: '李四',
      due: '2026-11-08',
      line: lineOf(content, '请李四'),
    },
    {
      id: 't2',
      text: '提交预算表',
      owner: '王五',
      due: '2026-11-13',
      line: lineOf(content, '王五负责'),
    },
    {
      id: 't3',
      text: '跟进客户回访',
      owner: '赵六',
      due: '2026-11-05',
      line: lineOf(content, '我来跟进'),
    },
    {
      id: 't4',
      text: '更新官网文案',
      owner: '陈七',
      due: '2026-11-09',
      line: lineOf(content, '安排陈七'),
    },
    {
      id: 't5',
      text: '对接供应商',
      owner: '周敏',
      due: '2026-11-07',
      line: lineOf(content, '交给周敏'),
    },
  ]);
  assert.ok(result.tasks.every((task) => !/天气|吃饭|待办：/.test(task.text)));
});

test('WebVTT cues keep speakers, voice tags, and line numbers', async () => {
  const file = path.join(examplesDir, 'mixed-sync.vtt');
  const content = await readFile(file, 'utf8');
  const result = await parseMeetingText(content, file, options);
  assert.equal(result.meta.language_guess, 'mixed');
  assert.deepEqual(project(result), [
    {
      id: 't1',
      text: 'Send the deck to the client',
      owner: 'Alice',
      due: '2026-11-06',
      line: lineOf(content, 'ACTION: send the deck'),
    },
    {
      id: 't2',
      text: '确认合同条款',
      owner: '王芳',
      due: '2026-11-08',
      line: lineOf(content, '请王芳'),
    },
    {
      id: 't3',
      text: 'Email the notes',
      owner: 'Carol',
      due: '2026-11-03',
      line: lineOf(content, 'Carol will email'),
    },
    {
      id: 't4',
      text: '预订会议室',
      owner: '张三',
      due: '2026-11-03',
      line: lineOf(content, '我来预订'),
    },
  ]);
  assert.equal(result.meta.task_count, result.tasks.length);
});

test('SubRip cues parse comma timestamps and TODO markers', async () => {
  const file = path.join(examplesDir, 'retro.srt');
  const content = await readFile(file, 'utf8');
  const result = await parseMeetingText(content, file, options);
  assert.equal(result.meta.language_guess, 'en');
  assert.deepEqual(project(result), [
    {
      id: 't1',
      text: 'Share the metrics',
      owner: 'Priya',
      due: '2026-11-07',
      line: lineOf(content, 'I will share'),
    },
    {
      id: 't2',
      text: 'Migrate the staging database',
      owner: 'Sam',
      due: '2026-11-03',
      line: lineOf(content, 'TODO:'),
    },
  ]);
});

test('CRLF SubRip input parses the same way', async () => {
  const content = '1\r\n00:00:01,000 --> 00:00:02,000\r\nMina: I will send the file by Friday.\r\n';
  const result = await parseMeetingText(content, 'retro.srt', options);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0]?.owner, 'Mina');
  assert.equal(result.tasks[0]?.due, '2026-11-06');
  assert.equal(result.tasks[0]?.text, 'Send the file');
});

test('default owner fills explicit actions that name nobody', async () => {
  const content = 'ACTION: send the recap by tomorrow.\n';
  const withOwner = await parseMeetingText(content, 'notes.txt', { ...options, defaultOwner: 'Alice' });
  assert.equal(withOwner.tasks[0]?.owner, 'Alice');
  assert.equal(withOwner.tasks[0]?.due, '2026-11-03');
  assert.equal(withOwner.tasks[0]?.text, 'Send the recap');
  const without = await parseMeetingText(content, 'notes.txt', options);
  assert.equal(without.tasks[0]?.owner, null);
});

test('questions, chatter, and duplicate commitments are dropped or merged', async () => {
  const content = [
    'Alice: Should we update the homepage?',
    'Bob: The design review went well.',
    'ACTION: Bob to send the report by Friday.',
    'Bob will send the report by Friday.',
    '- [ ] Nina to publish the changelog by 2026-11-20.',
  ].join('\n');
  const result = await parseMeetingText(content, 'notes.txt', options);
  assert.deepEqual(project(result), [
    {
      id: 't1',
      text: 'Send the report',
      owner: 'Bob',
      due: '2026-11-06',
      line: 3,
    },
    {
      id: 't2',
      text: 'Publish the changelog',
      owner: 'Nina',
      due: '2026-11-20',
      line: 5,
    },
  ]);
});

test('WebVTT NOTE blocks are not action items', async () => {
  const content = [
    'WEBVTT',
    '',
    'NOTE',
    'Alice will send the hidden report by Friday.',
    '',
    '00:00:01.000 --> 00:00:02.000',
    'Grace: ACTION: file the invoice today.',
    '',
  ].join('\n');
  const result = await parseMeetingText(content, 'captions.vtt', options);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0]?.owner, 'Grace');
  assert.equal(result.tasks[0]?.text, 'File the invoice');
  assert.equal(result.tasks[0]?.due, '2026-11-02');
  assert.equal(result.tasks[0]?.source.line, 7);
});

test('empty and header-only transcripts produce no tasks', async () => {
  const empty = await parseMeetingText('', 'notes.txt', options);
  assert.deepEqual(empty.tasks, []);
  assert.equal(empty.meta.task_count, 0);
  assert.equal(empty.meta.language_guess, 'unknown');
  const header = await parseMeetingText('WEBVTT\n\n', 'empty.vtt', options);
  assert.equal(header.tasks.length, 0);
  assert.equal(header.meta.language_guess, 'en');
});

test('language guess distinguishes English, Chinese, mixed, and unknown', () => {
  assert.equal(guessLanguage('Hello team, let us meet tomorrow.'), 'en');
  assert.equal(guessLanguage('我们明天下午开会讨论预算和招聘计划。'), 'zh');
  assert.equal(guessLanguage('12345 ---'), 'unknown');
  const mixed = `${'Please review the roadmap and send notes. '.repeat(3)}${'请确认合同并更新文档。'.repeat(3)}`;
  assert.equal(guessLanguage(mixed), 'mixed');
  assert.equal(guessLanguage('Bob 说好'), 'en');
});

test('unsupported extensions are rejected', async () => {
  await assert.rejects(() => parseMeetingText('hello', 'notes.md', options), /Unsupported input type "\.md"/);
});

test('JSON keeps the documented shape', async () => {
  const result = await parseMeetingText('待办：请李四在下周之前整理会议纪要。\n', 'notes.txt', options);
  assert.deepEqual(Object.keys(result), ['tasks', 'meta']);
  assert.deepEqual(Object.keys(result.meta), ['language_guess', 'task_count']);
  const parsed = JSON.parse(renderJson(result)) as ParseResult;
  assert.equal(parsed.meta.language_guess, 'zh');
  assert.equal(parsed.meta.task_count, 1);
  assert.equal(parsed.tasks[0]?.owner, '李四');
  assert.equal(parsed.tasks[0]?.due, '2026-11-08');
  assert.equal(renderJson(result).endsWith('\n'), true);
});

test('Markdown and HTML render owners, dues, and escaped text', async () => {
  const result = await parseMeetingText('ACTION: Bob to compare a < b & c | d by Friday.\n', 'notes.txt', options);
  const markdown = renderMarkdown(result, { sourceName: 'notes.txt' });
  assert.match(markdown, /\| t1 \|/);
  assert.match(markdown, /Bob/);
  assert.match(markdown, /2026-11-06/);
  assert.match(markdown, /a \\| d/);
  assert.match(markdown, /Source: `notes\.txt`/);
  const html = renderHtml(result, { sourceName: 'notes.txt' });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /a &lt; b &amp; c \| d/);
  assert.doesNotMatch(html, /a < b/);
  const emptyHtml = renderHtml({ tasks: [], meta: { language_guess: 'en', task_count: 0 } });
  assert.match(emptyHtml, /No action items found/);
});
