import assert from 'node:assert/strict';
import test from 'node:test';
import { extractDue } from '../src/dates.js';
import { installNetworkGuard, REFERENCE } from './helpers.js';

installNetworkGuard();

const cases: Array<[string, string | null]> = [
  ['by Friday', '2026-11-06'],
  ['this Friday', '2026-11-06'],
  ['next Friday', '2026-11-13'],
  ['by next Monday', '2026-11-09'],
  ['tomorrow', '2026-11-03'],
  ['day after tomorrow', '2026-11-04'],
  ['in 3 days', '2026-11-05'],
  ['within 1 day', '2026-11-03'],
  ['in two weeks', '2026-11-16'],
  ['end of week', '2026-11-06'],
  ['EOW', '2026-11-06'],
  ['next week', '2026-11-13'],
  ['this week', '2026-11-06'],
  ['end of next week', '2026-11-13'],
  ['November 7', '2026-11-07'],
  ['7 November 2026', '2026-11-07'],
  ['2026-11-07', '2026-11-07'],
  ['2026-10-01', '2026-10-01'],
  ['11/07/2026', '2026-11-07'],
  ['11月1日', '2027-11-01'],
  ['今天', '2026-11-02'],
  ['明天', '2026-11-03'],
  ['后天', '2026-11-04'],
  ['大后天', '2026-11-05'],
  ['三天内', '2026-11-05'],
  ['十二天后', '2026-11-14'],
  ['两周内', '2026-11-16'],
  ['下周五', '2026-11-13'],
  ['下周一', '2026-11-09'],
  ['本周五', '2026-11-06'],
  ['本周内', '2026-11-06'],
  ['下周', '2026-11-13'],
  ['下周之前', '2026-11-08'],
  ['下周前', '2026-11-08'],
  ['下周末', '2026-11-15'],
  ['11月7日', '2026-11-07'],
  ['11月7日前完成', '2026-11-07'],
  ['2026年11月7日', '2026-11-07'],
  ['月底', '2026-11-30'],
  ['下月底', '2026-12-31'],
  ['ASAP', '2026-11-02'],
  ['尽快', '2026-11-02'],
  ['明天下午前完成', '2026-11-03'],
  ['在下周五前', '2026-11-13'],
  ['在下周之前', '2026-11-08'],
  ['no deadline here', null],
];

for (const [phrase, expected] of cases) {
  test(`due date “${phrase}”`, () => {
    const hit = extractDue(phrase, REFERENCE);
    assert.equal(hit?.due ?? null, expected);
    if (expected && hit) {
      const slice = phrase.slice(hit.start, hit.end);
      assert.ok(slice.length >= 2);
      assert.ok(phrase.includes(slice));
    }
  });
}

test('explicit ISO dates are not rolled into the future', () => {
  const hit = extractDue('ship it by 2026-10-01 please', REFERENCE);
  assert.equal(hit?.due, '2026-10-01');
  assert.equal('ship it by 2026-10-01 please'.slice(hit?.start, hit?.end), 'by 2026-10-01');
});

test('due spans include a leading connector and leave action prepositions', () => {
  const cases: Array<[string, string]> = [
    ['for next Monday', 'for next Monday'],
    ['by Friday', 'by Friday'],
    ['before Thursday', 'before Thursday'],
    ['on November 7', 'on November 7'],
    ['until Friday', 'until Friday'],
    ['till Friday', 'till Friday'],
    ['after Thursday', 'after Thursday'],
    ['No later than next Monday', 'No later than next Monday'],
    ['within 1 day', 'within 1 day'],
    ['at end of week', 'at end of week'],
    ['for 2026-11-07', 'for 2026-11-07'],
    ['schedule the client demo for next Monday.', 'for next Monday'],
    ['schedule it for, next Monday.', 'for, next Monday'],
    ['look for the report by Friday', 'by Friday'],
    ['therefore Friday', 'Friday'],
    ['that Friday', 'Friday'],
    ['soon Friday', 'Friday'],
    ['beforehand Friday', 'Friday'],
    ['still Friday', 'Friday'],
    ['that end of week', 'end of week'],
    ['在下周五前', '在下周五前'],
    ['在下周之前', '在下周之前'],
    ['11月7日前完成', '11月7日前完成'],
    ['明天下午前完成', '明天下午前完成'],
    ['下周前', '下周前'],
  ];
  for (const [phrase, slice] of cases) {
    const hit = extractDue(phrase, REFERENCE);
    assert.ok(hit, phrase);
    assert.equal(phrase.slice(hit.start, hit.end), slice, phrase);
  }
});
