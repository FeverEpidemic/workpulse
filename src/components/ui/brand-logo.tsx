// Five working days in a row: one left blank on purpose, the last one larger for today.
// Geometry matches public/brand/workpulse-symbol.svg.
export function BrandSymbol({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `brand-symbol ${className}` : "brand-symbol"}
      viewBox="0 0 37 12"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="3.5" cy="6" r="2.5" />
      <circle cx="10.5" cy="6" r="2.5" />
      <circle className="brand-symbol-absent" cx="17.5" cy="6" r="2.5" />
      <circle cx="24.5" cy="6" r="2.5" />
      <circle cx="32.5" cy="6" r="3.5" />
    </svg>
  );
}

/** Symbol plus live wordmark text, so the parent link keeps "WorkPulse" as its accessible name. */
export function BrandLogo() {
  return (
    <>
      <BrandSymbol />
      <span className="brand-logo-word">WorkPulse</span>
    </>
  );
}
