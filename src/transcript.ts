import path from 'node:path';
import { InputError } from './errors.js';
import { isMarkerLabel } from './markers.js';

/** One spoken or written span, tied to a line in the source file. */
export interface Segment {
  /** 1-based line number of the first line of this span. */
  line: number;
  speaker: string | null;
  text: string;
}

export type TranscriptKind = 'txt' | 'vtt' | 'srt';

interface SourceLine {
  n: number;
  text: string;
}

const SPEAKER_PREFIX =
  /^(?:([A-Z][\p{L}\p{M}'.-]*)(?:\s+[A-Z][\p{L}\p{M}'.-]*){0,2}|([\u4e00-\u9fff]{2,4}))\s*[:：]\s*(.*)$/u;

/**
 * Split a transcript into speaker-aware segments.
 * The extension selects the parser: `.vtt`, `.srt`, or plain text.
 */
export function parseTranscript(content: string, filename: string): Segment[] {
  const kind = kindFromFilename(filename);
  const lines = toLines(content);
  if (kind === 'vtt') return parseCues(lines, 'vtt');
  if (kind === 'srt') return parseCues(lines, 'srt');
  return parsePlain(lines);
}

export function kindFromFilename(filename: string): TranscriptKind {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.vtt') return 'vtt';
  if (ext === '.srt') return 'srt';
  if (ext === '.txt' || ext === '.text' || ext === '') return 'txt';
  throw new InputError(`Unsupported input type "${ext}". Expected .txt, .vtt, or .srt.`);
}

function toLines(content: string): SourceLine[] {
  const text = content.replace(/^\uFEFF/, '');
  return text.split(/\r?\n/).map((line, index) => ({ n: index + 1, text: normalizeWidth(line) }));
}

function normalizeWidth(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/** Pull `Name:` / `张三：` off the front of a cue or note line. */
export function splitSpeakerPrefix(text: string): { speaker: string; rest: string } | null {
  const match = SPEAKER_PREFIX.exec(text.trim());
  if (!match) return null;
  const speaker = (match[1] ?? match[2] ?? '').trim();
  if (!speaker || isMarkerLabel(speaker)) return null;
  return { speaker, rest: (match[3] ?? '').trim() };
}

function parsePlain(lines: SourceLine[]): Segment[] {
  const segments: Segment[] = [];
  let speaker: string | null = null;
  for (const line of lines) {
    let text = stripPlainDecorations(line.text);
    if (!text) continue;
    const prefixed = splitSpeakerPrefix(text);
    if (prefixed) {
      speaker = prefixed.speaker;
      text = prefixed.rest;
    }
    if (!text) continue;
    segments.push({ line: line.n, speaker, text });
  }
  return segments;
}

function stripPlainDecorations(raw: string): string {
  let text = raw.trim();
  if (!text) return '';
  text = text.replace(/^[-*•]\s+/, '');
  text = text.replace(/^\[(?: |x|X)\]\s+/, '');
  text = text.replace(/^(?:\[)?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?(?:\])?\s+/, '');
  return text.trim();
}

function parseCues(lines: SourceLine[], kind: 'vtt' | 'srt'): Segment[] {
  let index = 0;
  if (kind === 'vtt') index = skipVttHeader(lines);
  const segments: Segment[] = [];
  while (index < lines.length) {
    if (lines[index]?.text.trim() === '') {
      index += 1;
      continue;
    }
    const blockStart = index;
    const block: SourceLine[] = [];
    while (index < lines.length && lines[index]?.text.trim() !== '') {
      const current = lines[index];
      if (!current) break;
      block.push(current);
      index += 1;
    }
    if (kind === 'vtt' && isSkippedVttBlock(block[0]?.text ?? '')) continue;
    const timingAt = block.findIndex((line) => line.text.includes('-->'));
    if (timingAt === -1) {
      // A plain-text blob inside a caption file is ignored rather than guessed.
      if (kind === 'vtt') continue;
      // SRT without a timing line: skip one line so we cannot loop forever.
      if (index === blockStart) index += 1;
      continue;
    }
    const textLines = block.slice(timingAt + 1);
    if (textLines.length === 0) continue;
    const joined = textLines.map((line) => line.text.trim()).filter(Boolean).join(' ');
    const cleaned = cleanCueText(joined);
    if (!cleaned.text) continue;
    segments.push({ line: textLines[0]?.n ?? block[timingAt]?.n ?? 1, speaker: cleaned.speaker, text: cleaned.text });
  }
  return segments;
}

function skipVttHeader(lines: SourceLine[]): number {
  const first = lines[0]?.text.trim() ?? '';
  if (!first.startsWith('WEBVTT')) return 0;
  let index = 1;
  while (index < lines.length) {
    const text = lines[index]?.text ?? '';
    if (text.trim() === '' || text.includes('-->')) break;
    index += 1;
  }
  while (index < lines.length && lines[index]?.text.trim() === '') index += 1;
  return index;
}

function isSkippedVttBlock(firstLine: string): boolean {
  return /^(NOTE|STYLE|REGION)\b/i.test(firstLine.trim());
}

function cleanCueText(raw: string): { speaker: string | null; text: string } {
  let text = raw;
  let speaker: string | null = null;
  const voice = /<v(?:\.[\w.-]+)?\s+([^>]+)>/i.exec(text);
  if (voice?.[1]) speaker = voice[1].trim();
  text = text.replace(/<\d{2}:\d{2}:\d{2}[.,]\d{3}>/g, '');
  text = text.replace(/<\/?[^>]+>/g, '');
  text = decodeBasicEntities(text).replace(/\s+/g, ' ').trim();
  const prefixed = splitSpeakerPrefix(text);
  if (prefixed) {
    speaker = speaker ?? prefixed.speaker;
    text = prefixed.rest;
  }
  return { speaker, text: text.trim() };
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}
