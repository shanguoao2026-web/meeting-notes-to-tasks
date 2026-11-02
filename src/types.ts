/** Language label stored on `meta.language_guess`. */
export type LanguageGuess = 'zh' | 'en' | 'mixed' | 'unknown';

/** Where an action item was found in the source transcript. */
export interface TaskSource {
  /** 1-based line number in the original file. */
  line: number;
}

/**
 * One action item.
 * `owner` and `due` are null when the transcript does not say them.
 * `due` is a calendar date `YYYY-MM-DD` when it is known.
 */
export interface Task {
  id: string;
  text: string;
  owner: string | null;
  due: string | null;
  confidence: number;
  source: TaskSource;
}

export interface ParseMeta {
  language_guess: LanguageGuess;
  task_count: number;
}

export interface ParseResult {
  tasks: Task[];
  meta: ParseMeta;
}

/**
 * Chat client used by `--llm`. Tests pass a stub.
 * Implementations must not be required to touch the network.
 */
export interface LlmClient {
  complete(system: string, user: string): Promise<string>;
}

export interface ParseOptions {
  /** Used when the transcript names no owner. */
  defaultOwner?: string | null;
  /**
   * Calendar date that relative phrases resolve against.
   * `YYYY-MM-DD` or a Date. Defaults to today in the local timezone.
   */
  referenceDate?: Date | string;
  /** When set, rule-based tasks are enriched with this client. */
  llm?: LlmClient | null;
  /**
   * When true, an LLM failure fails the parse.
   * When false (default), the rule-based result is kept.
   */
  llmStrict?: boolean;
  /** Called with a human-readable warning. The CLI prints these on stderr. */
  onWarning?: (message: string) => void;
}
