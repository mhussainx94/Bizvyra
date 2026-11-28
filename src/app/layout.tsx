import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Noto_Nastaliq_Urdu } from "next/font/google";
import "./globals.css";
import { USE_MOCKS } from "@/components/api-client";
import { Navbar } from "@/components/navbar";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  variable: "--font-nastaliq-urdu",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Bizvyra — Detect. Fix. Protect. Prove.",
  description:
    "Bizvyra tests small business AI chatbots in English, Urdu and Roman Urdu, grades them A-F, writes a fix and re-tests it.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} ${notoNastaliqUrdu.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#F4F5F2] text-[#18233A] font-sans selection:bg-[#2B3F8C]/15 selection:text-[#18233A]">
        <Navbar />
        <div className="flex-1 flex flex-col">{children}</div>
        <footer className="border-t border-[#D9DCD5] bg-[#F4F5F2]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-sm text-[#4A5568] sm:px-8">
            <span>Bizvyra by Team HackForge · Detect. Fix. Protect. Prove.</span>
            {USE_MOCKS && <span>Mock mode: sample data, not live</span>}
          </div>
        </footer>
      </body>
    </html>
  );
}
