import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { run } from '../src/cli.js';
import { examplesDir, installNetworkGuard, REFERENCE } from './helpers.js';

installNetworkGuard();

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(here, '../src/cli.js');

function capture(): { io: { stdout: (m: string) => void; stderr: (m: string) => void; env: NodeJS.ProcessEnv }; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (message) => out.push(message),
      stderr: (message) => err.push(message),
      env: {},
    },
  };
}

test('help and version print without reading a transcript', async () => {
  const help = capture();
  assert.equal(await run(['--help'], help.io), 0);
  assert.match(help.out.join('\n'), /meeting-notes-to-tasks parse --in/);
  assert.match(help.out.join('\n'), /--format/);
  assert.match(help.out.join('\n'), /--default-owner/);
  const version = capture();
  assert.equal(await run(['--version'], version.io), 0);
  assert.equal(version.out.join('').trim(), '0.1.0');
});

test('parse writes JSON and Markdown into a directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mnt-'));
  try {
    const cap = capture();
    const code = await run(
      ['parse', '--in', path.join(examplesDir, 'en-standup.txt'), '--out', dir, '--reference-date', REFERENCE],
      cap.io,
    );
    assert.equal(code, 0);
    const json = JSON.parse(await readFile(path.join(dir, 'tasks.json'), 'utf8')) as {
      tasks: Array<{ owner: string; due: string }>;
      meta: { language_guess: string; task_count: number };
    };
    const markdown = await readFile(path.join(dir, 'tasks.md'), 'utf8');
    assert.equal(json.meta.language_guess, 'en');
    assert.equal(json.meta.task_count, 5);
    assert.equal(json.tasks[0]?.owner, 'Bob');
    assert.match(markdown, /Send the Q3 report/);
    assert.match(cap.out.join('\n'), /Wrote 5 tasks/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parse writes a single JSON file for a .json output path', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mnt-'));
  const out = path.join(dir, 'out.json');
  try {
    const cap = capture();
    const code = await run(
      [
        'parse',
        '--in',
        path.join(examplesDir, 'zh-weekly.txt'),
        '--out',
        out,
        '--reference-date',
        REFERENCE,
        '--default-owner',
        '未指定',
      ],
      cap.io,
    );
    assert.equal(code, 0);
    const json = JSON.parse(await readFile(out, 'utf8')) as {
      tasks: Array<{ owner: string; text: string }>;
      meta: { language_guess: string };
    };
    assert.equal(json.meta.language_guess, 'zh');
    assert.equal(json.tasks[0]?.owner, '李四');
    assert.equal(json.tasks[0]?.text, '整理会议纪要');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('HTML format, missing files, bad flags, and --llm without a key', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mnt-'));
  try {
    const html = capture();
    const code = await run(
      ['parse', '--in', path.join(examplesDir, 'retro.srt'), '--out', dir, '--format', 'html', '--reference-date', REFERENCE],
      html.io,
    );
    assert.equal(code, 0);
    const page = await readFile(path.join(dir, 'tasks.html'), 'utf8');
    assert.match(page, /Share the metrics/);
    assert.match(page, /Priya/);

    const missing = capture();
    assert.equal(await run(['parse', '--in', path.join(dir, 'nope.txt'), '--out', dir], missing.io), 2);

    const unknown = capture();
    assert.equal(await run(['parse', '--in', 'x', '--out', 'y', '--nope'], unknown.io), 1);
    assert.match(unknown.err.join('\n'), /Unknown option/);

    const conflict = capture();
    assert.equal(
      await run(['parse', '--in', path.join(examplesDir, 'retro.srt'), '--out', path.join(dir, 'a.json'), '--format', 'md'], conflict.io),
      1,
    );
    assert.match(conflict.err.join('\n'), /conflicts/);

    const llm = capture();
    const llmCode = await run(
      ['parse', '--in', path.join(examplesDir, 'retro.srt'), '--out', dir, '--llm', '--reference-date', REFERENCE],
      llm.io,
    );
    assert.equal(llmCode, 1);
    assert.match(llm.err.join('\n'), /XAI_API_KEY/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the executable parses a transcript', () => {
  const dir = spawnSync('mktemp', ['-d']);
  const outDir = String(dir.stdout).trim();
  assert.equal(dir.status, 0);
  try {
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        'parse',
        '--in',
        path.join(examplesDir, 'en-standup.txt'),
        '--out',
        path.join(outDir, 'tasks.json'),
        '--reference-date',
        REFERENCE,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wrote 5 tasks/);
    const json = JSON.parse(spawnSync('cat', [path.join(outDir, 'tasks.json')], { encoding: 'utf8' }).stdout) as {
      meta: { task_count: number };
    };
    assert.equal(json.meta.task_count, 5);
  } finally {
    spawnSync('rm', ['-rf', outDir]);
  }
});
