export interface AriaMismatch { line: number; expected: string; actual: string }

const END = "<end of file>";
const lines = (text: string) => text.replace(/\r\n/g, "\n").trimEnd().split("\n");

/**
 * Compares a locked aria snapshot with the one just taken. Line endings are normalised first: the golden file is
 * written with LF, but a Windows checkout with core.autocrlf=true reads it back with CRLF (T25 RV1).
 * Returns null when they match, otherwise the first differing line (1-based).
 */
export function compareAriaSnapshot(expected: string, actual: string): AriaMismatch | null {
  const want = lines(expected);
  const got = lines(actual);
  for (let index = 0; index < Math.max(want.length, got.length); index += 1) {
    if (want[index] !== got[index]) return { line: index + 1, expected: want[index] ?? END, actual: got[index] ?? END };
  }
  return null;
}
