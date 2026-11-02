const EN_MARKERS = new Set(['action item', 'action', 'todo', 'fixme', 'task']);
const ZH_MARKERS = new Set(['待办事项', '待办', '行动项', '行动事项', '行动', '任务']);

/** True when a speaker-looking label is really an action marker. */
export function isMarkerLabel(label: string): boolean {
  const trimmed = label.trim();
  if (ZH_MARKERS.has(trimmed)) return true;
  return EN_MARKERS.has(trimmed.toLowerCase());
}

/** Remove a leading ACTION / 待办 style marker. Longer labels are matched first. */
export function stripActionMarker(input: string): { explicit: boolean; text: string } {
  const text = input.trim();
  const match = /^(action\s+item|action|todo|fixme|task|待办事项|待办|行动项|行动事项|行动|任务)\s*[:：\-—]\s*/i.exec(
    text,
  );
  if (!match) return { explicit: false, text };
  return { explicit: true, text: text.slice(match[0].length).trim() };
}
