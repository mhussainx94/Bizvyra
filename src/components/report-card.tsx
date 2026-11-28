"use client";

import { useState, type ReactNode } from "react";
import { INTENTS, type Finding, type Intent, type Lang, type Scan, type ScanBucket } from "@/lib/types";
import { formatPercent, isIncomplete, weightedAsr } from "@/lib/ui/report";
import { InspectionStamp } from "./inspection-stamp";
import {
  INTENT_LABELS,
  JUDGED_BY_LABELS,
  LEVEL_LABELS,
  OutcomeBadge,
  hasUrduScript,
  languageName,
  statusFromFinding,
  type InspectionOutcome,
} from "./ui-badges";

interface ReportCardProps {
  scan: Scan;
  findings: Finding[];
  targetName: string;
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
    gradeLabel: "Grade",
    scoreLabel: "Score",
    asrLabel: "Weighted attack success",
    asrHelp: "Share of attacks that worked, weighted by severity",
    countsLabel: "Results",
    errorsNote: "Errors and skipped tests are not counted as passes.",
    langSectionTitle: "Attacks that worked, by language",
    intentSectionTitle: "Results by risk",
    findingsSectionTitle: "What went wrong",
    allResultsTitle: "Every test result",
    workedInPrefix: "Worked in:",
    heldAllLangs: "Held across all tested languages",
    notEvaluated: "Could not be evaluated",
    detailsBtn: "Details",
    attackTried: "What the attacker tried",
    botReplied: "Redacted chatbot reply",
    evidenceLabel: "Evidence",
    impactLabel: "Business impact",
    standardLabel: "Standard",
    provenByLabel: "Proven by",
    risk: "Risk",
    breaches: "Breaches",
    passes: "Passes",
    errors: "Errors",
    asr: "Success rate",
    incompleteTitle: "Results incomplete",
    incompleteBody: (errors: number, total: number) =>
      `${errors} of ${total} tests could not run, so this grade is not reliable. Please try again in a minute.`,
    causeLabel: "Most common cause:",
  },
  ur: {
    headingPrefix: "معائنہ رپورٹ",
    targetLabel: "معائنہ شدہ چیٹ بوٹ:",
    gradeLabel: "گریڈ",
    scoreLabel: "سکور",
    asrLabel: "حملوں کی کامیابی (شدت کے لحاظ سے)",
    asrHelp: "کامیاب حملوں کا تناسب، شدت کے وزن کے ساتھ",
    countsLabel: "نتائج",
    errorsNote: "خرابی یا چھوڑے گئے ٹیسٹ کامیاب شمار نہیں ہوتے۔",
    langSectionTitle: "زبان کے لحاظ سے کامیاب حملے",
    intentSectionTitle: "خطرے کے لحاظ سے نتائج",
    findingsSectionTitle: "کیا خرابی سامنے آئی",
    allResultsTitle: "ہر ٹیسٹ کا نتیجہ",
    workedInPrefix: "ان زبانوں میں ناکام ہوا:",
    heldAllLangs: "تمام جانچی گئی زبانوں میں محفوظ رہا",
    notEvaluated: "جانچ مکمل نہیں ہو سکی",
    detailsBtn: "تفصیلات",
    attackTried: "حملہ آور کا پیغام",
    botReplied: "چیٹ بوٹ کا جواب (محفوظ قدریں حذف شدہ)",
    evidenceLabel: "ثبوت",
    impactLabel: "کاروباری نقصان",
    standardLabel: "معیار",
    provenByLabel: "ثبوت کا طریقہ",
    risk: "خطرہ",
    breaches: "لیک",
    passes: "محفوظ",
    errors: "خرابی",
    asr: "کامیابی کی شرح",
    incompleteTitle: "نتائج نامکمل ہیں",
    incompleteBody: (errors: number, total: number) =>
      `${total} میں سے ${errors} ٹیسٹ نہیں چل سکے، اس لیے یہ گریڈ قابلِ اعتماد نہیں۔ ایک منٹ بعد دوبارہ کوشش کریں۔`,
    causeLabel: "سب سے عام وجہ:",
  },
} as const;

function buildVerdictSentence(scan: Scan, uiLang: "en" | "ur"): string {
  const summary = scan.summary;
  if (!summary || scan.grade === null) {
    return uiLang === "ur"
      ? "کوئی ٹیسٹ مکمل نہیں ہو سکا، اس لیے گریڈ نہیں دیا گیا۔"
      : "No test could be decided, so no grade was given.";
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
  const countLine = `${summary.breaches} of ${decided} decided attacks worked.`;

  if (worstLang && worstRate > 0) {
    const langTxt = languageName(worstLang, "en");
    return worstAllWorked
      ? `${lead} ${countLine} ${langTxt} got through every time.`
      : `${lead} ${countLine} ${langTxt} was the weakest spot.`;
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
    const errors = items.filter((f) => f.status === "error");

    let outcome: InspectionOutcome = "not_run";
    if (breaches.length > 0 && passes.length === 0) outcome = "leaked";
    else if (breaches.length > 0 && passes.length > 0) outcome = "partial";
    else if (passes.length > 0) outcome = "held";
    else if (errors.length > 0) outcome = "error";

    const leakedLangs = LANGS_IN_ORDER.filter((lang) => breaches.some((b) => b.lang === lang));
    const representative =
      breaches.find((b) => b.lang === "roman_ur") ?? breaches[0] ?? passes[0] ?? items[0];

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
    error: 2,
    skipped: 3,
    not_run: 3,
    held: 4,
  };
  return groups.sort((a, b) => {
    if (rank[a.outcome] !== rank[b.outcome]) return rank[a.outcome] - rank[b.outcome];
    if (b.breachCount !== a.breachCount) return b.breachCount - a.breachCount;
    return b.maxSeverity - a.maxSeverity;
  });
}

/** The most frequent error evidence sentence, without the "Counted as an error" tail. */
function mostCommonErrorCause(findings: Finding[]): string | null {
  const counts = new Map<string, number>();
  for (const f of findings) {
    if (f.status !== "error") continue;
    const cause = f.evidence.replace(/\s*Counted as an error, not as a pass\.?\s*$/, "").trim();
    if (cause) counts.set(cause, (counts.get(cause) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [cause, n] of counts) {
    if (n > bestCount) {
      best = cause;
      bestCount = n;
    }
  }
  return best;
}

/** Urdu-aware text block: Nastaliq + rtl for Urdu script, Plex Mono for attack and reply text otherwise. */
function AttackText({ text }: { text: string }) {
  const ur = hasUrduScript(text);
  return (
    <p
      lang={ur ? "ur" : undefined}
      dir={ur ? "rtl" : undefined}
      className={`mt-1 whitespace-pre-wrap break-words text-sm text-[#18233A] ${ur ? "font-urdu" : "font-mono"}`}
    >
      {text}
    </p>
  );
}

function UrBlock({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p lang="ur" dir="rtl" className={`font-urdu ${className}`}>
      {children}
    </p>
  );
}

function BucketRow({ label, bucket, labelUr }: { label: string; labelUr?: boolean; bucket: ScanBucket | undefined }) {
  return (
    <tr>
      <th
        scope="row"
        lang={labelUr ? "ur" : undefined}
        dir={labelUr ? "rtl" : undefined}
        className={`px-3 py-2.5 text-left font-medium text-[#18233A] ${labelUr ? "font-urdu" : ""}`}
      >
        {label}
      </th>
      <td className="px-3 py-2.5 text-right tabular-nums text-[#B3261E]">{bucket?.breaches ?? 0}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-[#1F6B47]">{bucket?.passes ?? 0}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-[#8A5A00]">{(bucket?.errors ?? 0) + (bucket?.skipped ?? 0)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#18233A]">{formatPercent(bucket?.asr)}</td>
    </tr>
  );
}

export function ReportCard({ scan, findings, targetName }: ReportCardProps) {
  const [uiLang, setUiLang] = useState<"en" | "ur">("en");
  const isUrdu = uiLang === "ur";
  const t = COPY[uiLang];
  const ur = (extra = "") => ({
    lang: isUrdu ? "ur" : undefined,
    dir: isUrdu ? ("rtl" as const) : undefined,
    className: `${extra} ${isUrdu ? "font-urdu" : ""}`.trim(),
  });

  const grouped = groupFindingsByIntent(findings);
  const verdict = buildVerdictSentence(scan, uiLang);
  const summary = scan.summary;
  const wAsr = weightedAsr(findings);
  const incomplete = isIncomplete(scan, findings);
  const total = summary?.total ?? findings.length;
  const errorCount = summary?.errors ?? findings.filter((f) => f.status === "error").length;
  const skippedCount = summary?.skipped ?? findings.filter((f) => f.status === "skipped").length;
  const cause = errorCount > 0 ? mostCommonErrorCause(findings) : null;
  const formattedDate = new Date(scan.finishedAt ?? scan.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <article aria-label="Inspection report" className="report-sheet rounded-md p-5 sm:p-10">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#D9DCD5] pb-6">
        <div {...ur()}>
          <h2 className="text-[24px] sm:text-[28px] font-semibold leading-tight text-[#18233A]">
            {t.headingPrefix} <span className="text-[#4A5568]">· {LEVEL_LABELS[scan.level][uiLang]}</span>
          </h2>
          <p className="mt-1 text-base text-[#4A5568]">
            {t.targetLabel} <span className="font-semibold text-[#18233A]">{targetName}</span>
          </p>
        </div>

        <div role="group" aria-label="Report language" className="inline-flex rounded-md border border-[#D9DCD5] bg-[#F4F5F2] p-1">
          <button
            type="button"
            aria-pressed={uiLang === "en"}
            onClick={() => setUiLang("en")}
            className={`min-h-[44px] rounded px-4 text-sm font-semibold transition-colors cursor-pointer ${
              uiLang === "en" ? "bg-[#18233A] text-[#F4F5F2]" : "text-[#18233A] hover:text-[#2B3F8C]"
            }`}
          >
            English
          </button>
          <button
            type="button"
            lang="ur"
            dir="rtl"
            aria-pressed={uiLang === "ur"}
            onClick={() => setUiLang("ur")}
            className={`font-urdu min-h-[44px] rounded px-4 text-base font-semibold transition-colors cursor-pointer ${
              uiLang === "ur" ? "bg-[#18233A] text-[#F4F5F2]" : "text-[#18233A] hover:text-[#2B3F8C]"
            }`}
          >
            اردو
          </button>
        </div>
      </header>

      {incomplete && (
        <div role="alert" className="mt-6 rounded-md border border-[#8A5A00] bg-[#8A5A00]/10 px-4 py-3 text-[#18233A]">
          <p {...ur("font-semibold text-[#8A5A00]")}>
            <span aria-hidden="true">! </span>
            {t.incompleteTitle}
          </p>
          <p {...ur("mt-1 text-base")}>{t.incompleteBody(errorCount, total)}</p>
          {cause && (
            <p className="mt-1 text-sm text-[#4A5568]">
              <span {...ur()}>{t.causeLabel}</span> {cause}
            </p>
          )}
        </div>
      )}

      {/* Stamp + verdict + key numbers */}
      <section className="flex flex-col items-start gap-6 border-b border-[#D9DCD5] py-8 sm:flex-row sm:items-center sm:gap-10">
        <InspectionStamp grade={scan.grade} dateLabel={formattedDate} size="lg" animate />

        <div className="min-w-0 max-w-[70ch] flex-1">
          <p {...ur("text-[20px] font-semibold leading-snug text-[#18233A]")}>{verdict}</p>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <div>
              <dt {...ur("text-sm text-[#4A5568]")}>{t.gradeLabel}</dt>
              <dd className="text-[24px] font-semibold text-[#18233A]">{scan.grade ?? "—"}</dd>
            </div>
            <div>
              <dt {...ur("text-sm text-[#4A5568]")}>{t.scoreLabel}</dt>
              <dd className="text-[24px] font-semibold text-[#18233A]">
                {scan.score ?? "—"}
                <span className="text-base font-normal text-[#4A5568]"> / 100</span>
              </dd>
            </div>
            <div>
              <dt {...ur("text-sm text-[#4A5568]")} title={t.asrHelp}>
                {t.asrLabel}
              </dt>
              <dd className="text-[24px] font-semibold text-[#18233A]">{formatPercent(wAsr)}</dd>
            </div>
            <div>
              <dt {...ur("text-sm text-[#4A5568]")}>{t.countsLabel}</dt>
              <dd className="mt-1 space-y-0.5 text-sm font-semibold">
                <span className="block text-[#B3261E]">
                  <span aria-hidden="true">✕ </span>
                  {summary?.breaches ?? 0} {isUrdu ? "لیک" : "breach"}
                </span>
                <span className="block text-[#1F6B47]">
                  <span aria-hidden="true">✓ </span>
                  {summary?.passes ?? 0} {isUrdu ? "محفوظ" : "pass"}
                </span>
                <span className="block text-[#8A5A00]">
                  <span aria-hidden="true">! </span>
                  {errorCount} {isUrdu ? "خرابی" : "error"}
                  {skippedCount > 0 ? ` · ${skippedCount} ${isUrdu ? "چھوڑے گئے" : "skipped"}` : ""}
                </span>
              </dd>
            </div>
          </dl>
          <p {...ur("mt-3 text-sm text-[#4A5568]")}>{t.errorsNote}</p>
        </div>
      </section>

      {/* By language */}
      <section className="border-b border-[#D9DCD5] py-8">
        <h3 {...ur("text-[20px] font-semibold text-[#18233A]")}>{t.langSectionTitle}</h3>
        <div className="mt-5 max-w-xl space-y-4">
          {LANGS_IN_ORDER.map((lang) => {
            const bucket = summary?.byLang?.[lang];
            const breaches = bucket?.breaches ?? 0;
            const decided = breaches + (bucket?.passes ?? 0);
            const errs = (bucket?.errors ?? 0) + (bucket?.skipped ?? 0);
            const pct = decided > 0 ? Math.round((breaches / decided) * 100) : 0;
            const barColor = pct >= 60 ? "bg-[#B3261E]" : pct > 0 ? "bg-[#8A5A00]" : "bg-[#1F6B47]";
            const langUr = lang === "ur" || isUrdu;
            return (
              <div key={lang} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-base">
                  <span
                    lang={langUr ? "ur" : undefined}
                    dir={langUr ? "rtl" : undefined}
                    className={`font-medium text-[#18233A] ${langUr ? "font-urdu" : ""}`}
                  >
                    {languageName(lang, uiLang)}
                  </span>
                  <span {...ur("text-sm font-semibold text-[#4A5568]")}>
                    {isUrdu ? `${decided} میں سے ${breaches}` : `${breaches} of ${decided} worked`}
                    {errs > 0 ? (isUrdu ? ` · ${errs} خرابی` : ` · ${errs} error${errs === 1 ? "" : "s"}`) : ""}
                  </span>
                </div>
                <div
                  className="h-3 w-full overflow-hidden rounded-sm border border-[#D9DCD5] bg-[#F4F5F2]"
                  role="img"
                  aria-label={`${languageName(lang)}: ${pct}% of decided attacks worked`}
                >
                  <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* By intent */}
      <section className="border-b border-[#D9DCD5] py-8">
        <h3 {...ur("text-[20px] font-semibold text-[#18233A]")}>{t.intentSectionTitle}</h3>
        <div className="mt-4 overflow-x-auto rounded-md border border-[#D9DCD5]">
          <table className="w-full min-w-[460px] border-collapse text-sm">
            <thead className="border-b border-[#D9DCD5] bg-[#ECEEE8]">
              <tr {...ur()}>
                <th scope="col" className="px-3 py-2.5 text-left font-semibold">{t.risk}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">✕ {t.breaches}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">✓ {t.passes}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">! {t.errors}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">{t.asr}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D9DCD5]">
              {INTENTS.filter((i) => summary?.byIntent?.[i]).map((intent) => (
                <BucketRow
                  key={intent}
                  label={INTENT_LABELS[intent][uiLang]}
                  labelUr={isUrdu}
                  bucket={summary?.byIntent?.[intent]}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* What went wrong (grouped by intent) */}
      <section className="border-b border-[#D9DCD5] py-8">
        <h3 {...ur("text-[20px] font-semibold text-[#18233A]")}>{t.findingsSectionTitle}</h3>
        <div className="mt-4 divide-y divide-[#D9DCD5] border-t border-b border-[#D9DCD5]">
          {grouped.map((group) => {
            const workedInText =
              group.leakedLangs.length > 0
                ? `${t.workedInPrefix} ${group.leakedLangs.map((l) => languageName(l, uiLang)).join(isUrdu ? "، " : ", ")}`
                : group.outcome === "held"
                  ? t.heldAllLangs
                  : t.notEvaluated;
            return (
              <div key={group.intent} className="py-5">
                <div className="flex flex-wrap items-center gap-3">
                  <OutcomeBadge outcome={group.outcome} uiLang={uiLang} />
                  <span {...ur("text-sm text-[#4A5568]")}>{INTENT_LABELS[group.intent][uiLang]}</span>
                </div>
                <h4 className="mt-1.5 text-base sm:text-[18px] font-semibold text-[#18233A]">{group.titleEn}</h4>
                <UrBlock className="text-base text-[#18233A]">{group.titleUr}</UrBlock>
                <p {...ur("mt-1 text-sm text-[#4A5568]")}>{workedInText}</p>
                <div className="mt-2 max-w-[70ch] text-sm leading-relaxed text-[#4A5568]">
                  <p>{group.impactEn}</p>
                  <UrBlock className="mt-1">{group.impactUr}</UrBlock>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Every finding */}
      <section className="pt-8">
        <h3 {...ur("text-[20px] font-semibold text-[#18233A]")}>
          {t.allResultsTitle} <span className="text-base font-normal text-[#4A5568]">({findings.length})</span>
        </h3>
        <ul className="mt-4 divide-y divide-[#D9DCD5] border-t border-b border-[#D9DCD5]">
          {findings.map((f) => (
            <li key={f.id}>
              <details className="group py-3">
                <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="w-20 shrink-0">
                    <OutcomeBadge outcome={statusFromFinding(f.status)} />
                  </span>
                  <span className="font-mono text-sm text-[#4A5568]">{f.checkId}</span>
                  <span className="text-sm text-[#4A5568]">{languageName(f.lang)}</span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-[#18233A]">
                    {f.intent ? INTENT_LABELS[f.intent].en : f.title_en}
                  </span>
                  <span aria-hidden="true" className="text-sm text-[#2B3F8C] group-open:rotate-90">›</span>
                </summary>
                <div className="mt-2 space-y-4 rounded-md border border-[#D9DCD5] bg-[#F4F5F2] p-4 sm:p-5">
                  <div>
                    <p className="text-base font-semibold text-[#18233A]">{f.title_en}</p>
                    <UrBlock className="text-base text-[#18233A]">{f.title_ur}</UrBlock>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#18233A]">{COPY.en.evidenceLabel}</p>
                    <p className="mt-1 text-sm text-[#18233A]">{f.evidence || "—"}</p>
                  </div>
                  {f.prompt && (
                    <div>
                      <p className="text-sm font-semibold text-[#18233A]">
                        {COPY.en.attackTried} ({languageName(f.lang)})
                      </p>
                      <AttackText text={f.prompt} />
                    </div>
                  )}
                  {f.response && (
                    <div>
                      <p className="text-sm font-semibold text-[#18233A]">{COPY.en.botReplied}</p>
                      <AttackText text={f.response} />
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-semibold text-[#18233A]">{COPY.en.impactLabel}</p>
                    <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-[#4A5568]">{f.businessImpact_en}</p>
                    <UrBlock className="mt-1 max-w-[70ch] text-sm text-[#4A5568]">{f.businessImpact_ur}</UrBlock>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-[#D9DCD5] pt-3 text-sm text-[#4A5568]">
                    <span>
                      <strong className="text-[#18233A]">{COPY.en.standardLabel}:</strong> {f.standard}
                    </span>
                    <span>
                      <strong className="text-[#18233A]">{COPY.en.provenByLabel}:</strong> {JUDGED_BY_LABELS[f.judgedBy].en}
                    </span>
                    <span>
                      <strong className="text-[#18233A]">Severity:</strong> {f.severity} / 3
                    </span>
                    {f.latencyMs > 0 && (
                      <span>
                        <strong className="text-[#18233A]">Time:</strong> {(f.latencyMs / 1000).toFixed(1)} s
                      </span>
                    )}
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
