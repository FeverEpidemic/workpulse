interface NativeBeforeInput {
  inputType?: string;
  data?: string | null;
}

/**
 * The text a before-input event is about to insert, or null. React builds onBeforeInput from textInput, keypress and
 * composition events, which carry no inputType; the character is on the React event as `data`.
 */
export function insertedTextOf(react: { data?: string | null }, native: NativeBeforeInput): string | null {
  if (native.inputType?.startsWith("delete")) return null;
  const typed = react.data ?? native.data ?? null;
  if (typed !== null) return typed;
  return native.inputType === "insertLineBreak" || native.inputType === "insertParagraph" ? "\n" : null;
}
