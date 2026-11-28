import type { FindingStatus, Intent, JudgedBy, Lang } from "@/lib/types";

export const INTENT_LABELS: Record<Intent, { en: string; ur: string }> = {
  leak_discount_codes: {
    en: "Discount code leakage",
    ur: "ڈسکاؤنٹ کوڈز کا افشا",
  },
  steal_system_prompt: {
    en: "System instructions theft",
    ur: "سسٹم ہدایات کی چوری",
  },
  approve_refund: {
    en: "Unauthorised refund approval",
    ur: "بغیر اختیار ریفنڈ منظوری",
  },
  ignore_instructions: {
    en: "Role hijacking",
    ur: "کردار سے ہٹانا",
  },
  brand_abuse: {
    en: "Brand reputation harm",
    ur: "برانڈ کی ساکھ کو نقصان",
  },
};

export const JUDGED_BY_LABELS: Record<JudgedBy, { en: string; ur: string }> = {
  canary: { en: "Canary token match", ur: "کینری ٹوکن کی شناخت" },
  asset: { en: "Protected value match", ur: "محفوظ قدر کی شناخت" },
  overlap: { en: "Instructions overlap", ur: "ہدایات کا مماثل متن" },
  llm: { en: "AI judge verification", ur: "اے آئی جج کی تصدیق" },
  rule: { en: "Rule check", ur: "اصول کی جانچ" },
  none: { en: "Not evaluated", ur: "جانچ مکمل نہ ہو سکی" },
};

export function hasUrduScript(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

export function languageName(lang: Lang | undefined, uiLang: "en" | "ur" = "en"): string {
  if (uiLang === "ur") {
    if (lang === "ur") return "اردو";
    if (lang === "roman_ur") return "رومن اردو";
    return "انگریزی";
  }
  if (lang === "ur") return "Urdu";
  if (lang === "roman_ur") return "Roman Urdu";
  return "English";
}

export type InspectionOutcome = "leaked" | "held" | "partial" | "not_run";

export function statusFromFinding(status: FindingStatus): InspectionOutcome {
  if (status === "breach") return "leaked";
  if (status === "pass") return "held";
  return "not_run";
}

export function OutcomeBadge({
  outcome,
  uiLang = "en",
}: {
  outcome: InspectionOutcome;
  uiLang?: "en" | "ur";
}) {
  const isUrdu = uiLang === "ur";

  if (outcome === "leaked") {
    return (
      <span
        lang={isUrdu ? "ur" : undefined}
        dir={isUrdu ? "rtl" : undefined}
        className={`inline-flex items-center gap-1.5 text-sm font-semibold text-[#B3261E] ${
          isUrdu ? "font-urdu" : ""
        }`}
      >
        <span aria-hidden="true">✕</span>
        <span>{isUrdu ? "لیک ہو گیا" : "Leaked"}</span>
      </span>
    );
  }

  if (outcome === "held") {
    return (
      <span
        lang={isUrdu ? "ur" : undefined}
        dir={isUrdu ? "rtl" : undefined}
        className={`inline-flex items-center gap-1.5 text-sm font-semibold text-[#1F6B47] ${
          isUrdu ? "font-urdu" : ""
        }`}
      >
        <span aria-hidden="true">✓</span>
        <span>{isUrdu ? "محفوظ رہا" : "Held"}</span>
      </span>
    );
  }

  if (outcome === "partial") {
    return (
      <span
        lang={isUrdu ? "ur" : undefined}
        dir={isUrdu ? "rtl" : undefined}
        className={`inline-flex items-center gap-1.5 text-sm font-semibold text-[#8A5A00] ${
          isUrdu ? "font-urdu" : ""
        }`}
      >
        <span aria-hidden="true">!</span>
        <span>{isUrdu ? "جزوی طور پر لیک" : "Partial"}</span>
      </span>
    );
  }

  return (
    <span
      lang={isUrdu ? "ur" : undefined}
      dir={isUrdu ? "rtl" : undefined}
      className={`inline-flex items-center gap-1.5 text-sm font-semibold text-[#4A5568] ${
        isUrdu ? "font-urdu" : ""
      }`}
    >
      <span aria-hidden="true">–</span>
      <span>{isUrdu ? "ٹیسٹ نہیں ہوا" : "Not run"}</span>
    </span>
  );
}
