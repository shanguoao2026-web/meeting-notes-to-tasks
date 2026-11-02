# meeting-notes-to-tasks

Parse meeting transcripts into action items with owners and due dates.

The tool reads UTF-8 `.txt`, `.vtt`, and `.srt` notes in Chinese, English, or a mix. It extracts tasks with rule-based patterns first. An optional `--llm` flag can fill gaps through any OpenAI-compatible chat API. The default endpoint is [SpaceXAI](https://docs.x.ai) (the xAI API).

## Install

```bash
npm install
```

`npm install` compiles `dist/`. You can then run the command directly:

```bash
npx meeting-notes-to-tasks --help
# or
node dist/cli.js --help
```

Node.js 20 or newer is required. There are no runtime dependencies.

## Quick start

```bash
meeting-notes-to-tasks parse --in examples/mixed-sync.vtt --out ./out --format both --reference-date 2026-11-02
meeting-notes-to-tasks parse --in examples/zh-weekly.txt --out ./out.json --reference-date 2026-11-02
```

`--reference-date` fixes “Friday” and “下周” to a known day. When you omit it, those phrases resolve against today in the local timezone.

## CLI

```text
meeting-notes-to-tasks parse --in <file> --out <file|dir> [options]
```

| Option | Meaning |
| --- | --- |
| `--in`, `--input` | Transcript path. `.txt`, `.text`, `.vtt`, `.srt`, or no extension (plain text). |
| `--out`, `--output` | A directory, or a single `.json`, `.md`, or `.html` file. |
| `--format` | `json`, `md` (`markdown`), `both` (default for a directory), `html`, or `all`. |
| `--default-owner` | Owner used when the line does not name one. |
| `--reference-date` | `YYYY-MM-DD` anchor for relative dates. |
| `--llm` | Enrich the rule result with an OpenAI-compatible model. |
| `--llm-model` | Model id. Default `grok-4.7`. |
| `--llm-base-url` | API base URL. Default `https://api.x.ai/v1`. |
| `--api-key` | API key. Prefer `XAI_API_KEY` so the key stays out of shell history. |
| `-h`, `--help` | Help. |
| `-v`, `--version` | Version. |

A directory output writes `tasks.json` and `tasks.md`. `--format all` also writes `tasks.html`. A path that ends in `.json`, `.md`, or `.html` writes that one file. Existing files are overwritten.

Exit codes: `0` success, `1` bad arguments or a read error, `2` input file not found.

## Input formats

All three formats are UTF-8. A leading BOM is ignored.

### Plain text (`.txt`)

Speaker labels use `Name:` or `张三：`. The label can sit after a timestamp such as `[00:12:03]` or `00:12:03`. Bullets and Markdown checkboxes (`- [ ]`) are stripped. A line without a label keeps the previous speaker, which is how wrapped notes stay attached to the right person.

```text
Alice: Let's capture owners before we drop.
ACTION: Bob to send the Q3 report by Friday.
赵六：我来跟进客户回访，三天内完成。
```

### WebVTT (`.vtt`)

Cue timings are ignored for the task text. Speakers come from a `Name:` prefix or a voice tag such as `<v 张三>`. `NOTE`, `STYLE`, and `REGION` blocks are skipped. Inline tags are removed.

```text
WEBVTT

00:00:01.000 --> 00:00:04.000
Alice: ACTION: send the deck to the client by Friday.

00:00:05.000 --> 00:00:09.000
<v 张三>请王芳下周前确认合同条款。
```

### SubRip (`.srt`)

Same cue rules as WebVTT. Timestamps may use a comma before the milliseconds (`00:00:01,000`). Cue index lines are ignored.

```text
1
00:00:01,000 --> 00:00:04,000
Priya: I will share the metrics by November 7.
```

`source.line` is the 1-based line of that sentence in the original file (the first text line of a caption cue).

## Heuristics

Rules run in this order. A line becomes a task only when one of them matches.

1. **Explicit marker.** The sentence starts with `ACTION`, `Action item`, `TODO`, `FIXME`, `Task`, `待办`, `行动项`, or `任务`, followed by `:`, `：`, or `-`. The marker itself is not the owner. These lines are kept even when the wording is short.
2. **Self-assignment.** `I'll`, `I will`, `I should`, `I need to`, `我来`, `我去`, `我将`, `我会`, `我负责`. The owner is the current speaker.
3. **Named assignment.**
   - English: `Dana to book…`, `Carol will update…`, `Eve should review…`, `Please ask Dana to…`, `Bob is responsible for…`, `assigned to Nina`, `@Nina`.
   - Chinese: `请李四…`, `麻烦李四…`, `交给周敏…`, `安排陈七…`, `由李四负责…`, `王五负责…`, `李四来跟进…`.
4. **Polite imperative.** `Please send…` or `请提交…` with an action verb. The owner is the speaker, then `--default-owner`.

An ordinary commitment also needs an action verb (`send`, `review`, `migrate`, `整理`, `提交`, `跟进`, `确认`, …). That drops status lines such as “Alice will be out Friday” and “The design review went well.”

Questions that end in `?` or `？` are skipped unless they carry an explicit marker. Lunch, weather, and “sounds good” do not match an assignment pattern, so they are ignored.

**Owners.** A name written in the sentence wins over the speaker label. `I'll` / `我来` uses the speaker. Speaker labels look like `Alice:` or `张三：` (English names are capitalized; Chinese names are two to four Han characters). Words such as `We`, `Today`, `大家`, and `我们` are not treated as people.

**Duplicates.** The same action text for compatible owners collapses into one task. The earlier line is kept, and a missing owner or due date is filled from the later copy.

**Confidence** is a number from `0.35` to `0.95`:

| Situation | Typical score |
| --- | --- |
| Explicit marker, named owner, and a due date | `0.95` |
| `will` / `负责` / `交给` with an owner and a date | about `0.85` |
| Speaker says `I'll` / `我来` and names a date | about `0.82` |
| `should` / `需要` | about `0.69` |
| No owner could be found | lower |

**Limits.** The extractor does not understand implied owners (“someone should…”), questions used as requests, or names that are only a role (“the backend”). A line that starts with `任务：` or `Task:` is kept when any wording remains after the marker. Relative dates that have already passed move forward to the next future occurrence; a date that includes a year is left as written, even if it is in the past.

## Due dates

Weeks start on Monday. Examples below use the reference date **Monday 2026-11-02**.

| Phrase | Due |
| --- | --- |
| `today` / `今天` / `今晚` / `ASAP` / `尽快` / `EOD` | 2026-11-02 |
| `tomorrow` / `明天` / `明日` | 2026-11-03 |
| `day after tomorrow` / `后天` | 2026-11-04 |
| `大后天` | 2026-11-05 |
| `in 3 days` / `三天内` / `三天后` | 2026-11-05 |
| `by Friday` / `this Friday` / `本周五` / `end of week` / `EOW` / `this week` / `本周内` | 2026-11-06 |
| `下周之前` / `下周前` / `weekend` | 2026-11-08 (Sunday that ends this week) |
| `by next Monday` / `下周一` | 2026-11-09 |
| `next Friday` / `下周五` / `next week` / `下周` / `end of next week` | 2026-11-13 |
| `in two weeks` / `两周内` | 2026-11-16 |
| `November 7` / `11月7日` / `2026-11-07` | 2026-11-07 |
| `月底` / `EOM` | 2026-11-30 |
| `下月底` / `next month` | 2026-12-31 |

Also recognized: `YYYY-MM-DD`, `YYYY年M月D日`, English month names, `M/D` and `M/D/YYYY` (if the first number is greater than 12 it is read as `D/M`), `in N days/weeks`, Chinese numerals such as `十二天后`, `本周末` / `下周末`, and weekday abbreviations (`Fri`, `Mon`, …). `下周之前` means “before next week”, which is this Sunday, not next Friday.

## Output

JSON is the stable contract. `owner` and `due` are `null` when the transcript does not say them. `due` is `YYYY-MM-DD` when it does.

```json
{
  "tasks": [
    {
      "id": "t1",
      "text": "整理会议纪要",
      "owner": "张三",
      "due": "2026-11-07",
      "confidence": 0.8,
      "source": { "line": 12 }
    }
  ],
  "meta": { "language_guess": "zh", "task_count": 1 }
}
```

`language_guess` is `zh`, `en`, `mixed`, or `unknown`. A short foreign name does not flip a mostly monolingual note to `mixed`. Markdown is a table with id, task, owner, due, confidence, and source line. HTML is one self-contained page with no external assets. Missing owners and dates render as an em dash.

## Examples

Both commands below use `--reference-date 2026-11-02`. The fixtures are `examples/en-standup.txt` and `examples/zh-weekly.txt`.

### English

```bash
meeting-notes-to-tasks parse \
  --in examples/en-standup.txt \
  --out ./out.json \
  --reference-date 2026-11-02
```

```json
{
  "tasks": [
    {
      "id": "t1",
      "text": "Send the Q3 report",
      "owner": "Bob",
      "due": "2026-11-06",
      "confidence": 0.95,
      "source": { "line": 5 }
    },
    {
      "id": "t2",
      "text": "Update the roadmap",
      "owner": "Carol",
      "due": "2026-11-09",
      "confidence": 0.85,
      "source": { "line": 7 }
    },
    {
      "id": "t3",
      "text": "Book the customer call",
      "owner": "Dana",
      "due": "2026-11-05",
      "confidence": 0.85,
      "source": { "line": 8 }
    },
    {
      "id": "t4",
      "text": "Draft the release notes",
      "owner": "Bob",
      "due": "2026-11-06",
      "confidence": 0.82,
      "source": { "line": 9 }
    },
    {
      "id": "t5",
      "text": "Review the pull request",
      "owner": "Eve",
      "due": null,
      "confidence": 0.69,
      "source": { "line": 10 }
    }
  ],
  "meta": { "language_guess": "en", "task_count": 5 }
}
```

Eve has no due date, so `due` is null. “The design review went well” and the lunch line are not tasks.

### Chinese

```bash
meeting-notes-to-tasks parse \
  --in examples/zh-weekly.txt \
  --out ./out.json \
  --reference-date 2026-11-02
```

```json
{
  "tasks": [
    {
      "id": "t1",
      "text": "整理会议纪要",
      "owner": "李四",
      "due": "2026-11-08",
      "confidence": 0.95,
      "source": { "line": 4 }
    },
    {
      "id": "t2",
      "text": "提交预算表",
      "owner": "王五",
      "due": "2026-11-13",
      "confidence": 0.85,
      "source": { "line": 5 }
    },
    {
      "id": "t3",
      "text": "跟进客户回访",
      "owner": "赵六",
      "due": "2026-11-05",
      "confidence": 0.82,
      "source": { "line": 6 }
    },
    {
      "id": "t4",
      "text": "更新官网文案",
      "owner": "陈七",
      "due": "2026-11-09",
      "confidence": 0.85,
      "source": { "line": 8 }
    },
    {
      "id": "t5",
      "text": "对接供应商",
      "owner": "周敏",
      "due": "2026-11-07",
      "confidence": 0.85,
      "source": { "line": 9 }
    }
  ],
  "meta": { "language_guess": "zh", "task_count": 5 }
}
```

`下周之前` is Sunday 2026-11-08. `下周五` is Friday of next week, 2026-11-13. The weather line is ignored.

Caption fixtures with the same date: `examples/mixed-sync.vtt` (mixed Chinese and English, voice tags) and `examples/retro.srt`.

## Optional LLM enhancement

Rules always run first. `--llm` sends the numbered transcript, the reference date, and the rule tasks to `POST {base}/chat/completions`. The model may fill a null owner or due date and may add tasks the rules missed. Text, owners, and dates that the rules already found are kept. If the request or the JSON fails, the command warns on stderr and still writes the rule-based result.

```bash
export XAI_API_KEY="your-key"
meeting-notes-to-tasks parse \
  --in examples/mixed-sync.vtt \
  --out ./out \
  --llm \
  --reference-date 2026-11-02
```

| Setting | Source | Default |
| --- | --- | --- |
| API key | `--api-key`, else `XAI_API_KEY`, else `OPENAI_API_KEY` | none |
| Base URL | `--llm-base-url`, else `LLM_BASE_URL` | `https://api.x.ai/v1` |
| Model | `--llm-model`, else `LLM_MODEL` | `grok-4.7` |

SpaceXAI is the provider name. The API is the xAI API, which is OpenAI-compatible, so the same flag works against another `/v1/chat/completions` server when you change the base URL and key. The key is read from the environment, is not written to the output, and is redacted from error text. See `.env.example`. Do not commit a real key.

Unit tests never call the network. They pass a stub client or a fake `fetch`.

## Library

```typescript
import { parseMeetingText, renderMarkdown } from 'meeting-notes-to-tasks';

const result = await parseMeetingText(transcript, 'notes.vtt', {
  referenceDate: '2026-11-02',
  defaultOwner: 'Alice',
});
console.log(renderMarkdown(result));
```

`parseMeeting(path, options)` reads a file. `createChatClient({ apiKey, fetchImpl })` builds the HTTP client; tests inject `fetchImpl`.

## Development

```bash
npm test
npm run build
```

`npm test` compiles with TypeScript and runs the Node.js test runner. Fixtures cover an English `.txt`, a Chinese `.txt`, a WebVTT file, and a SubRip file. Global `fetch` is replaced in the tests so a regression cannot open a socket.

## License

MIT. See [LICENSE](LICENSE).
