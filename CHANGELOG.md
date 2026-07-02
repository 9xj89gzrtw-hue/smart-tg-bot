# Changelog

## [v8.0] — 2026-07-02
### Added
- Bot v8: HuggingFace Router (124 free open-weight models)
- Llama-3.3-70B as PRIMARY (direct answers, 0.3-0.9s)
- Web search (DuckDuckGo + Wikipedia) for current facts
- CRITICAL_RULES injection in every system prompt
- R33-R40 rules (skip-if-active fix, model testing, EIE, KEMGS, R40)

### Fixed
- skip-if-active bug (was skipping bot start — R33)
- || true hiding errors (removed — R35)
- GLM-4-Plus → GLM-5.2 (outdated info — R25)

### Changed
- DeepSeek-V4-Flash → Llama-3.3-70B as PRIMARY (R34: V4 outputs thoughts)
- Sandbox polling → GH Actions 24/7 (no 409 conflict)

## [v7.0] — 2026-07-02
### Added
- CRITICAL_RULES.md (behaviors not facts — R25)
- OpenRouter integration (Nemotron reasoning free)
- DeepSeek + Google AI + Groq API keys

## [v6.0] — 2026-07-01
### Added
- Self-Consistency (97.3% MATH-500)
- Reflexion (self-critique + fix)
- Multi-Agent Debate (3 perspectives)
- Function calling (autonomous tools)

## [v5.0] — 2026-07-01
### Added
- Function calling (web_search, get_crypto_price)
- Streaming support
- Vision support (gpt-4o)

## [v4.0] — 2026-07-01
### Added
- Mega cascade (5 AI providers)
- Groq + OpenAI + Google AI integration
- GitHub Actions 24/7 runner
