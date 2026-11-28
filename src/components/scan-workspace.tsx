"use client";

import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import type { Finding, Scan, Step } from "@/lib/types";
import {
  finalizeScan,
  planScan,
  runStep,
  type ScanSize,
  type TargetInput,
} from "./api-client";
import { ReportCard } from "./report-card";
import {
  OutcomeBadge,
  hasUrduScript,
  languageName,
  statusFromFinding,
} from "./ui-badges";

type TargetMode = "demo" | "prompt";
type Phase = "setup" | "running" | "report";

const DEFAULT_PROMPT_PLACEHOLDER = `You are "Lahore Crafts Assistant", customer support for a leather shop.
Help customers with prices, sizes, and shipping.
Internal only: VIP code CRAFT40 (40% off).`;

export function ScanWorkspace() {
  const searchParams = useSearchParams();
  const paramMode = searchParams.get("mode");
  const defaultMode: TargetMode = paramMode === "prompt" ? "prompt" : "demo";

  const [modeOverride, setModeOverride] = useState<{
    forParam: string | null;
    mode: TargetMode;
  } | null>(null);

  const targetMode: TargetMode =
    modeOverride && modeOverride.forParam === paramMode ? modeOverride.mode : defaultMode;

  function setTargetMode(mode: TargetMode) {
    setModeOverride({ forParam: paramMode, mode });
  }

  const [botName, setBotName] = useState("My shop chatbot");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [assetInput, setAssetInput] = useState("");
  const [protectedAssets, setProtectedAssets] = useState<string[]>([
    "VIP40",
    "STAFF60",
  ]);
  const [ownsBot, setOwnsBot] = useState(false);
  const [scanSize, setScanSize] = useState<ScanSize>("quick");

  const [phase, setPhase] = useState<Phase>("setup");
  const [formError, setFormError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [totalSteps, setTotalSteps] = useState(30);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [finalScan, setFinalScan] = useState<Scan | null>(null);
  const [activeTargetName, setActiveTargetName] = useState("Zara Fabrics Support");

  const abortRef = useRef(false);

  function addProtectedAsset() {
    const trimmed = assetInput.trim();
    if (!trimmed) return;
    if (trimmed.length < 2 || trimmed.length > 100) {
      setFormError("Each secret must be between 2 and 100 characters.");
      return;
    }
    if (protectedAssets.length >= 20) {
      setFormError("You can list up to 20 secrets.");
      return;
    }
    if (!protectedAssets.includes(trimmed)) {
      setProtectedAssets((prev) => [...prev, trimmed]);
    }
    setAssetInput("");
    setFormError(null);
  }

  function removeProtectedAsset(value: string) {
    setProtectedAssets((prev) => prev.filter((item) => item !== value));
  }

  async function handleStartScan() {
    setFormError(null);
    setScanError(null);

    let target: TargetInput;
    let displayName = "Zara Fabrics Support";

    if (targetMode === "demo") {
      target = { mode: "demo" };
    } else {
      if (systemPrompt.trim().length < 10) {
        setFormError("Please paste your chatbot's instructions (at least 10 characters).");
        return;
      }
      if (!ownsBot) {
        setFormError("Please confirm that you own this bot or are authorised to test it.");
        return;
      }
      displayName = botName.trim() || "My shop chatbot";
      target = {
        mode: "prompt",
        name: displayName,
        systemPrompt: systemPrompt.trim(),
        protectedAssets,
      };
    }

    abortRef.current = false;
    setActiveTargetName(displayName);
    setFindings([]);
    setFinalScan(null);
    setTotalSteps(scanSize === "quick" ? 30 : 60);
    setPhase("running");

    try {
      const plan = await planScan({
        target,
        level: 0,
        kind: "baseline",
        size: scanSize,
      });

      if (abortRef.current) return;

      const steps: Step[] = plan.steps;
      const batchSize = Math.max(1, plan.concurrency || 3);
      setTotalSteps(steps.length);

      const collected: Finding[] = [];

      for (let i = 0; i < steps.length; i += batchSize) {
        if (abortRef.current) return;
        const batch = steps.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map((step) =>
            runStep({
              scanId: plan.scan.id,
              level: 0,
              step: { checkId: step.checkId },
              target,
            })
          )
        );
        if (abortRef.current) return;

        const newFindings = batchResults.map((r) => r.finding);
        collected.push(...newFindings);
        setFindings((prev) => [...prev, ...newFindings]);
      }

      const finalized = await finalizeScan({
        scan: {
          id: plan.scan.id,
          level: plan.scan.level,
          kind: plan.scan.kind,
          createdAt: plan.scan.createdAt,
        },
        findings: collected,
      });

      if (abortRef.current) return;
      setFinalScan(finalized.scan);
      setPhase("report");
    } catch (err) {
      if (abortRef.current) return;
      setScanError(err instanceof Error ? err.message : "Inspection failed unexpectedly.");
    }
  }

  function handleCancelOrReset() {
    abortRef.current = true;
    setPhase("setup");
    setScanError(null);
  }

  return (
    <div className="w-full">
      {/* Phase 1: Setup (one column, max 640px) */}
      {phase === "setup" && (
        <section className="mx-auto max-w-[640px]">
          <h1 className="text-[28px] sm:text-[32px] font-semibold leading-tight text-[#18233A]">
            Chatbot safety inspection
          </h1>
          <p className="mt-2 max-w-[70ch] text-base leading-relaxed text-[#4A5568]">
            Choose a chatbot to test and run bilingual attacks across English, Urdu and Roman Urdu.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleStartScan();
            }}
            className="mt-8 space-y-8"
          >
            {/* What are you inspecting? */}
            <fieldset className="space-y-3">
              <legend className="text-base font-semibold text-[#18233A]">
                What are you inspecting?
              </legend>

              <label
                className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border p-4 ${
                  targetMode === "demo"
                    ? "border-[#2B3F8C] bg-[#ECEEE8]"
                    : "border-[#D9DCD5] bg-[#F4F5F2]"
                }`}
              >
                <input
                  type="radio"
                  name="target-mode"
                  value="demo"
                  checked={targetMode === "demo"}
                  onChange={() => {
                    setTargetMode("demo");
                    setFormError(null);
                  }}
                  className="mt-1 h-4 w-4 accent-[#2B3F8C]"
                />
                <div>
                  <span className="block text-base font-semibold text-[#18233A]">
                    Demo chatbot
                  </span>
                  <span className="mt-0.5 block text-sm text-[#4A5568]">
                    Zara Fabrics Support, a sample shop assistant with discount codes and refund rules.
                  </span>
                </div>
              </label>

              <label
                className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border p-4 ${
                  targetMode === "prompt"
                    ? "border-[#2B3F8C] bg-[#ECEEE8]"
                    : "border-[#D9DCD5] bg-[#F4F5F2]"
                }`}
              >
                <input
                  type="radio"
                  name="target-mode"
                  value="prompt"
                  checked={targetMode === "prompt"}
                  onChange={() => {
                    setTargetMode("prompt");
                    setFormError(null);
                  }}
                  className="mt-1 h-4 w-4 accent-[#2B3F8C]"
                />
                <div>
                  <span className="block text-base font-semibold text-[#18233A]">
                    My own chatbot&apos;s instructions
                  </span>
                  <span className="mt-0.5 block text-sm text-[#4A5568]">
                    Paste the system instructions you give your bot and list the secrets it must keep.
                  </span>
                </div>
              </label>
            </fieldset>

            {/* Custom bot fields */}
            {targetMode === "prompt" && (
              <div className="space-y-6 border-t border-[#D9DCD5] pt-6">
                <div>
                  <label
                    htmlFor="bot-name"
                    className="block text-base font-semibold text-[#18233A]"
                  >
                    Chatbot name
                  </label>
                  <input
                    id="bot-name"
                    type="text"
                    value={botName}
                    onChange={(e) => setBotName(e.target.value)}
                    maxLength={80}
                    className="mt-2 min-h-[44px] w-full rounded-md border border-[#D9DCD5] bg-[#ECEEE8] px-3.5 py-2.5 text-base text-[#18233A]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="system-prompt"
                    className="block text-base font-semibold text-[#18233A]"
                  >
                    Chatbot instructions
                  </label>
                  <textarea
                    id="system-prompt"
                    rows={5}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder={DEFAULT_PROMPT_PLACEHOLDER}
                    maxLength={8000}
                    className="mt-2 w-full rounded-md border border-[#D9DCD5] bg-[#ECEEE8] px-3.5 py-2.5 text-base text-[#18233A] placeholder:text-[#4A5568]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="secret-input"
                    className="block text-base font-semibold text-[#18233A]"
                  >
                    Secrets it must never reveal
                  </label>
                  <p className="mt-1 text-sm text-[#4A5568]">
                    Add promo codes, internal phone numbers, or private links.
                  </p>

                  <div className="mt-2 flex gap-2">
                    <input
                      id="secret-input"
                      type="text"
                      value={assetInput}
                      onChange={(e) => setAssetInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addProtectedAsset();
                        }
                      }}
                      placeholder="e.g. EID50"
                      className="min-h-[44px] flex-1 rounded-md border border-[#D9DCD5] bg-[#ECEEE8] px-3.5 py-2 text-base text-[#18233A] placeholder:text-[#4A5568]"
                    />
                    <button
                      type="button"
                      onClick={addProtectedAsset}
                      className="min-h-[44px] rounded-md border border-[#D9DCD5] bg-[#ECEEE8] px-4 py-2 text-sm font-semibold text-[#18233A] hover:border-[#2B3F8C] hover:text-[#2B3F8C] cursor-pointer"
                    >
                      Add
                    </button>
                  </div>

                  {protectedAssets.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {protectedAssets.map((val) => (
                        <li
                          key={val}
                          className="inline-flex items-center gap-2 rounded-md border border-[#D9DCD5] bg-[#ECEEE8] px-3 py-1.5 text-sm text-[#18233A]"
                        >
                          <span>{val}</span>
                          <button
                            type="button"
                            onClick={() => removeProtectedAsset(val)}
                            aria-label={`Remove ${val}`}
                            className="inline-flex h-6 w-6 items-center justify-center text-[#4A5568] hover:text-[#B3261E] cursor-pointer"
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
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
                  <span className="text-base text-[#18233A]">
                    I own this bot or am authorised to test it
                  </span>
                </label>
              </div>
            )}

            {/* Quick vs Full */}
            <fieldset className="space-y-3 border-t border-[#D9DCD5] pt-6">
              <legend className="text-base font-semibold text-[#18233A]">
                Inspection length
              </legend>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label
                  className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border p-4 ${
                    scanSize === "quick"
                      ? "border-[#2B3F8C] bg-[#ECEEE8]"
                      : "border-[#D9DCD5] bg-[#F4F5F2]"
                  }`}
                >
                  <input
                    type="radio"
                    name="scan-size"
                    value="quick"
                    checked={scanSize === "quick"}
                    onChange={() => setScanSize("quick")}
                    className="h-4 w-4 accent-[#2B3F8C]"
                  />
                  <span className="text-base font-medium text-[#18233A]">
                    Quick inspection (30 attacks)
                  </span>
                </label>

                <label
                  className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border p-4 ${
                    scanSize === "full"
                      ? "border-[#2B3F8C] bg-[#ECEEE8]"
                      : "border-[#D9DCD5] bg-[#F4F5F2]"
                  }`}
                >
                  <input
                    type="radio"
                    name="scan-size"
                    value="full"
                    checked={scanSize === "full"}
                    onChange={() => setScanSize("full")}
                    className="h-4 w-4 accent-[#2B3F8C]"
                  />
                  <span className="text-base font-medium text-[#18233A]">
                    Full inspection (60 attacks)
                  </span>
                </label>
              </div>
            </fieldset>

            {formError && (
              <div
                role="alert"
                className="rounded-md border border-[#B3261E] bg-[#B3261E]/10 px-4 py-3 text-base text-[#B3261E]"
              >
                {formError}
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={targetMode === "prompt" && !ownsBot}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[#18233A] px-6 py-3 text-base font-semibold text-[#F4F5F2] transition-colors hover:bg-[#2B3F8C] disabled:bg-[#18233A]/45 disabled:cursor-not-allowed cursor-pointer"
              >
                Start inspection
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Phase 2: Live scan test-log table */}
      {phase === "running" && (
        <section aria-label="Inspection log" className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#D9DCD5] pb-4">
            <div>
              <h1
                aria-live="polite"
                className="text-[28px] font-semibold text-[#18233A]"
              >
                Inspecting… {findings.length} of {totalSteps} attacks
              </h1>
              <p className="mt-1 text-base text-[#4A5568]">
                Target: {activeTargetName}
              </p>
            </div>

            <button
              type="button"
              onClick={handleCancelOrReset}
              className="min-h-[44px] rounded-md border border-[#D9DCD5] bg-[#ECEEE8] px-4 py-2 text-sm font-semibold text-[#18233A] hover:border-[#B3261E] hover:text-[#B3261E] cursor-pointer"
            >
              Cancel
            </button>
          </div>

          {scanError && (
            <div
              role="alert"
              className="mt-4 rounded-md border border-[#B3261E] bg-[#B3261E]/10 px-4 py-3 text-base text-[#B3261E]"
            >
              {scanError}
            </div>
          )}

          <div className="mt-6 overflow-x-auto rounded-md border border-[#D9DCD5]">
            <table className="w-full table-fixed border-collapse text-left text-sm sm:text-base">
              <thead className="border-b border-[#D9DCD5] bg-[#ECEEE8]">
                <tr>
                  <th scope="col" className="w-24 sm:w-32 px-3 sm:px-4 py-3 font-semibold text-[#18233A]">
                    Language
                  </th>
                  <th scope="col" className="px-3 sm:px-4 py-3 font-semibold text-[#18233A]">
                    What the attacker tried
                  </th>
                  <th scope="col" className="w-28 sm:w-32 px-3 sm:px-4 py-3 font-semibold text-[#18233A]">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D9DCD5] bg-[#F4F5F2]">
                {findings.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-base text-[#4A5568]">
                      Running first batch of attacks...
                    </td>
                  </tr>
                )}
                {findings.map((finding) => {
                  const isUrduText =
                    finding.lang === "ur" ||
                    (finding.prompt ? hasUrduScript(finding.prompt) : false);
                  return (
                    <tr key={finding.id}>
                      <td
                        lang={finding.lang === "ur" ? "ur" : undefined}
                        dir={finding.lang === "ur" ? "rtl" : undefined}
                        className={`whitespace-nowrap px-3 sm:px-4 py-3 text-sm font-medium text-[#18233A] ${
                          finding.lang === "ur" ? "font-urdu" : ""
                        }`}
                      >
                        {languageName(finding.lang, "en")}
                      </td>
                      <td className="min-w-0 px-3 sm:px-4 py-3">
                        <span
                          lang={isUrduText ? "ur" : undefined}
                          dir={isUrduText ? "rtl" : undefined}
                          className={`block truncate text-sm text-[#18233A] ${
                            isUrduText ? "font-urdu" : "font-mono"
                          }`}
                        >
                          {finding.prompt ?? finding.title_en}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 sm:px-4 py-3">
                        <OutcomeBadge outcome={statusFromFinding(finding.status)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Phase 3: Report sheet */}
      {phase === "report" && finalScan && (
        <div className="mx-auto max-w-4xl">
          <ReportCard
            scan={finalScan}
            findings={findings}
            targetName={activeTargetName}
            onRescan={handleCancelOrReset}
          />
        </div>
      )}
    </div>
  );
}
