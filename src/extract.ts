import { extractDue, resolveReferenceDate } from './dates.js';
import { stripActionMarker } from './markers.js';
import { clampConfidence } from './score.js';
import type { Segment } from './transcript.js';
import type { Task } from './types.js';

export interface ExtractOptions {
  defaultOwner?: string | null;
  referenceDate?: Date | string;
}

interface Draft {
  text: string;
  owner: string | null;
  due: string | null;
  confidence: number;
  line: number;
  order: number;
}

interface Assignment {
  owner: string | null;
  /** The owner was written in the sentence, not taken from the speaker label. */
  ownerInText: boolean;
  useSpeaker: boolean;
  rest: string;
  weak: boolean;
}

const EN_VERBS = [
  'send', 'share', 'update', 'prepare', 'draft', 'review', 'finish', 'complete', 'submit',
  'fix', 'investigate', 'check', 'confirm', 'create', 'schedule', 'book', 'call', 'email',
  'ping', 'document', 'deploy', 'write', 'summarize', 'summarise', 'circulate', 'assign',
  'migrate', 'publish', 'post', 'deliver', 'provide', 'organize', 'organise', 'finalise',
  'finalize', 'revise', 'edit', 'approve', 'close', 'file', 'upload', 'download', 'sync',
  'present', 'outline', 'define', 'decide', 'notify', 'remind', 'collect', 'compile',
  'analyze', 'analyse', 'test', 'merge', 'ship', 'handle', 'track', 'clarify', 'resolve',
  'address', 'produce', 'record', 'recap', 'reserve', 'schedule', 'onboard', 'triage',
  'debug', 'refactor', 'implement', 'land', 'own', 'lead', 'drive', 'start', 'kick',
  'clean', 'add', 'remove', 'open', 'raise', 'issue', 'note', 'bring', 'take', 'make',
  'put', 'get', 'do', 'look',
];

const EN_VERB_RE = new RegExp(`\\b(?:${EN_VERBS.join('|')})\\b`, 'i');

const ZH_VERBS = [
  '整理', '提交', '完成', '跟进', '更新', '确认', '发送', '发给', '准备', '撰写', '编写',
  '检查', '修复', '联系', '同步', '汇总', '提供', '审核', '评审', '制定', '落实', '推进',
  '回复', '预订', '预约', '安排', '处理', '输出', '对接', '协调', '通知', '提醒', '收集',
  '统计', '分析', '测试', '上线', '发布', '修改', '补充', '完善', '拟定', '草拟', '记录',
  '发出', '汇报', '反馈', '核对', '排查', '解决', '关闭', '创建', '建立', '交付', '归档',
  '调研', '评估', '对齐', '发送', '约', '订', '写', '改',
];

const EN_STOP = new Set([
  'the', 'this', 'that', 'these', 'those', 'action', 'todo', 'please', 'monday', 'tuesday',
  'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tomorrow', 'next',
  'we', 'our', 'their', 'there', 'thanks', 'thank', 'hello', 'hi', 'ok', 'okay', 'yes',
  'no', 'so', 'and', 'but', 'need', 'want', 'have', 'let', 'going', 'note', 'sounds',
  'great', 'good', 'will', 'should', 'just', 'also', 'then', 'when', 'what', 'who',
  'why', 'how', 'can', 'could', 'would', 'let', 'lets', 'someone', 'somebody', 'everyone',
  'everybody', 'anyone', 'people', 'team', 'lets',
]);

const ZH_STOP = new Set([
  '大家', '各位', '我们', '你们', '他们', '她们', '所有', '今天', '明天', '后天', '今晚',
  '本周', '这周', '下周', '周末', '尽快', '相关', '团队', '自己', '这个', '那个', '这里',
  '那里', '现在', '然后', '因为', '所以', '如果', '但是', '以及', '还有', '一个', '本人',
  '对方', '客户', '公司', '项目', '会议', '问题', '时间', '之前', '以后', '完成', '负责',
  '安排', '需要', '进行', '开始', '继续', '已经', '可以', '应该', '必须', '希望', '谢谢',
  '好的', '收到', '明白', '就是', '整理', '提交', '更新', '确认', '发送', '跟进', '准备',
  '检查', '修复', '处理', '预订', '对接', '审核', '汇总', '提供', '通知', '提醒', '收集',
  '讨论', '看看', '一下', '什么', '怎么', '没有', '不是', '天气', '中午',
]);

const EN_NAME = String.raw`[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,2}`;
const AFTER_NAME =
  /^(?:负责|来|去|在|于|前|把|将|要|的|以|会|需|跟|，|,|\s|今天|今晚|明日|明天|后天|大后天|本周|这周|下周|下个|周[一二三四五六日天]|星期|月底|月初|\d|$)/;

/**
 * Pull action items out of transcript segments.
 * Explicit markers (`ACTION:`, `待办：`, …) win. Other lines need an owner cue and a verb.
 */
export function extractTasks(segments: Segment[], options: ExtractOptions = {}): Task[] {
  const reference = resolveReferenceDate(options.referenceDate);
  const drafts: Draft[] = [];
  let order = 0;
  for (const segment of segments) {
    const sentences = splitSentences(segment.text);
    for (const sentence of sentences) {
      const draft = taskFromSentence(sentence, segment, reference, options.defaultOwner ?? null, order);
      if (draft) {
        drafts.push(draft);
        order += 1;
      }
    }
  }
  return assignIds(dedupe(drafts));
}

export function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let buf = '';
  const flush = (): void => {
    const trimmed = buf.trim();
    if (trimmed) parts.push(trimmed);
    buf = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    buf += ch;
    if ('。！？?!；;'.includes(ch)) {
      flush();
      continue;
    }
    if (ch === '.') {
      const next = text[i + 1];
      if (next !== undefined && next !== ' ' && next !== '\n' && next !== '\t') continue;
      const word = /([A-Za-z]+)$/.exec(buf.slice(0, -1))?.[1] ?? '';
      if (word.length > 0 && word.length <= 3) continue;
      if (/\d$/.test(buf.slice(0, -1))) continue;
      flush();
    }
  }
  flush();
  return parts;
}

function taskFromSentence(
  sentence: string,
  segment: Segment,
  reference: Date,
  defaultOwner: string | null,
  order: number,
): Draft | null {
  const marked = stripActionMarker(sentence);
  const body = marked.text.trim();
  if (!body) return null;
  if (!marked.explicit && /[?？]\s*$/.test(body)) return null;

  const assignment = matchAssignment(body, marked.explicit);
  if (!assignment && !marked.explicit) return null;

  const due = extractDue(body, reference);
  let rest = assignment?.rest ?? body;
  if (due) rest = removeOnce(rest, body.slice(due.start, due.end));
  rest = cleanupText(rest);
  if (rest.length < 2) return null;

  const verb = hasActionVerb(rest) || hasActionVerb(body);
  if (!marked.explicit && !verb) return null;

  let owner = assignment?.owner ?? null;
  const ownerInText = assignment?.ownerInText ?? false;
  let usedSpeaker = false;
  if (!owner && assignment?.useSpeaker && segment.speaker) {
    owner = segment.speaker;
    usedSpeaker = true;
  }
  if (!owner && marked.explicit && segment.speaker) {
    owner = segment.speaker;
    usedSpeaker = true;
  }
  const usedDefault = !owner && !!defaultOwner;
  if (!owner && defaultOwner) owner = defaultOwner;

  const weak = assignment?.weak ?? false;
  const confidence = scoreConfidence({
    explicit: marked.explicit,
    weak: marked.explicit ? false : weak,
    ownerInText,
    hasOwner: !!owner,
    usedSpeaker,
    due: !!due,
  });

  return {
    text: rest,
    owner,
    due: due?.due ?? null,
    confidence,
    line: segment.line,
    order,
  };
}

function scoreConfidence(input: {
  explicit: boolean;
  weak: boolean;
  ownerInText: boolean;
  hasOwner: boolean;
  usedSpeaker: boolean;
  due: boolean;
}): number {
  let score = input.explicit ? 0.86 : input.weak ? 0.64 : 0.76;
  if (input.ownerInText) score += 0.05;
  else if (input.hasOwner) score += 0.02;
  if (input.due) score += 0.04;
  if (!input.hasOwner) score -= 0.08;
  return clampConfidence(score);
}

function matchAssignment(text: string, explicit: boolean): Assignment | null {
  const stripped = stripLeadingPlease(text);
  const chineseAssigned = matchChineseAssigned(text);
  if (chineseAssigned) return chineseAssigned;
  const committed = matchEnglishSelf(text) ?? matchChineseSelf(text) ?? matchEnglishAssigned(stripped.text);
  if (committed) return committed;
  // "Please send…", "请提交…", and "ACTION: send…" are imperatives. A bare verb is not.
  const polite = stripped.please || /^(?:请|麻烦)/.test(text);
  if (!(polite || explicit)) return null;
  const imperativeText = stripped.please ? stripped.text : text;
  return matchBareImperative(imperativeText, explicit);
}

function matchEnglishSelf(text: string): Assignment | null {
  const match = /^I(?:['’]ll|\s+will|\s+should|\s+need\s+to|\s+am\s+going\s+to|['’]m\s+going\s+to)\s+(.+)$/.exec(
    text,
  );
  if (!match?.[1]) return null;
  // "I will" / "I'll" are commitments. "I should" and "I need to" are softer.
  const weak = !/^I(?:\s+will|['’]ll)\b/.test(text);
  return {
    owner: null,
    ownerInText: false,
    useSpeaker: true,
    rest: match[1],
    weak,
  };
}

function matchChineseSelf(text: string): Assignment | null {
  const match = /^我(来|去|将|会|要|需要|负责)\s*(.+)$/.exec(text);
  if (!match?.[2]) return null;
  const particle = match[1] ?? '';
  return {
    owner: null,
    ownerInText: false,
    useSpeaker: true,
    rest: match[2],
    weak: particle === '需要',
  };
}

function matchChineseAssigned(text: string): Assignment | null {
  const prefixed = matchZhPrefix(text, /^(?:请|麻烦)\s*/, false)
    ?? matchZhPrefix(text, /^交给\s*/, false)
    ?? matchZhPrefix(text, /^安排\s*/, false)
    ?? matchZhPrefix(text, /^由\s*/, true);
  if (prefixed) return prefixed;

  const named = takeZhName(text);
  if (!named) return null;
  const responsible = /^(?:来)?负责\s*(.*)$/.exec(named.rest);
  if (responsible) {
    return {
      owner: named.name,
      ownerInText: true,
      useSpeaker: false,
      rest: responsible[1] ?? '',
      weak: false,
    };
  }
  const comeDo = /^来(跟进|做|处理|完成|负责|确认|更新|提交|整理)\s*(.*)$/.exec(named.rest);
  if (comeDo) {
    return {
      owner: named.name,
      ownerInText: true,
      useSpeaker: false,
      rest: `${comeDo[1] ?? ''}${comeDo[2] ?? ''}`,
      weak: false,
    };
  }
  return null;
}

function matchZhPrefix(text: string, prefix: RegExp, requireResponsible: boolean): Assignment | null {
  const match = prefix.exec(text);
  if (!match) return null;
  let after = text.slice(match[0].length);
  const named = takeZhName(after);
  if (!named) return null;
  after = named.rest.replace(/^(?:来|去)\s*/, '');
  if (requireResponsible) {
    const responsible = /^(?:来)?负责\s*(.*)$/.exec(named.rest);
    if (!responsible) return null;
    after = responsible[1] ?? '';
  }
  return {
    owner: named.name,
    ownerInText: true,
    useSpeaker: false,
    rest: after,
    weak: false,
  };
}

function matchEnglishAssigned(text: string): Assignment | null {
  const nameThen = (pattern: RegExp, weak: boolean): Assignment | null => {
    const match = pattern.exec(text);
    if (!match?.[1] || match[2] === undefined) return null;
    if (isStopName(match[1])) return null;
    return {
      owner: cleanOwner(match[1]),
      ownerInText: true,
      useSpeaker: false,
      rest: match[2],
      weak,
    };
  };

  const ask = nameThen(
    new RegExp(String.raw`^(?:ask|have|get)\s+(${EN_NAME})\s+(?:to\s+)?(.+)$`),
    false,
  );
  if (ask) return ask;

  const toDo = nameThen(new RegExp(String.raw`^(${EN_NAME})\s+to\s+(.+)$`), false);
  if (toDo) return toDo;

  const will = nameThen(new RegExp(String.raw`^(${EN_NAME})\s+will\s+(.+)$`), false);
  if (will) return will;

  const should = nameThen(new RegExp(String.raw`^(${EN_NAME})\s+should\s+(.+)$`), true);
  if (should) return should;

  const needs = nameThen(new RegExp(String.raw`^(${EN_NAME})\s+needs?\s+to\s+(.+)$`), true);
  if (needs) return needs;

  const going = nameThen(new RegExp(String.raw`^(${EN_NAME})\s+is\s+going\s+to\s+(.+)$`), false);
  if (going) return going;

  const responsible = nameThen(
    new RegExp(String.raw`^(${EN_NAME})\s+is\s+responsible\s+for\s+(.+)$`, 'i'),
    false,
  );
  if (responsible && !isStopName(responsible.owner ?? '')) return responsible;

  const assigned = new RegExp(
    String.raw`^(?:assigned\s+to|owner|assignee)\s*[:：]?\s*(${EN_NAME}|[\u4e00-\u9fff]{2,4})\b[,:]?\s*(.*)$`,
    'i',
  ).exec(text);
  if (assigned?.[1] && !isStopName(assigned[1])) {
    return {
      owner: cleanOwner(assigned[1]),
      ownerInText: true,
      useSpeaker: false,
      rest: assigned[2] ?? '',
      weak: false,
    };
  }

  const mention = new RegExp(String.raw`^@(${EN_NAME})\s+(.+)$`).exec(text);
  if (mention?.[1] && mention[2] && !isStopName(mention[1])) {
    return {
      owner: cleanOwner(mention[1]),
      ownerInText: true,
      useSpeaker: false,
      rest: mention[2],
      weak: false,
    };
  }

  const pleaseName = new RegExp(String.raw`^(${EN_NAME})\s*[,，]\s*(?:please\s+)?(.+)$`, 'i').exec(text);
  if (pleaseName?.[1] && pleaseName[2] && !isStopName(pleaseName[1]) && /\bplease\b/i.test(text)) {
    return {
      owner: cleanOwner(pleaseName[1]),
      ownerInText: true,
      useSpeaker: false,
      rest: pleaseName[2],
      weak: false,
    };
  }

  const third = new RegExp(String.raw`^(${EN_NAME})\s+([A-Za-z]{3,})s\s+(.+)$`).exec(text);
  if (third?.[1] && third[2] && third[3] && !isStopName(third[1])) {
    const verb = third[2].toLowerCase();
    const stem = verb.endsWith('s') ? verb.slice(0, -1) : verb;
    if (EN_VERBS.includes(stem)) {
      return {
        owner: cleanOwner(third[1]),
        ownerInText: true,
        useSpeaker: false,
        rest: `${stem} ${third[3]}`,
        weak: false,
      };
    }
  }

  return null;
}

function matchBareImperative(text: string, explicit: boolean): Assignment | null {
  const zhPlease = /^(?:请|麻烦)\s*(.+)$/.exec(text);
  const rest = (zhPlease?.[1] ?? text).trim();
  if (!rest) return null;
  // Explicit markers are tasks even when the wording is shorthand.
  if (!explicit && !leadingVerb(rest) && !hasActionVerb(rest)) return null;
  return {
    owner: null,
    ownerInText: false,
    useSpeaker: true,
    rest,
    weak: !explicit,
  };
}

function takeZhName(input: string): { name: string; rest: string } | null {
  for (const length of [2, 3, 4]) {
    if ([...input].length < length) break;
    const chars = [...input];
    const name = chars.slice(0, length).join('');
    if (!/^[\u4e00-\u9fff]+$/.test(name)) break;
    if (ZH_STOP.has(name) || ZH_VERBS.includes(name)) {
      if (length === 2) return null;
      continue;
    }
    const rest = chars.slice(length).join('').replace(/^\s+/, '');
    if (rest === '' || AFTER_NAME.test(rest) || startsWithZhVerb(rest)) {
      return { name, rest };
    }
  }
  return null;
}

function isStopName(name: string): boolean {
  const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!first || first.length < 2) return true;
  if (EN_STOP.has(first)) return true;
  if (ZH_STOP.has(name.trim())) return true;
  return false;
}

function cleanOwner(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function stripLeadingPlease(text: string): { please: boolean; text: string } {
  const match = /^(?:please|pls)\s+/i.exec(text);
  if (!match) return { please: false, text };
  return { please: true, text: text.slice(match[0].length) };
}

function startsWithZhVerb(text: string): boolean {
  return ZH_VERBS.some((verb) => text.startsWith(verb));
}

function leadingVerb(text: string): boolean {
  const lower = text.toLowerCase();
  if (EN_VERBS.some((verb) => lower === verb || lower.startsWith(`${verb} `))) return true;
  return startsWithZhVerb(text);
}

function hasActionVerb(text: string): boolean {
  if (/\b(?:follow|check|reach|sign|hand|set|write|pick)[\s-](?:up|in|out|off)\b/i.test(text)) return true;
  if (EN_VERB_RE.test(text)) return true;
  return ZH_VERBS.some((verb) => text.includes(verb));
}

function removeOnce(haystack: string, needle: string): string {
  const trimmed = needle.trim();
  if (!trimmed) return haystack;
  const at = haystack.indexOf(trimmed);
  if (at === -1) return haystack;
  return `${haystack.slice(0, at)} ${haystack.slice(at + trimmed.length)}`;
}

export function cleanupText(text: string): string {
  let value = text.replace(/\s+/g, ' ').trim();
  value = value.replace(/^(?:to|about|regarding|关于)\s+/i, '');
  value = value.replace(/^(?:一下|把)\s*/, '');
  let previous = '';
  while (previous !== value) {
    previous = value;
    value = value.replace(/^[\s，,;；:：\-—。．.！!？?、]+/, '').replace(/[\s，,;；:：\-—。．.！!？?、]+$/, '').trim();
  }
  value = value.replace(/\s+/g, ' ').trim();
  if (/^[a-z]/.test(value)) value = value[0]!.toUpperCase() + value.slice(1);
  return value;
}

function dedupe(drafts: Draft[]): Draft[] {
  const kept: Draft[] = [];
  for (const draft of drafts) {
    const key = normalizeKey(draft.text);
    const index = kept.findIndex(
      (item) => normalizeKey(item.text) === key && ownersCompatible(item.owner, draft.owner),
    );
    if (index === -1) {
      kept.push(draft);
      continue;
    }
    const current = kept[index];
    if (!current) continue;
    kept[index] = {
      text: current.text.length >= draft.text.length ? current.text : draft.text,
      owner: current.owner ?? draft.owner,
      due: current.due ?? draft.due,
      confidence: Math.max(current.confidence, draft.confidence),
      line: Math.min(current.line, draft.line),
      order: Math.min(current.order, draft.order),
    };
  }
  return kept;
}

function ownersCompatible(left: string | null, right: string | null): boolean {
  if (!left || !right) return true;
  return left === right;
}

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[\s，。！？、,.!?;:'"“”‘’\-—]/g, '');
}

function assignIds(drafts: Draft[]): Task[] {
  const ordered = [...drafts].sort((a, b) => a.line - b.line || a.order - b.order);
  return ordered.map((draft, index) => ({
    id: `t${index + 1}`,
    text: draft.text,
    owner: draft.owner,
    due: draft.due,
    confidence: draft.confidence,
    source: { line: draft.line },
  }));
}
