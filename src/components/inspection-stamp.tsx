import { useId } from "react";
import type { Grade } from "@/lib/types";

interface InspectionStampProps {
  grade: Grade | null;
  dateLabel?: string;
  subLabel?: string;
  size?: "sm" | "lg";
  animate?: boolean;
}

function stampColor(grade: Grade | null): string {
  switch (grade) {
    case "A":
    case "B":
      return "#1F6B47";
    case "C":
    case "D":
      return "#8A5A00";
    case "F":
      return "#B3261E";
    default:
      return "#4A5568";
  }
}

export function InspectionStamp({
  grade,
  dateLabel = "25 Nov 2026",
  subLabel,
  size = "lg",
  animate = false,
}: InspectionStampProps) {
  const uid = useId().replace(/:/g, "");
  const topArcId = `stamp-top-${uid}`;
  const bottomArcId = `stamp-bottom-${uid}`;
  const color = stampColor(grade);
  const px = size === "sm" ? 116 : 168;
  const bottomText = subLabel ?? dateLabel;

  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center select-none ${
        animate ? "stamp-animate" : ""
      }`}
      style={{
        transform: "rotate(-8deg)",
        width: px,
        height: px,
      }}
      aria-label={`Inspection grade ${grade ?? "Pending"}, ${bottomText}`}
    >
      <svg
        viewBox="0 0 180 180"
        width={px}
        height={px}
        role="img"
        aria-hidden="true"
        className="overflow-visible"
      >
        <defs>
          {/* Top arc clockwise */}
          <path id={topArcId} d="M 28,90 A 62,62 0 1,1 152,90" fill="none" />
          {/* Bottom arc counter-clockwise so text reads upright */}
          <path id={bottomArcId} d="M 26,95 A 64,64 0 0,0 154,95" fill="none" />
        </defs>

        <circle
          cx="90"
          cy="90"
          r="82"
          fill="none"
          stroke={color}
          strokeWidth="3.5"
        />
        <circle
          cx="90"
          cy="90"
          r="75"
          fill="none"
          stroke={color}
          strokeWidth="1.25"
        />
        <circle
          cx="90"
          cy="90"
          r="46"
          fill="none"
          stroke={color}
          strokeWidth="1.25"
        />

        <text
          fill={color}
          fontSize="11.5"
          fontWeight="600"
          letterSpacing="0.6"
        >
          <textPath href={`#${topArcId}`} startOffset="50%" textAnchor="middle">
            Inspected by Bizvyra
          </textPath>
        </text>

        <text
          fill={color}
          fontSize="11"
          fontWeight="600"
          letterSpacing="0.4"
        >
          <textPath href={`#${bottomArcId}`} startOffset="50%" textAnchor="middle">
            {bottomText}
          </textPath>
        </text>

        <text
          x="90"
          y="108"
          fill={color}
          fontSize="56"
          fontWeight="700"
          textAnchor="middle"
        >
          {grade ?? "—"}
        </text>
      </svg>
    </div>
  );
}
