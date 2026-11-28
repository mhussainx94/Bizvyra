import type { ChatbotFixContent, FixLevel } from "@/lib/types";

interface FixPanelProps {
  fix: ChatbotFixContent;
  level: FixLevel;
}

/** The fix /api/fix wrote: what changed (EN + UR), the output guard, and the hardened prompt (collapsible). */
export function FixPanel({ fix, level }: FixPanelProps) {
  const guard = fix.outputGuard;
  return (
    <section
      aria-label={`Fix for level ${level}`}
      className="rounded-md border border-[#D9DCD5] bg-[#FFFFFF] p-5 sm:p-6"
    >
      <h3 className="text-[20px] font-semibold text-[#18233A]">
        {level === 1 ? "Fix L1: hardened instructions" : "Fix L2: hardened instructions + output guard"}
      </h3>
      <p className="mt-1 text-sm text-[#4A5568]">
        Output guard:{" "}
        {guard.enabled ? (
          <span className="font-semibold text-[#1F6B47]">
            <span aria-hidden="true">✓ </span>on
            {guard.blockProtected ? " · blocks protected values" : ""}
            {guard.selfCheck ? " · AI self-check of every reply" : ""}
          </span>
        ) : (
          <span className="font-semibold text-[#4A5568]">off</span>
        )}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h4 className="text-base font-semibold text-[#18233A]">What changed</h4>
          <ol className="mt-2 list-decimal space-y-1.5 ps-5 text-sm leading-relaxed text-[#18233A]">
            {fix.changes_en.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </div>
        <div lang="ur" dir="rtl">
          <h4 className="font-urdu text-base font-semibold text-[#18233A]">کیا تبدیل ہوا</h4>
          <ol className="font-urdu mt-2 list-decimal space-y-1.5 ps-5 text-sm text-[#18233A]">
            {fix.changes_ur.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </div>
      </div>

      <details className="mt-5 border-t border-[#D9DCD5] pt-4">
        <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-sm font-semibold text-[#2B3F8C] underline underline-offset-4">
          Show the hardened instructions ({fix.systemPrompt.length.toLocaleString("en-US")} characters)
        </summary>
        <p className="mt-2 text-sm text-[#4A5568]">
          Paste these into your chatbot in place of the original instructions. Protected values are replaced by neutral
          descriptions, so the bot no longer knows them.
        </p>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[#D9DCD5] bg-[#F4F5F2] p-4 font-mono text-xs leading-relaxed text-[#18233A]">
          {fix.systemPrompt}
        </pre>
      </details>
    </section>
  );
}
