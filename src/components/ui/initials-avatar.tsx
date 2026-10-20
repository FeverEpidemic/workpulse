function firstLetter(word: string): string {
  return Array.from(word)[0]?.toLocaleUpperCase() ?? "";
}

export function initialsFrom(name: string, fallback: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) return words.slice(0, 2).map(firstLetter).join("");
  return firstLetter(fallback.trim());
}

// Decorative: the control that holds it carries the accessible name.
export function InitialsAvatar({ name, fallback }: { name: string; fallback: string }) {
  return <span className="initials-avatar" aria-hidden="true">{initialsFrom(name, fallback)}</span>;
}
