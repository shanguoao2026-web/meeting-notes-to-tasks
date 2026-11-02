import type { LanguageGuess } from './types.js';

/**
 * Guess the transcript language from the balance of Han characters and Latin letters.
 * A short foreign name does not flip a mostly monolingual note to `mixed`.
 */
export function guessLanguage(text: string): LanguageGuess {
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (cjk === 0 && latin === 0) return 'unknown';
  if (cjk === 0) return 'en';
  if (latin === 0) return 'zh';
  const ratio = cjk / (cjk + latin);
  if (cjk >= 12 && latin >= 12 && ratio > 0.15 && ratio < 0.85) return 'mixed';
  if (ratio >= 0.5) return 'zh';
  return 'en';
}
