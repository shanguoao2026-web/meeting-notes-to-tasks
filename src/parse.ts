import { readFile } from 'node:fs/promises';
import { formatIso, resolveReferenceDate } from './dates.js';
import { extractTasks } from './extract.js';
import { guessLanguage } from './language.js';
import { enhanceWithLlm } from './llm.js';
import { parseTranscript } from './transcript.js';
import type { ParseOptions, ParseResult } from './types.js';

/** Read a transcript from disk and extract action items. */
export async function parseMeeting(filePath: string, options: ParseOptions = {}): Promise<ParseResult> {
  const content = await readFile(filePath, 'utf8');
  return parseMeetingText(content, filePath, options);
}

/** Extract action items from transcript text. `filename` selects .txt, .vtt, or .srt rules. */
export async function parseMeetingText(
  content: string,
  filename: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const segments = parseTranscript(content, filename);
  const reference = resolveReferenceDate(options.referenceDate);
  const tasks = extractTasks(segments, {
    defaultOwner: options.defaultOwner ?? null,
    referenceDate: reference,
  });
  const rules: ParseResult = {
    tasks,
    meta: {
      language_guess: guessLanguage(content),
      task_count: tasks.length,
    },
  };
  if (!options.llm) return rules;
  try {
    return await enhanceWithLlm(content, rules, options.llm, formatIso(reference));
  } catch (error) {
    if (options.llmStrict) throw error;
    const message = error instanceof Error ? error.message : String(error);
    options.onWarning?.(`LLM enhancement failed; using rule-based tasks. ${message}`);
    return rules;
  }
}
