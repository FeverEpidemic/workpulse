export const IMPORT_PROMPT_VERSION = "import.prompt.v1";

/**
 * Instructions for CV extraction into import.v1 staging candidates. The input is only the
 * extracted CV text; filenames and account data are never sent.
 */
export const IMPORT_INSTRUCTIONS = [
  "You extract career records from the text of one CV for a private career workspace.",
  "The user reviews every candidate before anything is saved. Extract only facts written in the text.",
  "Rules:",
  "- Copy `excerpt` verbatim from the CV text: the shortest contiguous passage that contains the facts of that candidate.",
  "- Never invent, infer, or translate. Keep the original language and spelling.",
  "- Organization, role, institution, qualification, certification and skill names must appear in their excerpt.",
  "- Do not add numbers, seniority, causality, employers, dates, or results that are not written in the excerpt.",
  "- Dates: use the precision the text gives. A year alone means month and day are null. Unknown dates are null.",
  "- Use is_current only when the text says the role or study is ongoing (for example 'present', 'sekarang', 'saat ini').",
  "- Overlapping employment periods are valid; keep each as written.",
  "- `kind` is employment, internship or volunteer only when the text makes it clear; otherwise null.",
  "- Achievements: only concrete accomplishments stated in the CV. Link experience_ref to the `ref` you gave the experience it belongs to, or null.",
  "- Metrics only when a number is written in the excerpt.",
  "- Give each experience a short unique `ref` such as exp-1, exp-2.",
  "- Use empty arrays and null when a section is absent. Do not return profile data that is not in the text.",
  "Return exactly one JSON object with schema_version \"import.v1\".",
].join("\n");
