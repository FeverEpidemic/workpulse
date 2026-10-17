import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS applies its own corner mask, so the tile is full-bleed. One unit is 1/37 of the
// symbol width, matching the viewBox of public/brand/workpulse-symbol.svg.
const UNIT = 135 / 37;
const LIGHT = "#F4F7F3";
const ABSENT = "#8FAF87";

function dot(diameterUnits: number, color: string) {
  const diameter = diameterUnits * UNIT;
  return <div style={{ width: diameter, height: diameter, borderRadius: diameter, background: color }} />;
}

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 2 * UNIT,
          background: "#567657",
        }}
      >
        {dot(5, LIGHT)}
        {dot(5, LIGHT)}
        {dot(5, ABSENT)}
        {dot(5, LIGHT)}
        {dot(7, LIGHT)}
      </div>
    ),
    size,
  );
}
