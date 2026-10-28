import Link from "next/link";
import { ChevronDown, Info } from "lucide-react";

import type { LegalBlock, LegalText } from "@/features/legal/content/types";
import { legalDocument, type LegalKind } from "@/features/legal/documents";
import { LEGAL_DRAFT } from "@/features/legal/legal-status";
import { LandingFooter } from "@/features/marketing/landing-footer";
import { LandingHeader } from "@/features/marketing/landing-header";
import { t, type Locale } from "@/i18n/messages";

function Text({ text }: { text: LegalText }) {
  return text.map((part, index) => {
    if (typeof part === "string") return part;
    if ("strong" in part) return <strong key={index}>{part.strong}</strong>;
    if ("code" in part) return <code key={index}>{part.code}</code>;
    if ("placeholder" in part) return <mark key={index} className="legal-blank">{part.placeholder}</mark>;
    return part.href.startsWith("/")
      ? <Link key={index} href={part.href}>{part.link}</Link>
      : <a key={index} href={part.href}>{part.link}</a>;
  });
}

function Block({ block, caption }: { block: LegalBlock; caption: string }) {
  if (block.type === "p") return <p><Text text={block.text} /></p>;
  if (block.type === "ul") return <ul>{block.items.map((item, index) => <li key={index}><Text text={item} /></li>)}</ul>;
  return (
    <div className="legal-table-wrap">
      <table className="legal-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{block.head.map((cell, index) => <th key={index} scope="col"><Text text={cell} /></th>)}</tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, index) => <td key={index}><Text text={cell} /></td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `/privacy` and `/terms`: the draft text with its blanks highlighted, in the landing page frame. */
export function LegalPage({ kind, locale }: { kind: LegalKind; locale: Locale }) {
  const doc = legalDocument(kind, locale);
  const [effectiveBefore, effectiveAfter] = t(locale, "legal.effective").split("{date}");
  const toc = (
    <ol className="legal-toc-list">
      {doc.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.heading}</a></li>)}
    </ol>
  );
  return (
    <div className="landing">
      <a className="skip-link" href="#main-content">{t(locale, "landing.skip")}</a>
      <LandingHeader locale={locale} />
      <main id="main-content" tabIndex={-1} className="landing-container legal-layout">
        {/* Sidebar from 768 px, a closed disclosure below it; CSS shows only one, so only one nav is announced. */}
        <nav className="legal-toc" aria-label={t(locale, "legal.toc")}>
          <p className="legal-toc-title" aria-hidden="true">{t(locale, "legal.toc")}</p>
          {toc}
        </nav>
        <details className="legal-toc-mobile">
          <summary>{t(locale, "legal.toc")}<ChevronDown aria-hidden="true" size={18} strokeWidth={1.8} /></summary>
          <nav aria-label={t(locale, "legal.toc")}>{toc}</nav>
        </details>
        <article className="legal-article">
          {LEGAL_DRAFT ? (
            <div className="legal-draft" role="note">
              <Info aria-hidden="true" size={18} strokeWidth={1.8} />
              <p>{t(locale, "legal.draftNotice")}</p>
            </div>
          ) : null}
          <h1 className="landing-h2">{t(locale, `legal.${kind}.title`)}</h1>
          <p className="legal-effective">{effectiveBefore}<Text text={doc.effectiveDate} />{effectiveAfter}</p>
          {doc.intro.map((block, index) => <Block key={index} block={block} caption="" />)}
          {doc.sections.map((section) => (
            <section key={section.id} aria-labelledby={section.id}>
              <h2 id={section.id} className="legal-h2">{section.heading}</h2>
              {section.blocks.map((block, index) => <Block key={index} block={block} caption={section.heading} />)}
            </section>
          ))}
        </article>
      </main>
      <LandingFooter locale={locale} current={kind} />
    </div>
  );
}
