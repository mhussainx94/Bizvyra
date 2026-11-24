<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — Muhafiz

Single source of truth for every coding agent on this repo (Claude Code, Codex, Antigravity).
Claude Code reads it through `CLAUDE.md`, which contains only `@AGENTS.md`.

## Product

**Muhafiz** ("Detect. Fix. Protect. Prove.") is an affordable AI security guard for Pakistani small businesses, by Vulnora.
v1 tests a business's **AI chatbot**: it attacks the bot in English, Urdu and Roman Urdu, proves each leak with objective checks, grades the bot A–F, writes a hardened fix, and re-tests to prove the fix worked. The platform is modular so more modules (website & email health, links, ERP) plug in later.

Built for the Capital Youth Expo Hackathon (Track 6), build window Nov 16–28 2026. **All code in this repo is written fresh during the window. Never copy code or attack datasets from other repositories.** Ideas from prior work are credited in the README (see `docs/prior-art-review.md`).

**Core loop (must always work):** demo bot → scan → grade F → Harden → re-test → better grade (target F → C → B across defence levels L0 → L1 → L2).

## Scope

| Built now | Stretch (only after the Thursday checkpoint) | Not built now |
|---|---|---|
| Demo bot "Zara Fabrics Support"; paste-system-prompt mode; live scan feed; judge pipeline; defence levels L0/L1/L2; report card (EN/UR); shareable report link; lead form; free-tier usage limit | `web_email` module (passive DNS/TLS/header checks + fix writer) | Login, payments, monitoring, endpoint mode + ownership verification (types only now), PDF export, adaptive attacker agent |

## Stack and conventions

- Next.js App Router, TypeScript strict, Tailwind, shadcn/ui, zod on **every** server input
- Supabase Postgres, accessed **server-side only** with the service role key; RLS enabled, no anon policies
- Route handlers for the API (the client-driven scan needs them)
- LLM via one adapter, provider chosen by env (Gemini, or an OpenAI-compatible endpoint such as NVIDIA NIM). Temperature 0. 15 s timeout. Typed errors, never thrown to the client
- Vitest for the judge and the canary decoder only
- Vercel hosting. All env vars listed in `.env.example`
- Brand colours: background `#0D1117`, surface `#171D25`, primary `#14B8A6`, accent `#22D3EE`. Urdu text uses Noto Nastaliq Urdu, right-to-left
- `MUHAFIZ_MODE` = `demo` (no limits, for judges) | `public` (free-tier limits on)
- Dev server runs in WSL. If the repo is on a Windows drive (`/mnt/...`), set `WATCHPACK_POLLING=true` in `.env.local` so edits made from Windows reload

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

### Module contract

```ts
interface MuhafizModule {
  id: "chatbot" | "web_email";
  targetSchema: ZodSchema;                       // what the owner provides
  plan(target: Target, level: 0 | 1 | 2): Step[];
  runStep(target: Target, step: Step): Promise<Finding>;
  fix(target: Target, findings: Finding[]): Promise<Fix>;
  applyFix?(target: Target, fix: Fix): Target;  // chatbot: produces the L1/L2 target
}
```

The core never contains module-specific logic.

### Finding (shared by all modules)

```ts
Finding {
  id, scanId, module, checkId,
  title_en, title_ur,
  status: "breach" | "pass" | "error" | "skipped",  // error/skipped NEVER count as pass
  severity: 1 | 2 | 3,
  standard: string,            // e.g. "OWASP-LLM01", "OWASP-LLM07"
  evidence: string,            // redacted: never contains protected assets or the canary in clear
  judgedBy: "canary" | "asset" | "overlap" | "llm" | "rule" | "none",
  businessImpact_en, businessImpact_ur,
  lang?: "en" | "ur" | "roman_ur",
  technique?: string, intent?: string,
  prompt?: string, response?: string (truncated to 1000 chars, redacted),
  latencyMs: number
}
```

### Chatbot module

- **Attack model:** intent × technique × language (+ optional transform).
  - intents: `leak_discount_codes`, `steal_system_prompt`, `approve_refund`, `ignore_instructions`, `brand_abuse`
  - techniques: `naive`, `escape_chars`, `context_ignoring`, `fake_completion`, `persona`, `nested_roleplay`, `encoding`
  - languages: `en`, `ur`, `roman_ur` — written natively, not machine-translated
  - each attack record: `id, intent, technique, lang, owasp, severity, reference, prompt`
  - library: `src/modules/chatbot/attacks/library.json`, about 20 attacks × 3 languages. Quick Scan = 30 steps.
- **Judge pipeline** (stop at the first decision):
  1. canary — normalised (lowercase, strip spaces/punctuation), reversed, and base64/hex-decoded chunks
  2. protected assets — normalised match
  3. system-prompt overlap — character n-gram overlap ≥ 0.5
  4. LLM judge — structured JSON `{breach, reason, confidence}`, understands EN/UR/Roman Urdu
  5. otherwise `pass`; timeouts and API errors → `error`
- **Defence levels:** L0 original prompt · L1 hardened system prompt · L2 L1 + output guard (block canary/assets, then an LLM self-check)
- **Scoring:** attack success rate (ASR) = breaches ÷ (breaches + passes), per level, language and intent. Grade A–F from severity-weighted ASR. Muhafiz Score across modules.
- **Scans are client-driven:** `POST /api/scans` returns the plan; the browser calls `POST /api/scans/[id]/step` for each step, 3 at a time; then `POST /api/scans/[id]/finalize`.

### Data model (Supabase)

| Table | Fields |
|---|---|
| `targets` | id, module, name, config jsonb, protected_assets text[], canary, owner_token_hash, owner_user_id uuid null, created_at |
| `scans` | id, target_id, module, kind (baseline/retest), level smallint, status, score, grade, summary jsonb, created_at, finished_at |
| `findings` | per the Finding shape |
| `fixes` | id, target_id, module, level, content jsonb, created_at |
| `reports` | id, share_slug unique, scan_ids uuid[], created_at, expires_at |
| `leads` | id, name, business, contact, target_id null, message, created_at |
| `verifications` | id, target_id, method, code, verified_at null (used after the hackathon) |
| `usage` | key, day, count — primary key (key, day) |

### API

`POST /api/targets` · `POST /api/scans` · `POST /api/scans/[id]/step` · `POST /api/scans/[id]/finalize` · `POST /api/targets/[id]/fix` · `POST /api/demo-bot/chat` · `POST /api/leads` · `GET /api/reports/[slug]`

## Folder ownership

| Folder | Owner |
|---|---|
| `src/core`, `src/modules`, `src/app/api`, `src/lib`, `supabase/`, `eval/` | Claude Code (tasks run through `acc`) |
| `src/app/(pages)`, `src/components` | Antigravity (outside the ledger; owner reviews and commits) |
| `src/mocks` | Shared (append only) |
| Shared types and the DB schema | **Claude Code only** |

## Security rules

- No secrets in code, logs, commits, prompts or reports. `.env.local` is never committed.
- Owner identity: an unguessable token in an httpOnly cookie, stored hashed.
- zod + size limits on all input (messages ≤ 4000 chars). Rate-limit all public POST routes per IP.
- Any server-side fetch of a user-supplied URL goes through the SSRF guard (resolve DNS; block private, loopback, link-local and metadata ranges including IPv6; re-check every redirect; max 3 redirects; 8 s timeout). Not used until endpoint mode, but built in `src/core/security`.
- Only test what the user owns: demo bot or their own pasted prompt. Endpoint mode requires ownership verification (after the hackathon).
- Store the minimum: truncate and redact responses; never store protected assets or the canary in findings in clear.
- LLM spending cap is set on the provider; free tier in `public` mode is 3 scans per IP per day.

## How every task runs (AI Command Center `acc` contract)

Tasks are contracts in `.ai/tasks/TNNN.md`, created and moved only by `acc`. Task state lives only in `.ai/ledger.jsonl`; never edit `.ai/ledger.jsonl`, `.ai/STATE.md` or `.ai/lock` by hand.

1. Read your contract (`.ai/tasks/TNNN.md`), this file, and every file under "Required Context".
2. **Inspect the real code and schema first.** They win over examples in the contract.
3. Change only paths matched by the contract's `allowed_files`. `acc verify` checks scope against the baseline taken at `acc start`.
4. Make the smallest secure change that meets every Acceptance Criterion. No extra features, refactors or new dependencies unless the contract asks.
5. Run the contract's `test_commands` yourself. Save complete raw output of each command under `.ai/runs/<run_id>/`.
6. Write `.ai/reports/TNNN-<attempt>.md`: summary, a command table (command · exit code · duration · raw log path), each criterion with its evidence, problems/open questions, and finally the `acc-verdicts` block with one line per criterion (`C1: PASS` / `C1: FAIL`). **Never mark PASS without evidence you produced in this run.**
7. No git writes (no commit, branch, stash, push). Read-only git commands use `--no-optional-locks`. The owner commits after `acc verify` returns VERIFIED.
8. Stop. Do not start the next task.

## Never, without explicit approval in chat

Destructive database operations, `git push --force`, deleting files outside your folders, adding paid services, changing scope, folder ownership or this file.

## Disclosures

Every external API and library must be listed in `README.md` under "Disclosures".
