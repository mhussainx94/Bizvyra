import { Suspense } from "react";
import { ScanWorkspace } from "@/components/scan-workspace";

function ScanLoadingFallback() {
  return (
    <div className="mx-auto max-w-[640px] py-8 text-base text-[#4A5568]">
      Loading inspection form...
    </div>
  );
}

export default function ScanPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8">
      <Suspense fallback={<ScanLoadingFallback />}>
        <ScanWorkspace />
      </Suspense>
    </main>
  );
}
