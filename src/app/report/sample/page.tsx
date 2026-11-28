import type { Metadata } from "next";
import { SampleReport } from "@/components/sample-report";

export const metadata: Metadata = {
  title: "Sample report (recorded data) — Bizvyra",
  description: "A complete sample Bizvyra inspection of the demo chatbot: L0, L1 and L2 side by side.",
};

export default function SampleReportPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8">
      <SampleReport />
    </main>
  );
}
