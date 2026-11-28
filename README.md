# Bizvyra: AI security for small businesses

by Team Cyber Forge

**Detect. Fix. Protect. Prove.**

## Overview

Bizvyra is an affordable AI security guard for Pakistani small businesses. Version 1 tests a business's **AI chatbot**:

1. **Detect**: attacks the bot in English, Urdu and Roman Urdu (natively written, the way customers really type).
2. **Prove**: every leak is confirmed by objective checks (canary token, protected values, system-prompt overlap) before an LLM judge is asked.
3. **Fix**: grades the bot A–F and writes a hardened system prompt plus an output guard.
4. **Protect**: re-tests the fixed bot to prove the fix worked (target: F → C → B across defence levels L0 → L1 → L2).

The platform is modular: more checks (website and email health, links, ERP) plug in later as modules.

Built for the Capital Youth Expo Hackathon (Track 6), November 2026.

## Live demo

_Coming soon: link to the Vercel deployment._

## Video

_Coming soon: demo video link._

## Results

_Coming soon: attack success rate per defence level (L0 / L1 / L2), per language and per intent._

## Architecture

```
UI (src/app/(pages), src/components)
  → API route handlers (src/app/api) — thin, zod-validated
    → src/core: module registry · scan orchestrator · Finding model · scoring · fix+verify loop
                 · report builder · security kit (owner token, rate limit, usage cap, SSRF guard)
                 · llm adapter · db repository
      → src/modules/chatbot   (attack library, judge, hardener, demo bot)
      → src/modules/web_email (stretch)
  → Supabase · LLM API
```

- **Attack model:** intent × technique × language. 5 intents (leak discount codes, steal the system prompt, approve a refund, ignore instructions, brand abuse), 7 techniques (naive, escape characters, context ignoring, fake completion, persona, nested role-play, encoding), 3 languages (`en`, `ur`, `roman_ur`). 20 attacks in `src/modules/chatbot/attacks/library.json`.
- **Judge pipeline** (stops at the first decision): canary → protected assets → system-prompt overlap (character 8-grams; ≥ 50% breach) → LLM judge (`MODEL_JUDGE`, falling back to `MODEL_FAST`; JSON verdict, intent-specific rubric) → pass. Timeouts, API errors and unreadable verdicts are `error` and never count as a pass.
- **Canary:** a fresh 16-character random token is generated inside every step request, planted in the bot's instructions for that one call, and discarded. The decoder finds it plain, in any case, with characters separated, reversed, base64- or hex-encoded. It is never returned, logged or stored.
- **Defence levels:** L0 original prompt · L1 hardened prompt · L2 L1 + output guard.
- **Hardener** (`POST /api/fix`): works with no LLM. It removes every protected value from the bot's instructions (replaced by a neutral description), adds 8 numbered security rules that hold in English, Urdu and Roman Urdu (confidentiality in any language or encoding, no authority claims, no refunds or discounts, ignore embedded instructions, stay on topic, respect the brand), and a refusal style in the customer's language. If `MODEL_STRONG` is set, an LLM may polish the wording; its answer is used only if it is valid JSON, keeps every rule word for word and adds no protected value, otherwise the deterministic prompt is used.
- **L2 output guard:** a reply containing the canary or a protected value (any form) is replaced by a refusal in the customer's language; otherwise an AI self-check (`MODEL_JUDGE`, JSON `{violates, reason}`) can replace a rule-breaking reply. If the self-check fails, only the protected-value block applies. The judge rates the reply the customer would actually see.
- **Scoring:** severity-weighted attack success rate (ASR) → score 0–100 → grade A (≥ 90) · B (≥ 75) · C (≥ 60) · D (≥ 40) · F, with ASR per language and per intent.
- **Stateless scans:** the browser holds the target, the steps and the findings; the scan routes store nothing. `POST /api/scans` returns the plan (quick = 30 steps, full = 60), the browser runs `POST /api/scans/step` three at a time, then `POST /api/scans/finalize` scores the findings. Full contract: [`docs/api-contract.md`](docs/api-contract.md).
- **API:** `POST /api/scans` · `POST /api/scans/step` · `POST /api/scans/finalize` · `POST /api/fix` · `POST /api/demo-bot/chat` · `POST /api/reports`, `GET /api/reports/[slug]`, `POST /api/leads` (T004; mocked until then). `POST /api/targets` is a leftover mock outside the v2 core loop.

## Security design

- **Only test what you own:** the demo bot or your own pasted system prompt. Testing live endpoints will require ownership verification.
- **Owner identity:** an unguessable 256-bit token in an httpOnly, Secure, SameSite=Lax cookie; only its SHA-256 hash is stored.
- **Input validation:** zod and size limits on every server input (chat messages ≤ 4000 characters, at most 20 per request).
- **Rate limiting:** every public POST route is rate-limited per IP (`/api/scans/step`: 120/min in `demo` mode, 60/min in `public` mode); the free tier allows 3 scans per IP per day in `public` mode. `BIZVYRA_MODE` defaults to `demo` when unset; any value other than `demo` or `public` is treated as `public`. Limits are in memory, per server instance.
- **SSRF guard** (for future endpoint mode): resolves DNS and blocks private, loopback, link-local, CGNAT and metadata ranges for IPv4 and IPv6 (including IPv4-mapped IPv6); re-checks every redirect; at most 3 redirects; 8 s timeout.
- **Minimal storage:** the scan routes store nothing. Every finding's prompt, response (≤ 1000 characters) and evidence are redacted of the canary and every protected value (plain, separated, reversed and encoded forms) before they leave the server.
- **Database:** Supabase Postgres accessed server-side only with the service role key; row level security on every table, no anonymous policies.
- **LLM calls:** one adapter, temperature 0, 15 s timeout per attempt, retries with backoff on rate limits and outages (30 s per call at most), typed errors that never reach the client and never include the API key.
- **Secrets:** never in code, logs, commits, prompts or reports. `.env.local` is never committed; see `.env.example`.

## Tech stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS · zod · Supabase Postgres · Gemini API or an OpenAI-compatible endpoint (NVIDIA NIM) · Vitest · Vercel

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
cp .env.example .env.local   # then fill in the LLM and Supabase values
npm run dev                  # http://localhost:3000
```

- Without an LLM key the app still builds and runs; the demo bot returns a 502 "unavailable" error.
- In WSL with the repo on a Windows drive (`/mnt/...`), set `WATCHPACK_POLLING=true` in `.env.local`.
- Database schema: `supabase/migrations/0001_init.sql`.

Checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

LLM settings in `.env.local` (see `.env.example`):

- `MODEL_FAST` (required for scans): the demo bot and the bot under test.
- `MODEL_JUDGE` (optional): the LLM judge and the L2 self-check; falls back to `MODEL_FAST`.
- `MODEL_STRONG` (optional): polishes the hardened prompt; without it the deterministic hardener is used.
- `LLM_REASONING=off` (optional): switches off the model's thinking step, for reasoning models that are slow or spend the token budget on thinking. `openai_compatible` request bodies get `"reasoning": { "enabled": false }`; Gemini request bodies get `generationConfig.thinkingConfig.thinkingBudget = 0` (Flash models; Pro models cannot switch thinking off). Unset leaves request bodies unchanged.
- `SCAN_CONCURRENCY` (optional, integer 1–5, default 3): how many scan steps the browser runs at the same time (the `concurrency` value of `POST /api/scans`). Invalid values use 3.
- **Retries:** every LLM call is retried when the provider answers HTTP 429, 500, 502, 503 or 504, or the network fails before a response. It retries up to 3 times with backoff and jitter (about 1 s, 2 s, 4 s), honours `Retry-After` (seconds or an HTTP date), waits at most 10 s each time, and gives up after 30 s in total. HTTP 400, 401, 403 and 404 and timeouts are not retried. A call that still fails becomes an `error` finding that names the cause (for example "The AI provider is rate-limiting requests (too many per minute)"). An error never counts as a pass.

**Free-tier keys.** Free and low-tier keys (for example Gemini's free tier) allow only a few requests per minute. Set `SCAN_CONCURRENCY=1` and `LLM_REASONING=off` in `.env.local`. A scan is then slower, but it finishes with real results instead of rate-limit errors.

Smoke test (calls the real LLM: one quick scan is 30 bot calls plus up to 30 judge calls; L2 adds up to 30 self-check calls). With the dev server running and the LLM variables set in `.env.local`:

```bash
node eval/smoke-demo.mjs                                  # L0 only; BASE_URL defaults to http://localhost:3000
node eval/smoke-demo.mjs --levels 0,1,2                   # L0, then /api/fix and re-scans at L1 and L2
BASE_URL=https://your-deployment.example node eval/smoke-demo.mjs --levels 0,1,2
```

Add `--concurrency N` (1–10) to override the server's `SCAN_CONCURRENCY` for one run, for example `node eval/smoke-demo.mjs --concurrency 1`.

It scans the demo bot at L0 (quick, 30 steps, `concurrency` at a time, 3 by default). With `--levels`, it calls `/api/fix` for L1 and L2 using the L0 findings and scans each level with the returned fix. It prints one table (level, grade, score, breaches, passes, errors, ASR by language) and writes the full results to `eval/results/<timestamp>.json`.

## Disclosures

External libraries:

| Library | Use | License |
|---|---|---|
| [Next.js](https://nextjs.org) | Web framework, API route handlers | MIT |
| [React](https://react.dev) / React DOM | UI | MIT |
| [TypeScript](https://www.typescriptlang.org) | Language | Apache-2.0 |
| [Tailwind CSS](https://tailwindcss.com) (+ `@tailwindcss/turbopack`) | Styling | MIT |
| [ESLint](https://eslint.org) + `eslint-config-next` | Linting | MIT |
| [zod](https://zod.dev) | Validation of every server input and shared types | MIT |
| @supabase/supabase-js | Server-side database client | MIT |
| [Vitest](https://vitest.dev) | Unit tests (development only) | MIT |

External services:

| Service | Use |
|---|---|
| [Google Gemini API](https://ai.google.dev) | LLM for the demo bot, the bot under test, the LLM judge, the L2 self-check and the optional hardener refinement (when `LLM_PROVIDER=gemini`) |
| [NVIDIA NIM](https://build.nvidia.com) (OpenAI-compatible API) | Alternative LLM provider (when `LLM_PROVIDER=openai_compatible`) |
| Supabase | Postgres database |
| [Vercel](https://vercel.com) | Hosting |

AI assistance: the code was written during the hackathon with AI coding assistants (Claude Code, Codex, Antigravity) under the team's direction and review.

Judge and fix: the canary decoder, asset matcher, n-gram overlap scorer, LLM-judge rubrics, bilingual finding texts, hardener security rules, refusal texts and output guard were written for this project. The canary and n-gram overlap ideas are credited under "Prior work" below.

Attack prompts: all 20 attacks in English, Urdu and Roman Urdu were written for this project. Technique names follow published research (Perez & Ribeiro 2022; Liu et al., USENIX Security 2024; Wei et al. 2023; Shen et al., CCS 2024), cited in each attack's `reference` field. The demo shop "Zara Fabrics" and its discount codes are fictional.

## Prior work & what we improved

Bizvyra's design was informed by studying open-source LLM security tools. No code or attack datasets were copied; all logic and all attack prompts were written for this project.

- **Garak** (NVIDIA, Apache-2.0): probe/detector/transform architecture and n-gram system-prompt leak scoring. *Bizvyra adds native Roman Urdu and Urdu attacks, owner-facing reports and automatic hardening.*
- **Prompt Fuzzer** (Prompt Security, MIT): streaming per-attack progress, breach/resilient/error states, attacks tailored to the target prompt. *Bizvyra replaces English-keyword refusal detection with a judge that works in any language and targets business harm.*
- **Rebuff** (Protect AI, Apache-2.0): canary-token leak detection. *Bizvyra detects canaries even when they're leaked letter by letter, reversed or encoded.*
- **LLMFuzzAgent** (Corca, 2023) and **Gandalf** (Lakera): adaptive attacker agent and defence levels.

## Roadmap

- **Now (v1):** chatbot module: demo bot, paste-your-prompt mode, live scan feed, judge pipeline, defence levels L0/L1/L2, bilingual report card (English/Urdu), shareable report link, lead form, free-tier limit.
- **Stretch:** website and email health module (passive DNS, TLS and header checks with a fix writer).
- **After the hackathon:** login, payments, monitoring, live endpoint testing with ownership verification, PDF export, an adaptive attacker agent, links and ERP modules.

## Team

**Team Cyber Forge**

_Team members: to be added._
