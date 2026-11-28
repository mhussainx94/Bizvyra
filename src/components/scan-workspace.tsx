"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatbotFixContent, Finding, FixLevel, Level, Scan, ScanSize, TargetInput } from "@/lib/types";
import { LIMITS } from "@/lib/types";
import { finalizeFindings, runScan, type ScanProgress } from "@/lib/ui/scan-runner";
import { parseProtectedValues, protectedValuesProblem } from "@/lib/ui/target-form";
import { USE_MOCKS, apiScanClient, createFix, type UiError } from "./api-client";
import type { RunsByLevel } from "./before-after";
import { FixPanel } from "./fix-panel";
import { RunsView } from "./runs-view";
import { ScanProgressView } from "./scan-progress";

type TargetMode = "demo" | "prompt";
type View = "setup" | "scanning" | "results";

interface ScanningState {
  level: Level;
  stage: "planning" | "running" | "scoring";
  progress: ScanProgress | null;
}

interface PendingFinalize {
  level: Level;
  plannedScan: Scan;
  findings: Finding[];
}

const DEMO_NAME = "Zara Fabrics Support";
const DEFAULT_PROMPT_PLACEHOLDER = `You are "Lahore Crafts Assistant", customer support for a leather shop.
Help customers with prices, sizes, and shipping.
Internal only: VIP code CRAFT40 (40% off).`;

const primaryBtn =
  "inline-flex min-h-[44px] items-center justify-center rounded-md bg-[#18233A] px-6 py-3 text-base font-semibold text-[#F4F5F2] transition-colors hover:bg-[#2B3F8C] disabled:cursor-not-allowed disabled:bg-[#18233A]/45 cursor-pointer";
const secondaryBtn =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-[#D9DCD5] bg-[#F4F5F2] px-5 py-3 text-base font-semibold text-[#18233A] transition-colors hover:border-[#2B3F8C] hover:text-[#2B3F8C] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer";

function ErrorBox({ error, children }: { error: UiError; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-[#B3261E] bg-[#B3261E]/10 px-4 py-3 text-base text-[#18233A]">
      <p className="font-semibold text-[#B3261E]">
        <span aria-hidden="true">✕ </span>
        {error.kind === "rate_limited"
          ? "Rate limited"
          : error.kind === "usage_limit"
            ? "Daily limit reached"
            : "Something went wrong"}
      </p>
      <p className="mt-1">{error.message}</p>
      {children && <div className="mt-3 flex flex-wrap gap-3">{children}</div>}
    </div>
  );
}

export function ScanWorkspace() {
  const searchParams = useSearchParams();
  const paramMode = searchParams.get("mode");
  const defaultMode: TargetMode = paramMode === "prompt" ? "prompt" : "demo";
  const [modeOverride, setModeOverride] = useState<{ forParam: string | null; mode: TargetMode } | null>(null);
  const targetMode: TargetMode = modeOverride && modeOverride.forParam === paramMode ? modeOverride.mode : defaultMode;
  const setTargetMode = (mode: TargetMode) => setModeOverride({ forParam: paramMode, mode });

  // Setup form
  const [botName, setBotName] = useState("My shop chatbot");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [assetText, setAssetText] = useState("");
  const [ownsBot, setOwnsBot] = useState(false);
  const [scanSize, setScanSize] = useState<ScanSize>("quick");
  const [formError, setFormError] = useState<string | null>(null);

  // Flow state (kept in the page only; nothing is stored server-side)
  const [view, setView] = useState<View>("setup");
  const [target, setTarget] = useState<TargetInput | null>(null);
  const [targetName, setTargetName] = useState(DEMO_NAME);
  const [size, setSize] = useState<ScanSize>("quick");
  const [runs, setRuns] = useState<RunsByLevel>({});
  const [fixes, setFixes] = useState<Partial<Record<FixLevel, ChatbotFixContent>>>({});
  const [selectedLevel, setSelectedLevel] = useState<Level>(0);
  const [scanning, setScanning] = useState<ScanningState | null>(null);
  const [fixing, setFixing] = useState<FixLevel | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingFinalize, setPendingFinalize] = useState<PendingFinalize | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);

  // Bring the new view into sight when the view changes (not on first load, so the navbar stays visible).
  const shownViewRef = useRef<View>(view);
  useEffect(() => {
    if (shownViewRef.current === view) return;
    shownViewRef.current = view;
    topRef.current?.scrollIntoView({ block: "start" });
  }, [view]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = scanning !== null || fixing !== null || finalizing;
  const assets = parseProtectedValues(assetText);

  function buildTarget(): { target: TargetInput; name: string } | null {
    if (targetMode === "demo") return { target: { mode: "demo" }, name: DEMO_NAME };
    const name = botName.trim();
    const prompt = systemPrompt.trim();
    if (!name) {
      setFormError("Please give your chatbot a name.");
      return null;
    }
    if (prompt.length < 10) {
      setFormError("Please paste your chatbot's instructions (at least 10 characters).");
      return null;
    }
    const problem = protectedValuesProblem(assets);
    if (problem) {
      setFormError(problem);
      return null;
    }
    if (!ownsBot) {
      setFormError("Please confirm that you own this bot or are authorised to test it.");
      return null;
    }
    return { target: { mode: "prompt", name, systemPrompt: prompt, protectedAssets: assets }, name };
  }

  async function runLevel(level: Level, t: TargetInput, scanSizeForRun: ScanSize, fix?: ChatbotFixContent) {
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setNotice(null);
    setPendingFinalize(null);
    setCancelling(false);
    setScanning({ level, stage: "planning", progress: null });
    setView("scanning");

    const outcome = await runScan({
      client: apiScanClient,
      request: {
        target: t,
        level,
        kind: level === 0 ? "baseline" : "retest",
        size: scanSizeForRun,
        ...(fix ? { fix } : {}),
      },
      signal: controller.signal,
      onProgress: (progress) =>
        setScanning({
          level,
          stage: progress.done === progress.total && progress.inFlight.length === 0 ? "scoring" : "running",
          progress,
        }),
    });

    abortRef.current = null;
    setScanning(null);
    setCancelling(false);
    const hasBaseline = level !== 0;

    switch (outcome.status) {
      case "done":
        setRuns((prev) => ({ ...prev, [level]: { scan: outcome.scan, findings: outcome.findings } }));
        setSelectedLevel(level);
        setView("results");
        return;
      case "cancelled":
        setNotice(
          `${level === 0 ? "Inspection" : `Re-test (L${level})`} cancelled after ${outcome.done} of ${outcome.total || "?"} attacks. Nothing was scored.`,
        );
        setView(hasBaseline ? "results" : "setup");
        return;
      case "plan_failed":
        setError(outcome.error);
        setView(hasBaseline ? "results" : "setup");
        return;
      case "finalize_failed":
        setError(outcome.error);
        setPendingFinalize({ level, plannedScan: outcome.plannedScan, findings: outcome.findings });
        setView("results");
        return;
    }
  }

  async function retryFinalize() {
    if (!pendingFinalize || busy) return;
    setFinalizing(true);
    setError(null);
    const res = await finalizeFindings(apiScanClient, pendingFinalize.plannedScan, pendingFinalize.findings);
    setFinalizing(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const { level, findings } = pendingFinalize;
    setRuns((prev) => ({ ...prev, [level]: { scan: res.data.scan, findings } }));
    setSelectedLevel(level);
    setPendingFinalize(null);
  }

  function handleStart() {
    if (busy) return;
    setFormError(null);
    const built = buildTarget();
    if (!built) return;
    setTarget(built.target);
    setTargetName(built.name);
    setSize(scanSize);
    setRuns({});
    setFixes({});
    setSelectedLevel(0);
    void runLevel(0, built.target, scanSize);
  }

  async function handleFix(level: FixLevel) {
    const baseline = runs[0];
    if (!target || !baseline || busy) return;
    setFixing(level);
    setError(null);
    setNotice(null);
    const res = await createFix({ target, findings: baseline.findings, level });
    setFixing(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setFixes((prev) => ({ ...prev, [level]: res.data.fix }));
  }

  function handleRetest(level: FixLevel) {
    const fix = fixes[level];
    if (!target || !fix || busy) return;
    void runLevel(level, target, size, fix);
  }

  function handleCancel() {
    setCancelling(true);
    abortRef.current?.abort();
  }

  function handleNewInspection() {
    abortRef.current?.abort();
    setView("setup");
    setRuns({});
    setFixes({});
    setError(null);
    setNotice(null);
    setPendingFinalize(null);
  }

  /* ------------------------------------------------------------ next step */

  function nextStepPanel() {
    if (!runs[0]) return null;
    let body: ReactNode;
    if (!fixes[1]) {
      body = (
        <>
          <p className="text-base text-[#18233A]">
            Bizvyra can rewrite the bot&apos;s instructions to close these gaps (defence level L1).
          </p>
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void handleFix(1)}>
            {fixing === 1 ? "Writing the fix…" : "Fix my chatbot"}
          </button>
        </>
      );
    } else if (!runs[1]) {
      body = (
        <>
          <FixPanel fix={fixes[1]} level={1} />
          <p className="text-base text-[#18233A]">Run the same attacks against the hardened instructions.</p>
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => handleRetest(1)}>
            Re-test (L1)
          </button>
        </>
      );
    } else if (!fixes[2]) {
      body = (
        <>
          <p className="text-base text-[#18233A]">
            Add an output guard (L2): every reply is checked for protected values and by an AI self-check before the
            customer sees it.
          </p>
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void handleFix(2)}>
            {fixing === 2 ? "Writing the fix…" : "Add output guard (L2)"}
          </button>
        </>
      );
    } else if (!runs[2]) {
      body = (
        <>
          <FixPanel fix={fixes[2]} level={2} />
          <p className="text-base text-[#18233A]">Run the same attacks with the output guard switched on.</p>
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => handleRetest(2)}>
            Re-test (L2)
          </button>
        </>
      );
    } else {
      body = (
        <p className="text-base text-[#18233A]">
          <span aria-hidden="true" className="text-[#1F6B47]">✓ </span>
          All three defence levels are tested. Compare them above, or open each level&apos;s report below.
        </p>
      );
    }
    return (
      <section aria-label="Next step" className="space-y-4 rounded-md border border-[#2B3F8C]/40 bg-[#ECEEE8] p-5 sm:p-6">
        <h2 className="text-[20px] font-semibold text-[#18233A]">Next step</h2>
        {body}
      </section>
    );
  }

  /* ---------------------------------------------------------------- views */

  return (
    <div ref={topRef} className="w-full scroll-mt-4">
      {USE_MOCKS && (
        <p className="mx-auto mb-6 max-w-5xl rounded-md border border-[#8A5A00] bg-[#8A5A00]/10 px-4 py-2 text-sm text-[#18233A]">
          <span aria-hidden="true">! </span>Mock mode: results come from the sample run, not from a live scan.
        </p>
      )}

      {view === "setup" && (
        <section className="mx-auto max-w-[640px]">
          <h1 className="text-[28px] sm:text-[32px] font-semibold leading-tight text-[#18233A]">
            Chatbot safety inspection
          </h1>
          <p className="mt-2 max-w-[70ch] text-base leading-relaxed text-[#4A5568]">
            Choose a chatbot to test and run attacks in English, Urdu and Roman Urdu. Want to see a finished example
            first?{" "}
            <Link href="/report/sample" className="font-medium text-[#2B3F8C] underline underline-offset-4 hover:text-[#18233A]">
              View sample report
            </Link>
          </p>

          {notice && (
            <p role="status" className="mt-6 rounded-md border border-[#D9DCD5] bg-[#ECEEE8] px-4 py-3 text-base text-[#18233A]">
              {notice}
            </p>
          )}
          {error && (
            <div className="mt-6">
              <ErrorBox error={error} />
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleStart();
            }}
            className="mt-8 space-y-8"
          >
            <fieldset className="space-y-3">
              <legend className="text-base font-semibold text-[#18233A]">What are you inspecting?</legend>
              {(
                [
                  {
                    mode: "demo" as const,
                    title: "Demo chatbot",
                    body: "Zara Fabrics Support, a sample shop assistant with discount codes and refund rules.",
                  },
                  {
                    mode: "prompt" as const,
                    title: "Paste your own system prompt",
                    body: "Paste the instructions you give your bot and list the values it must never reveal.",
                  },
                ]
              ).map((opt) => (
                <label
                  key={opt.mode}
                  className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border p-4 ${
                    targetMode === opt.mode ? "border-[#2B3F8C] bg-[#ECEEE8]" : "border-[#D9DCD5] bg-[#F4F5F2]"
                  }`}
                >
                  <input
                    type="radio"
                    name="target-mode"
                    value={opt.mode}
                    checked={targetMode === opt.mode}
                    onChange={() => {
                      setTargetMode(opt.mode);
                      setFormError(null);
                    }}
                    className="mt-1 h-4 w-4 accent-[#2B3F8C]"
                  />
                  <span>
                    <span className="block text-base font-semibold text-[#18233A]">{opt.title}</span>
                    <span className="mt-0.5 block text-sm text-[#4A5568]">{opt.body}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {targetMode === "prompt" && (
              <div className="space-y-6 border-t border-[#D9DCD5] pt-6">
                <div>
                  <label htmlFor="bot-name" className="block text-base font-semibold text-[#18233A]">
                    Chatbot name
                  </label>
                  <input
                    id="bot-name"
                    type="text"
                    value={botName}
                    onChange={(e) => setBotName(e.target.value)}
                    maxLength={LIMITS.nameChars}
                    className="mt-2 min-h-[44px] w-full rounded-md border border-[#D9DCD5] bg-[#ECEEE8] px-3.5 py-2.5 text-base text-[#18233A]"
                  />
                </div>

                <div>
                  <label htmlFor="system-prompt" className="block text-base font-semibold text-[#18233A]">
                    System prompt (your chatbot&apos;s instructions)
                  </label>
                  <textarea
                    id="system-prompt"
                    rows={6}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder={DEFAULT_PROMPT_PLACEHOLDER}
                    maxLength={LIMITS.systemPromptChars}
                    className="mt-2 w-full rounded-md border border-[#D9DCD5] bg-[#ECEEE8] px-3.5 py-2.5 font-mono text-sm text-[#18233A] placeholder:text-[#4A5568]"
                  />
                  <p className="mt-1 text-right text-xs text-[#4A5568]">
                    {systemPrompt.length.toLocaleString("en-US")} / {LIMITS.systemPromptChars.toLocaleString("en-US")}
                  </p>
                </div>

                <div>
                  <label htmlFor="protected-values" className="block text-base font-semibold text-[#18233A]">
                    Protected values it must never reveal
                  </label>
                  <p id="protected-values-help" className="mt-1 text-sm text-[#4A5568]">
                    Separate with commas or put one per line: promo codes, internal phone numbers, private links.
                    Each {LIMITS.targetAssetMinChars}-{LIMITS.targetAssetMaxChars} characters, up to{" "}
                    {LIMITS.protectedAssetsMax}. They are sent only to run this test and are not stored.
                  </p>
                  <textarea
                    id="protected-values"
                    rows={3}
                    value={assetText}
                    aria-describedby="protected-values-help"
                    onChange={(e) => setAssetText(e.target.value)}
                    placeholder={"CRAFT40\nSTAFF-ONLY-25"}
                    className="mt-2 w-full rounded-md border border-[#D9DCD5] bg-[#ECEEE8] px-3.5 py-2.5 font-mono text-sm text-[#18233A] placeholder:text-[#4A5568]"
                  />
                  <p className="mt-1 text-sm text-[#4A5568]" aria-live="polite">
                    {assets.length === 0
                      ? "No protected values listed."
                      : `${assets.length} protected value${assets.length === 1 ? "" : "s"} listed.`}
                  </p>
                </div>

                <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={ownsBot}
                    onChange={(e) => {
                      setOwnsBot(e.target.checked);
                      if (e.target.checked) setFormError(null);
                    }}
                    className="mt-1 h-5 w-5 accent-[#2B3F8C]"
                  />
                  <span className="text-base text-[#18233A]">I own this bot or am authorised to test it</span>
                </label>
              </div>
            )}

            <fieldset className="space-y-3 border-t border-[#D9DCD5] pt-6">
              <legend className="text-base font-semibold text-[#18233A]">Inspection length</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    { value: "quick" as const, label: "Quick inspection (30 attacks)" },
                    { value: "full" as const, label: "Full inspection (60 attacks)" },
                  ]
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border p-4 ${
                      scanSize === opt.value ? "border-[#2B3F8C] bg-[#ECEEE8]" : "border-[#D9DCD5] bg-[#F4F5F2]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scan-size"
                      value={opt.value}
                      checked={scanSize === opt.value}
                      onChange={() => setScanSize(opt.value)}
                      className="h-4 w-4 accent-[#2B3F8C]"
                    />
                    <span className="text-base font-medium text-[#18233A]">{opt.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-sm text-[#4A5568]">
                On a slow or free AI key a quick inspection takes a few minutes. You can cancel at any time.
              </p>
            </fieldset>

            {formError && (
              <div role="alert" className="rounded-md border border-[#B3261E] bg-[#B3261E]/10 px-4 py-3 text-base text-[#B3261E]">
                {formError}
              </div>
            )}

            <button type="submit" disabled={busy || (targetMode === "prompt" && !ownsBot)} className={primaryBtn}>
              Start inspection
            </button>
          </form>
        </section>
      )}

      {view === "scanning" && scanning && (
        <ScanProgressView
          level={scanning.level}
          targetName={targetName}
          progress={scanning.progress}
          stage={scanning.stage}
          cancelling={cancelling}
          onCancel={handleCancel}
        />
      )}

      {view === "results" && (
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-[28px] font-semibold leading-tight text-[#18233A]">Inspection of {targetName}</h1>
            <button type="button" className={secondaryBtn} disabled={busy} onClick={handleNewInspection}>
              New inspection
            </button>
          </div>

          {notice && (
            <p role="status" className="rounded-md border border-[#D9DCD5] bg-[#ECEEE8] px-4 py-3 text-base text-[#18233A]">
              {notice}
            </p>
          )}
          {error && (
            <ErrorBox error={error}>
              {pendingFinalize && (
                <button type="button" className={secondaryBtn} disabled={busy} onClick={() => void retryFinalize()}>
                  {finalizing ? "Scoring…" : "Retry scoring"}
                </button>
              )}
            </ErrorBox>
          )}

          <RunsView
            targetName={targetName}
            runs={runs}
            fixes={fixes}
            selectedLevel={selectedLevel}
            onSelectLevel={setSelectedLevel}
            actions={nextStepPanel()}
          />
        </div>
      )}
    </div>
  );
}
