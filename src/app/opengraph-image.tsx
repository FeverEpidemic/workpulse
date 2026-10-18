import { ImageResponse } from "next/og";

import { LOCKUP_VIEWBOX, WORDMARK_PATH } from "@/components/ui/brand-wordmark-path";

export const alt = "WorkPulse";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const DOT = "#567657";
const ABSENT = "#B3C9AC";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F7FAF6",
        }}
      >
        <svg viewBox={LOCKUP_VIEWBOX} width={680} height={96}>
          <g transform="translate(0 4.3) scale(1.283)">
            <circle cx="3.5" cy="6" r="2.5" fill={DOT} />
            <circle cx="10.5" cy="6" r="2.5" fill={DOT} />
            <circle cx="17.5" cy="6" r="2.5" fill={ABSENT} />
            <circle cx="24.5" cy="6" r="2.5" fill={DOT} />
            <circle cx="32.5" cy="6" r="3.5" fill={DOT} />
          </g>
          <path fill="#1A211C" d={WORDMARK_PATH} />
        </svg>
      </div>
    ),
    size,
  );
}
