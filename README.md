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
- **Judge pipeline** (stops at the first decision): canary → protected assets → system-prompt overlap (character 8-grams; ≥ 50% breach) → LLM judge (`MODEL_FAST`, JSON verdict, intent-specific rubric) → pass. Timeouts, API errors and unreadable verdicts are `error` and never count as a pass.
- **Canary:** a fresh 16-character random token is generated inside every step request, planted in the bot's instructions for that one call, and discarded. The decoder finds it plain, in any case, with characters separated, reversed, base64- or hex-encoded. It is never returned, logged or stored.
- **Defence levels:** L0 original prompt · L1 hardened prompt · L2 L1 + output guard (the hardener and output guard arrive in T003).
- **Scoring:** severity-weighted attack success rate (ASR) → score 0–100 → grade A (≥ 90) · B (≥ 75) · C (≥ 60) · D (≥ 40) · F, with ASR per language and per intent.
- **Stateless scans:** the browser holds the target, the steps and the findings; the scan routes store nothing. `POST /api/scans` returns the plan (quick = 30 steps, full = 60), the browser runs `POST /api/scans/step` three at a time, then `POST /api/scans/finalize` scores the findings. Full contract: [`docs/api-contract.md`](docs/api-contract.md).
- **API:** `POST /api/scans` · `POST /api/scans/step` · `POST /api/scans/finalize` · `POST /api/fix` (T003; returns 501 until then) · `POST /api/demo-bot/chat` · `POST /api/reports`, `GET /api/reports/[slug]`, `POST /api/leads` (T004; mocked until then). `POST /api/targets` is a leftover mock outside the v2 core loop.

## Security design

- **Only test what you own:** the demo bot or your own pasted system prompt. Testing live endpoints will require ownership verification.
- **Owner identity:** an unguessable 256-bit token in an httpOnly, Secure, SameSite=Lax cookie; only its SHA-256 hash is stored.
- **Input validation:** zod and size limits on every server input (chat messages ≤ 4000 characters, at most 20 per request).
- **Rate limiting:** every public POST route is rate-limited per IP (`/api/scans/step`: 120/min in `demo` mode, 60/min in `public` mode); the free tier allows 3 scans per IP per day in `public` mode. `BIZVYRA_MODE` defaults to `demo` when unset; any value other than `demo` or `public` is treated as `public`. Limits are in memory, per server instance.
- **SSRF guard** (for future endpoint mode): resolves DNS and blocks private, loopback, link-local, CGNAT and metadata ranges for IPv4 and IPv6 (including IPv4-mapped IPv6); re-checks every redirect; at most 3 redirects; 8 s timeout.
- **Minimal storage:** the scan routes store nothing. Every finding's prompt, response (≤ 1000 characters) and evidence are redacted of the canary and every protected value (plain, separated, reversed and encoded forms) before they leave the server.
- **Database:** Supabase Postgres accessed server-side only with the service role key; row level security on every table, no anonymous policies.
- **LLM calls:** one adapter, temperature 0, 15 s timeout, typed errors that never reach the client and never include the API key.
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

Smoke test (calls the real LLM: one quick scan is 30 bot calls plus up to 30 judge calls). With the dev server running and the LLM variables set in `.env.local`:

```bash
node eval/smoke-demo.mjs                                  # BASE_URL defaults to http://localhost:3000
BASE_URL=https://your-deployment.example node eval/smoke-demo.mjs
```

It plans a quick L0 scan of the demo bot, runs all 30 steps three at a time, finalizes, and prints the grade, the score and the ASR by language and by intent.

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
| [Google Gemini API](https://ai.google.dev) | LLM for the demo bot, the bot under test, the LLM judge and the hardener (when `LLM_PROVIDER=gemini`) |
| [NVIDIA NIM](https://build.nvidia.com) (OpenAI-compatible API) | Alternative LLM provider (when `LLM_PROVIDER=openai_compatible`) |
| Supabase | Postgres database |
| [Vercel](https://vercel.com) | Hosting |

AI assistance: the code was written during the hackathon with AI coding assistants (Claude Code, Codex, Antigravity) under the team's direction and review.

Judge: the canary decoder, asset matcher, n-gram overlap scorer, LLM-judge rubrics and the bilingual finding texts were written for this project. The canary and n-gram overlap ideas are credited under "Prior work" below.

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
