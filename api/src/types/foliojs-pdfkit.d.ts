// @foliojs-fork/pdfkit is an actively-maintained, API-compatible fork of
// pdfkit (it's what pdfmake itself depends on internally) — no separate type
// package exists for the fork, so this reuses @types/pdfkit's value export.
// Note: @types/pdfkit's own module declaration is `export = doc` where `doc`
// is typed as the *instance* interface `PDFKit.PDFDocument` (an ambient
// global namespace, not tied to the module import) — so code elsewhere
// should type document parameters as `PDFKit.PDFDocument`, not as the
// imported default itself.
declare module '@foliojs-fork/pdfkit' {
  import doc = require('pdfkit');
  export = doc;
}
