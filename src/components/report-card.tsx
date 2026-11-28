"use client";

import { useState } from "react";
import type { Finding, Intent, Lang, Scan } from "@/lib/types";
import { InspectionStamp } from "./inspection-stamp";
import {
  INTENT_LABELS,
  JUDGED_BY_LABELS,
  OutcomeBadge,
  hasUrduScript,
  languageName,
  type InspectionOutcome,
} from "./ui-badges";

interface ReportCardProps {
  scan: Scan;
  findings: Finding[];
  targetName: string;
  onRescan?: () => void;
}

interface GroupedIntent {
  intent: Intent;
  outcome: InspectionOutcome;
  titleEn: string;
  titleUr: string;
  impactEn: string;
  impactUr: string;
  leakedLangs: Lang[];
  representative: Finding;
  breachCount: number;
  maxSeverity: number;
}

const LANGS_IN_ORDER: readonly Lang[] = ["en", "ur", "roman_ur"];

const COPY = {
  en: {
    headingPrefix: "Inspection report",
    targetLabel: "Chatbot inspected:",
    langSectionTitle: "Attacks that worked, by language",
    findingsSectionTitle: "What went wrong",
    workedInPrefix: "Worked in:",
    heldAllLangs: "Held across all tested languages",
    notEvaluated: "Could not be evaluated",
    detailsBtn: "Details",
    attackTried: "What the attacker tried",
    botReplied: "Redacted chatbot reply",
    impactLabel: "Business impact",
    standardLabel: "Standard",
    provenByLabel: "Proven by",
    fixBtn: "Fix my chatbot",
    fixHelper: "Available in the next build",
    rescanBtn: "Re-run inspection",
  },
  ur: {
    headingPrefix: "معائنہ رپورٹ",
    targetLabel: "معائنہ شدہ چیٹ بوٹ:",
    langSectionTitle: "زبان کے لحاظ سے کامیاب حملے",
    findingsSectionTitle: "کیا خرابی سامنے آئی",
    workedInPrefix: "ان زبانوں میں ناکام ہوا:",
    heldAllLangs: "تمام جانچی گئی زبانوں میں محفوظ رہا",
    notEvaluated: "جانچ مکمل نہیں ہو سکی",
    detailsBtn: "تفصیلات",
    attackTried: "حملہ آور کا پیغام",
    botReplied: "چیٹ بوٹ کا جواب (محفوظ قدریں حذف شدہ)",
    impactLabel: "کاروباری نقصان",
    standardLabel: "معیار",
    provenByLabel: "ثبوت کا طریقہ",
    fixBtn: "میرا چیٹ بوٹ درست کریں",
    fixHelper: "اگلی بلڈ میں دستیاب ہوگا",
    rescanBtn: "دوبارہ معائنہ کریں",
  },
} as const;

function buildVerdictSentence(scan: Scan, uiLang: "en" | "ur"): string {
  const summary = scan.summary;
  if (!summary) {
    return uiLang === "ur"
      ? "معائنہ کا نتیجہ دستیاب نہیں ہے۔"
      : "Inspection results could not be summarised.";
  }

  const decided = summary.breaches + summary.passes;
  let worstLang: Lang | null = null;
  let worstRate = 0;
  let worstAllWorked = false;

  for (const lang of LANGS_IN_ORDER) {
    const bucket = summary.byLang?.[lang];
    if (!bucket) continue;
    const langDecided = bucket.breaches + bucket.passes;
    if (langDecided === 0) continue;
    const rate = bucket.breaches / langDecided;
    if (rate > worstRate) {
      worstRate = rate;
      worstLang = lang;
      worstAllWorked = bucket.breaches === langDecided;
    }
  }

  if (uiLang === "ur") {
    const lead =
      scan.grade === "A" || scan.grade === "B"
        ? "یہ چیٹ بوٹ کافی حد تک محفوظ رہا۔"
        : scan.grade === "C" || scan.grade === "D"
          ? "یہ چیٹ بوٹ بعض صورتوں میں راز فاش کر دیتا ہے۔"
          : "یہ چیٹ بوٹ خفیہ معلومات لیک کر دیتا ہے۔";
    const countLine = `${decided} میں سے ${summary.breaches} حملے کامیاب رہے۔`;
    if (worstLang && worstRate > 0) {
      const langTxt = languageName(worstLang, "ur");
      return worstAllWorked
        ? `${lead} ${countLine} ${langTxt} میں ہر حملہ کامیاب رہا۔`
        : `${lead} ${countLine} سب سے زیادہ کمزوری ${langTxt} میں دیکھی گئی۔`;
    }
    return `${lead} ${countLine}`;
  }

  const lead =
    scan.grade === "A" || scan.grade === "B"
      ? "This chatbot held up well."
      : scan.grade === "C" || scan.grade === "D"
        ? "This chatbot has gaps under pressure."
        : "This chatbot leaks secrets.";

  const countLine = `${summary.breaches} of ${decided} attacks worked.`;

  if (worstLang && worstRate > 0) {
    const langTxt = languageName(worstLang, "en");
    if (worstAllWorked) {
      return `${lead} ${countLine} ${langTxt} got through every time.`;
    }
    return `${lead} ${countLine} ${langTxt} was the weakest spot.`;
  }

  return `${lead} ${countLine}`;
}

function groupFindingsByIntent(findings: Finding[]): GroupedIntent[] {
  const byIntent = new Map<Intent, Finding[]>();

  for (const f of findings) {
    const intent: Intent = f.intent ?? "ignore_instructions";
    const list = byIntent.get(intent) ?? [];
    list.push(f);
    byIntent.set(intent, list);
  }

  const groups: GroupedIntent[] = [];
  for (const [intent, items] of byIntent.entries()) {
    const breaches = items.filter((f) => f.status === "breach");
    const passes = items.filter((f) => f.status === "pass");

    let outcome: InspectionOutcome = "not_run";
    if (breaches.length > 0 && passes.length === 0) {
      outcome = "leaked";
    } else if (breaches.length > 0 && passes.length > 0) {
      outcome = "partial";
    } else if (passes.length > 0) {
      outcome = "held";
    }

    const leakedLangs: Lang[] = [];
    for (const lang of LANGS_IN_ORDER) {
      if (breaches.some((b) => b.lang === lang)) {
        leakedLangs.push(lang);
      }
    }

    // Prefer a breached finding as the representative example when available
    const representative =
      breaches.find((b) => b.lang === "roman_ur") ??
      breaches[0] ??
      passes[0] ??
      items[0];

    groups.push({
      intent,
      outcome,
      titleEn: representative.title_en,
      titleUr: representative.title_ur,
      impactEn: representative.businessImpact_en,
      impactUr: representative.businessImpact_ur,
      leakedLangs,
      representative,
      breachCount: breaches.length,
      maxSeverity: Math.max(...items.map((i) => i.severity)),
    });
  }

  const rank: Record<InspectionOutcome, number> = {
    leaked: 0,
    partial: 1,
    not_run: 2,
    held: 3,
  };

  return groups.sort((a, b) => {
    if (rank[a.outcome] !== rank[b.outcome]) return rank[a.outcome] - rank[b.outcome];
    if (b.breachCount !== a.breachCount) return b.breachCount - a.breachCount;
    return b.maxSeverity - a.maxSeverity;
  });
}

export function ReportCard({ scan, findings, targetName, onRescan }: ReportCardProps) {
  const [uiLang, setUiLang] = useState<"en" | "ur">("en");
  const isUrdu = uiLang === "ur";
  const t = COPY[uiLang];

  const grouped = groupFindingsByIntent(findings);
  const verdict = buildVerdictSentence(scan, uiLang);
  const summary = scan.summary;
  const formattedDate = new Date(scan.finishedAt ?? scan.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <article
      aria-label="Inspection report"
      className="report-sheet rounded-md p-6 sm:p-10"
    >
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#D9DCD5] pb-6">
        <div lang={isUrdu ? "ur" : undefined} dir={isUrdu ? "rtl" : undefined} className={isUrdu ? "font-urdu" : ""}>
          <h1 className="text-[28px] font-semibold leading-tight text-[#18233A]">
            {t.headingPrefix}
          </h1>
          <p className="mt-1 text-base text-[#4A5568]">
            {t.targetLabel} <span className="font-semibold text-[#18233A]">{targetName}</span>
          </p>
        </div>

        <div
          role="group"
          aria-label="Report language"
          className="inline-flex rounded-md border border-[#D9DCD5] bg-[#F4F5F2] p-1"
        >
          <button
            type="button"
            onClick={() => setUiLang("en")}
            className={`min-h-[44px] rounded px-4 text-sm font-semibold transition-colors cursor-pointer ${
              uiLang === "en"
                ? "bg-[#18233A] text-[#F4F5F2]"
                : "text-[#18233A] hover:text-[#2B3F8C]"
            }`}
          >
            English
          </button>
          <button
            type="button"
            lang="ur"
            dir="rtl"
            onClick={() => setUiLang("ur")}
            className={`font-urdu min-h-[44px] rounded px-4 text-base font-semibold transition-colors cursor-pointer ${
              uiLang === "ur"
                ? "bg-[#18233A] text-[#F4F5F2]"
                : "text-[#18233A] hover:text-[#2B3F8C]"
            }`}
          >
            اردو
          </button>
        </div>
      </header>

      {/* Stamp + Verdict */}
      <section className="flex flex-col items-start gap-6 border-b border-[#D9DCD5] py-8 sm:flex-row sm:items-center sm:gap-10">
        <InspectionStamp grade={scan.grade} dateLabel={formattedDate} size="lg" animate />

        <div lang={isUrdu ? "ur" : undefined} dir={isUrdu ? "rtl" : undefined} className={`max-w-[70ch] ${isUrdu ? "font-urdu" : ""}`}>
          <p className="text-[20px] font-semibold leading-snug text-[#18233A]">
            {verdict}
          </p>
          {scan.score !== null && (
            <p className="mt-2 text-base text-[#4A5568]">
              {isUrdu ? `سکور: 100 میں سے ${scan.score}` : `Score: ${scan.score} out of 100`}
            </p>
          )}
        </div>
      </section>

      {/* Attacks that worked, by language */}
      <section className="border-b border-[#D9DCD5] py-8">
        <h2
          lang={isUrdu ? "ur" : undefined}
          dir={isUrdu ? "rtl" : undefined}
          className={`text-[20px] font-semibold text-[#18233A] ${isUrdu ? "font-urdu" : ""}`}
        >
          {t.langSectionTitle}
        </h2>

        <div className="mt-5 max-w-xl space-y-4">
          {LANGS_IN_ORDER.map((lang) => {
            const bucket = summary?.byLang?.[lang];
            const breaches = bucket?.breaches ?? 0;
            const decided = (bucket?.breaches ?? 0) + (bucket?.passes ?? 0);
            const pct = decided > 0 ? Math.round((breaches / decided) * 100) : 0;
            const barColor =
              pct >= 60 ? "bg-[#B3261E]" : pct > 0 ? "bg-[#8A5A00]" : "bg-[#1F6B47]";

            return (
              <div key={lang} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-4 text-base">
                  <span
                    lang={lang === "ur" || isUrdu ? "ur" : undefined}
                    dir={lang === "ur" || isUrdu ? "rtl" : undefined}
                    className={`font-medium text-[#18233A] ${
                      lang === "ur" || isUrdu ? "font-urdu" : ""
                    }`}
                  >
                    {languageName(lang, uiLang)}
                  </span>
                  <span
                    lang={isUrdu ? "ur" : undefined}
                    dir={isUrdu ? "rtl" : undefined}
                    className={`text-sm font-semibold text-[#4A5568] ${
                      isUrdu ? "font-urdu" : ""
                    }`}
                  >
                    {isUrdu ? `${decided} میں سے ${breaches}` : `${breaches} of ${decided}`}
                  </span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-sm bg-[#F4F5F2] border border-[#D9DCD5]">
                  <div
                    className={`h-full ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* What went wrong (grouped by intent) */}
      <section className="py-8">
        <h2
          lang={isUrdu ? "ur" : undefined}
          dir={isUrdu ? "rtl" : undefined}
          className={`text-[20px] font-semibold text-[#18233A] ${isUrdu ? "font-urdu" : ""}`}
        >
          {t.findingsSectionTitle}
        </h2>

        <div className="mt-4 divide-y divide-[#D9DCD5] border-t border-b border-[#D9DCD5]">
          {grouped.map((group) => {
            const rep = group.representative;
            const repUrdu = rep.prompt ? hasUrduScript(rep.prompt) : false;
            const workedInText =
              group.leakedLangs.length > 0
                ? `${t.workedInPrefix} ${group.leakedLangs
                    .map((l) => languageName(l, uiLang))
                    .join(isUrdu ? "، " : ", ")}`
                : group.outcome === "held"
                  ? t.heldAllLangs
                  : t.notEvaluated;

            return (
              <div key={group.intent} className="py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <OutcomeBadge outcome={group.outcome} uiLang={uiLang} />
                      <span
                        lang={isUrdu ? "ur" : undefined}
                        dir={isUrdu ? "rtl" : undefined}
                        className={`text-sm text-[#4A5568] ${isUrdu ? "font-urdu" : ""}`}
                      >
                        {INTENT_LABELS[group.intent][uiLang]}
                      </span>
                    </div>

                    <h3
                      lang={isUrdu ? "ur" : undefined}
                      dir={isUrdu ? "rtl" : undefined}
                      className={`mt-1.5 text-base sm:text-[18px] font-semibold text-[#18233A] ${
                        isUrdu ? "font-urdu" : ""
                      }`}
                    >
                      {isUrdu ? group.titleUr : group.titleEn}
                    </h3>

                    <p
                      lang={isUrdu ? "ur" : undefined}
                      dir={isUrdu ? "rtl" : undefined}
                      className={`mt-1 text-sm text-[#4A5568] ${isUrdu ? "font-urdu" : ""}`}
                    >
                      {workedInText}
                    </p>
                  </div>
                </div>

                <details className="mt-3">
                  <summary
                    lang={isUrdu ? "ur" : undefined}
                    dir={isUrdu ? "rtl" : undefined}
                    className={`inline-flex min-h-[44px] items-center text-sm font-semibold text-[#2B3F8C] underline underline-offset-4 cursor-pointer select-none ${
                      isUrdu ? "font-urdu" : ""
                    }`}
                  >
                    {t.detailsBtn}
                  </summary>

                  <div className="mt-2 space-y-4 rounded-md border border-[#D9DCD5] bg-[#F4F5F2] p-4 sm:p-5">
                    {rep.prompt && (
                      <div>
                        <p
                          lang={isUrdu ? "ur" : undefined}
                          dir={isUrdu ? "rtl" : undefined}
                          className={`text-sm font-semibold text-[#18233A] ${
                            isUrdu ? "font-urdu" : ""
                          }`}
                        >
                          {t.attackTried} ({languageName(rep.lang, uiLang)})
                        </p>
                        <p
                          lang={repUrdu ? "ur" : undefined}
                          dir={repUrdu ? "rtl" : undefined}
                          className={`mt-1 text-sm text-[#18233A] ${
                            repUrdu ? "font-urdu" : "font-mono"
                          }`}
                        >
                          {rep.prompt}
                        </p>
                      </div>
                    )}

                    {rep.response && (
                      <div>
                        <p
                          lang={isUrdu ? "ur" : undefined}
                          dir={isUrdu ? "rtl" : undefined}
                          className={`text-sm font-semibold text-[#18233A] ${
                            isUrdu ? "font-urdu" : ""
                          }`}
                        >
                          {t.botReplied}
                        </p>
                        <p
                          lang={hasUrduScript(rep.response) ? "ur" : undefined}
                          dir={hasUrduScript(rep.response) ? "rtl" : undefined}
                          className={`mt-1 text-sm text-[#18233A] ${
                            hasUrduScript(rep.response) ? "font-urdu" : "font-mono"
                          }`}
                        >
                          {rep.response}
                        </p>
                      </div>
                    )}

                    <div>
                      <p
                        lang={isUrdu ? "ur" : undefined}
                        dir={isUrdu ? "rtl" : undefined}
                        className={`text-sm font-semibold text-[#18233A] ${
                          isUrdu ? "font-urdu" : ""
                        }`}
                      >
                        {t.impactLabel}
                      </p>
                      <p
                        lang={isUrdu ? "ur" : undefined}
                        dir={isUrdu ? "rtl" : undefined}
                        className={`mt-1 max-w-[70ch] text-sm leading-relaxed text-[#4A5568] ${
                          isUrdu ? "font-urdu" : ""
                        }`}
                      >
                        {isUrdu ? group.impactUr : group.impactEn}
                      </p>
                    </div>

                    <div
                      lang={isUrdu ? "ur" : undefined}
                      dir={isUrdu ? "rtl" : undefined}
                      className={`flex flex-wrap gap-x-6 gap-y-2 border-t border-[#D9DCD5] pt-3 text-sm text-[#4A5568] ${
                        isUrdu ? "font-urdu" : ""
                      }`}
                    >
                      <span>
                        <strong className="text-[#18233A]">{t.standardLabel}:</strong>{" "}
                        {rep.standard}
                      </span>
                      <span>
                        <strong className="text-[#18233A]">{t.provenByLabel}:</strong>{" "}
                        {JUDGED_BY_LABELS[rep.judgedBy][uiLang]}
                      </span>
                    </div>
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      </section>

      {/* Actions */}
      <footer className="flex flex-wrap items-start justify-between gap-4 border-t border-[#D9DCD5] pt-6">
        <div>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[#18233A]/50 px-6 py-3 text-base font-semibold text-[#F4F5F2] cursor-not-allowed"
          >
            <span lang={isUrdu ? "ur" : undefined} className={isUrdu ? "font-urdu" : ""}>
              {t.fixBtn}
            </span>
          </button>
          <p
            lang={isUrdu ? "ur" : undefined}
            dir={isUrdu ? "rtl" : undefined}
            className={`mt-2 text-sm text-[#4A5568] ${isUrdu ? "font-urdu" : ""}`}
          >
            {t.fixHelper}
          </p>
        </div>

        {onRescan && (
          <button
            type="button"
            onClick={onRescan}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-[#D9DCD5] bg-[#F4F5F2] px-5 py-3 text-base font-semibold text-[#18233A] transition-colors hover:border-[#2B3F8C] hover:text-[#2B3F8C] cursor-pointer"
          >
            <span lang={isUrdu ? "ur" : undefined} className={isUrdu ? "font-urdu" : ""}>
              {t.rescanBtn}
            </span>
          </button>
        )}
      </footer>
    </article>
  );
}
