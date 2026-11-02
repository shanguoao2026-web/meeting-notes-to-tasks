import type { LanguageGuess, ParseResult, Task } from './types.js';

export function renderJson(result: ParseResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function renderMarkdown(result: ParseResult, options: { sourceName?: string } = {}): string {
  const lines: string[] = ['# Action items', ''];
  if (options.sourceName) lines.push(`Source: \`${options.sourceName}\``, '');
  if (result.tasks.length === 0) {
    lines.push('No action items found.', '');
  } else {
    lines.push('| ID | Task | Owner | Due | Confidence | Line |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const task of result.tasks) {
      lines.push(
        `| ${escapeCell(task.id)} | ${escapeCell(task.text)} | ${escapeCell(showOwner(task))} | ${escapeCell(showDue(task))} | ${task.confidence} | ${task.source.line} |`,
      );
    }
    lines.push('');
  }
  lines.push(`${result.meta.task_count} ${result.meta.task_count === 1 ? 'task' : 'tasks'} · language \`${result.meta.language_guess}\`.`, '');
  return lines.join('\n');
}

export function renderHtml(result: ParseResult, options: { sourceName?: string; title?: string } = {}): string {
  const title = options.title ?? 'Action items';
  const lang = htmlLang(result.meta.language_guess);
  const source = options.sourceName
    ? `<p class="meta">Source: ${escapeHtml(options.sourceName)}</p>`
    : '';
  const body =
    result.tasks.length === 0
      ? '<p>No action items found.</p>'
      : `<table>
<thead><tr><th>ID</th><th>Task</th><th>Owner</th><th>Due</th><th>Confidence</th><th>Line</th></tr></thead>
<tbody>
${result.tasks
  .map(
    (task) =>
      `<tr><td>${escapeHtml(task.id)}</td><td>${escapeHtml(task.text)}</td><td>${escapeHtml(showOwner(task))}</td><td>${escapeHtml(showDue(task))}</td><td>${task.confidence}</td><td>${task.source.line}</td></tr>`,
  )
  .join('\n')}
</tbody>
</table>`;
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.45; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #ccc; text-align: left; padding: 0.5rem; vertical-align: top; }
  .meta { color: #555; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${source}
<p class="meta">${result.meta.task_count} ${result.meta.task_count === 1 ? 'task' : 'tasks'} · language ${escapeHtml(result.meta.language_guess)}</p>
${body}
</body>
</html>
`;
}

function showOwner(task: Task): string {
  return task.owner ?? '—';
}

function showDue(task: Task): string {
  return task.due ?? '—';
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlLang(language: LanguageGuess): string {
  if (language === 'zh') return 'zh';
  if (language === 'en') return 'en';
  return 'en';
}
