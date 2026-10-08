// pdfjs-dist ships types for its package root and for legacy/build/pdf.mjs, but not for build/pdf.mjs, the
// browser build that S14 loads (T22). The build exports the same API as the package root.
declare module "pdfjs-dist/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
