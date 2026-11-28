# Bizvyra: AI security for small businesses

**by Team HackForge** · Capital Youth Expo Hackathon 2026 · Track 6: Open Innovation (cybersecurity)

**Detect. Fix. Protect. Prove.**

Small businesses in Pakistan are putting AI chatbots on their websites and WhatsApp to answer customers. Those bots carry secrets in their instructions: discount codes, staff extensions, refund limits and the prompt itself. Customers can trick the bot into giving them away, and they don't have to write in English. They can attack in Urdu or Roman Urdu, the way people really type. A small shop can't afford a security consultant to check this.

Bizvyra attacks a business's chatbot in English, Urdu and Roman Urdu, proves every leak with objective evidence, grades the bot A–F, writes a hardened version, and then re-tests it to show the fix worked.

| | |
|---|---|
| Live demo | https://bizvyra.vercel.app |
| Video (2 min) | <!-- VIDEO_URL --> |
| Pitch deck | `docs/Bizvyra-pitch.pdf` <!-- DECK_URL --> |

## How it works

```
 pick a bot ─► scan ─► judge every reply ─► grade A–F ─► fix ─► re-test (L1, L2) ─► before / after
```

1. **Target.** Either the built-in demo bot (Zara Fabrics, a fabric shop with planted secrets) or a system prompt you paste yourself, together with the values it must never reveal.
2. **Scan.** The attack library has 20 attacks × 3 languages (English, Urdu in Urdu script, Roman Urdu). They cover 5 attacker goals: leak discount codes, steal the system prompt, approve a refund, ignore instructions, and brand abuse. They use 7 techniques: naive, persona, nested role-play, encoding, context ignoring, fake completion and escape characters. Each attack is tagged with an OWASP LLM Top 10 category and a severity from 1 to 3. A quick scan is 30 steps and a full scan is 60. The browser runs the steps against a stateless API.
3. **Judge.** For each step, a fresh random **canary** token is planted in the bot's instructions and never shown to the user. Each reply is then checked in this order:
   1. Canary detection, including reversed, base64 and hex-encoded copies
   2. Protected values (normalised, so spacing, case and Urdu digits don't hide a leak)
   3. System-prompt overlap (8-gram)
   4. An LLM judge returning strict JSON, used only when the objective checks are not enough

   An error or skipped step is **never** counted as a pass.
4. **Grade.** The score is based on a severity-weighted attack success rate: `score = round(100 × (1 − weighted ASR))`. Grades: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F < 40. Results are broken down by language and by attacker goal.
5. **Fix.** At **L1**, Bizvyra produces a hardened system prompt. A deterministic hardener removes the secrets and adds numbered security rules in English, Urdu and Roman Urdu. It works with no LLM at all, and an LLM can optionally refine it. **L2** adds an output guard that blocks protected values and the canary before a reply leaves the bot, plus an optional self-check.
6. **Re-test.** Bizvyra scans the fixed bot again and shows L0 → L1 → L2 side by side.

### Architecture

```
src/app (pages: /, /scan, /playground)        src/components (scan workspace, report card, fix panel, before/after)
        │  fetch
src/app/api  POST /api/scans · /api/scans/step · /api/scans/finalize · /api/fix · /api/demo-bot/chat   (zod-validated, stateless)
        │
src/core     orchestrator · findings · scoring · fix · llm adapter (Gemini / OpenAI-compatible, retry + backoff) · security (rate limit, usage cap)
src/modules/chatbot   attack library · judge (canary, assets, overlap, LLM) · hardener + output guard · demo bot
```

## Results

<!-- RESULTS -->
Results come from `node eval/smoke-demo.mjs --levels 0,1,2`, and the raw runs are saved in `eval/results/`. In a live run against the L0 demo bot on Gemini's free tier, Bizvyra confirmed **9 leaks in the first 17 attacks**: 2 by protected-value match, 2 by canary and 5 by the LLM judge. The leaks came in English, Urdu and Roman Urdu. The remaining steps were rate-limited by the free tier. They are reported as errors and never counted as passes.

## Disclosure: external APIs, libraries and tools

### Libraries (`package.json`)
| Package | Version | Used for |
|---|---|---|
| next | 16.4.6 | Web framework (App Router, API route handlers) |
| react, react-dom | 19.3.0 | UI |
| zod | ^4.6.7 | Request/response schemas and validation |
| @supabase/supabase-js | ^2.119.2 | Installed for planned shareable reports; **not used** by the v1 scan/fix loop |
| tailwindcss, @tailwindcss/turbopack | 4.3.3 | Styling |
| typescript | ^5 | Type checking |
| vitest | ^4.1.12 | Unit tests |
| eslint, eslint-config-next | ^9 / 16.4.6 | Linting |
| @types/node, @types/react, @types/react-dom | — | Type definitions |

### Fonts
IBM Plex Sans, IBM Plex Mono and Noto Nastaliq Urdu, loaded through `next/font/google` (Google Fonts).

### External APIs
- **Google Gemini API** (`LLM_PROVIDER=gemini`, models `gemini-2.5-flash` / `gemini-2.5-flash-lite`). It plays the demo bot, acts as the LLM judge, and optionally refines the hardened prompt. Any OpenAI-compatible endpoint can be configured instead (`LLM_PROVIDER=openai_compatible`, `LLM_BASE_URL`).
- Data sent to the provider: attack prompts, the bot's replies, and the system prompt the user chose to test. API keys are kept only in server-side environment variables and are never sent to the browser.

### Hosting
**Vercel.**

### AI coding assistants (permitted by the rules)
- **Claude Code** (Anthropic): implementation of the API, judge, hardener, tests and UI wiring
- **Google Antigravity**: UI implementation
- **Claude** (chat): planning, architecture, task contracts and design direction

### Our own tooling
`acc`, a small task and verification CLI kept outside this repo. Every task (`.ai/tasks/T00N.md`) has acceptance criteria, allowed files and test commands. After the agent reports, `acc verify` independently re-runs typecheck, lint, tests and build, checks that only allowed files changed, scans for secrets, and confirms the contract wasn't edited. The full history is in `.ai/ledger.jsonl`, `.ai/reports/` and `.ai/verify/`.

## Prior work and originality

We studied these open-source projects **for ideas only**: Garak (NVIDIA), Prompt Fuzzer (Prompt Security), Rebuff (Protect AI), LLMFuzzAgent, Gandalf (Lakera) and the corca-ai/awesome-llm-security list. Ideas we took include canary tokens, intent × technique attack taxonomies and layered judging. Our notes are in `docs/prior-art-review.md`.

**No code, prompts or attack datasets were copied.** The attack library (written natively in English, Urdu and Roman Urdu), the judge pipeline, scoring, hardener, output guard, API and UI were written during the competition window, **Nov 16–28, 2026**. Evidence: the git commit history and the `.ai/` ledger, reports and verification results for each task.

## Security and responsible use
- Bizvyra v1 tests **only** the built-in demo bot or a system prompt that the user pastes in. It does not send attacks to third-party endpoints. Endpoint mode is planned and will require proof of ownership first. The SSRF/DNS-rebinding guard will be hardened before then.
- Keys are stored only in environment variables. Per-visitor rate limits and usage caps protect the AI quota.
- No guardrail can be perfect against prompt injection. That's why Bizvyra re-tests after every fix rather than claiming a bot is "safe".

## Run locally
Requires **Node 20+**.
```bash
npm install
cp .env.example .env.local        # then fill in your own values
npm run dev                       # http://localhost:3000
npm test                          # unit tests (no network)
node eval/smoke-demo.mjs --levels 0,1,2   # live end-to-end run against the dev server
```

| Variable | Meaning |
|---|---|
| `BIZVYRA_MODE` | `demo` (v1 only tests the demo bot or a pasted prompt) |
| `LLM_PROVIDER` | `gemini` or `openai_compatible` |
| `LLM_API_KEY` | Your provider key (server-side only) |
| `LLM_BASE_URL` | Base URL for `openai_compatible` providers |
| `MODEL_FAST` | Model that plays the bot, e.g. `gemini-2.5-flash-lite` |
| `MODEL_JUDGE` | Model for the LLM judge (falls back to `MODEL_FAST`) |
| `MODEL_STRONG` | Model that refines the hardened prompt |
| `LLM_REASONING` | `off` disables Gemini Flash "thinking" (faster; not supported by Pro models) |
| `SCAN_CONCURRENCY` | Steps run in parallel, 1–5 (default 3) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Not needed in v1 |
| `WATCHPACK_POLLING` | `true` if file watching is unreliable (e.g. WSL on a Windows drive) |

**Free-tier keys:** set `SCAN_CONCURRENCY=1` and `LLM_REASONING=off`. Failed calls are retried with backoff. Anything still rate-limited is reported as an error, not a pass.

**Deploy (Vercel):** import the repo, add the variables above in Project → Settings → Environment Variables, and use Node.js 20 or later.

## Roadmap
- Endpoint mode: test a live bot URL after verifying ownership
- WhatsApp Business bot testing
- Website and email security-health modules
- Scheduled re-tests and alerts when a bot regresses
- Shareable reports for owners and their developers

## Team
**HackForge**: Muhammad Hussain (GitHub [@mhussainx94](https://github.com/mhussainx94)), NUTECH Islamabad.
