# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-02

### Added

- Initial command-line release of `meeting-notes-to-tasks`.
- Rule-based action-item extraction for UTF-8 `.txt`, `.vtt`, and `.srt` transcripts in Chinese, English, and mixed meetings.
- Owner and due-date heuristics, including weekday phrases such as "by Friday" and "下周之前".
- JSON, Markdown, and HTML output.
- Optional OpenAI-compatible `--llm` enhancement. The default endpoint is SpaceXAI via `https://api.x.ai/v1` and the `grok-4.7` model.
- Offline unit tests with English, Chinese, WebVTT, and SubRip fixtures.
