"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/scan", label: "Inspection" },
  { href: "/playground", label: "Playground" },
] as const;

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="border-b border-[#D9DCD5] bg-[#F4F5F2]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center gap-2.5 text-[20px] font-bold tracking-tight text-[#18233A]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-6 w-6 text-[#2B3F8C]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <span>Bizvyra</span>
        </Link>

        <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-1 sm:gap-4">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex min-h-[44px] items-center px-3 text-base font-medium transition-colors ${
                  active
                    ? "text-[#2B3F8C] underline decoration-2 underline-offset-8"
                    : "text-[#18233A] hover:text-[#2B3F8C]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
