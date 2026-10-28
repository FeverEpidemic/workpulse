import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight, Download, FileUp, Mail, ScrollText, ShieldCheck, Trash2 } from "lucide-react";

import { BrandSymbol } from "@/components/ui/brand-logo";
import { Badge } from "@/components/ui/badge";
import { CvPreview } from "@/features/cv/cv-preview";
import { DemoTabs, type DemoTab } from "@/features/marketing/demo-tabs";
import { ExampleFrame } from "@/features/marketing/example-frame";
import { HeroStory } from "@/features/marketing/hero-story";
import { CONTACT_EMAIL, LandingFooter } from "@/features/marketing/landing-footer";
import { LandingHeader, SIGN_UP_HREF } from "@/features/marketing/landing-header";
import { HERO_STORY_ARM_SCRIPT, REVEAL_STAGGER_MS } from "@/features/marketing/motion";
import { RevealOnScroll } from "@/features/marketing/reveal-on-scroll";
import { landingSample } from "@/features/marketing/sample-data";
import { t, type Locale } from "@/i18n/messages";

function SignUpCta({ locale, label }: { locale: Locale; label: "landing.hero.cta" | "landing.closing.cta" }) {
  return (
    <Link href={SIGN_UP_HREF} className="button-primary landing-cta">
      {t(locale, label)}
      <ArrowRight className="landing-cta-arrow" aria-hidden="true" size={18} strokeWidth={1.8} />
    </Link>
  );
}

/** Props for one item of a `[data-reveal]` section; the stagger comes from motion.ts, not CSS. */
function reveal(index: number) {
  return { "data-reveal-item": "", style: { "--reveal-delay": `${index * REVEAL_STAGGER_MS}ms` } as CSSProperties };
}

function SectionIntro({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }) {
  return (
    <div className="landing-intro" {...reveal(0)}>
      <p className="landing-eyebrow">{eyebrow}</p>
      <h2 id={id} className="landing-h2">{title}</h2>
    </div>
  );
}

export function LandingPage({ locale }: { locale: Locale }) {
  const sample = landingSample(locale);
  const tabs: DemoTab[] = [
    {
      id: "log",
      label: t(locale, "landing.demo.tab.log"),
      title: t(locale, "landing.demo.log.title"),
      body: t(locale, "landing.demo.log.body"),
      steps: [1, 1],
      example: (
        <ExampleFrame label={t(locale, "landing.demo.log.exampleLabel")} locale={locale} className="landing-panel-example">
          <div className="landing-card landing-card--raised landing-quicklog">
            <p className="landing-quicklog-title">{sample.quickLog.title}</p>
            <p className="field-label">{sample.quickLog.fieldLabel}</p>
            <p className="field-input landing-quicklog-note">{sample.quickLog.note}</p>
            <div className="landing-row-between">
              <span className="landing-meta">{sample.quickLog.meta}</span>
              <span className="button-primary landing-fake-button">{sample.quickLog.save}</span>
            </div>
          </div>
        </ExampleFrame>
      ),
    },
    {
      id: "review",
      label: t(locale, "landing.demo.tab.review"),
      title: t(locale, "landing.demo.review.title"),
      body: t(locale, "landing.demo.review.body"),
      steps: [1, 3],
      example: (
        <ExampleFrame label={t(locale, "landing.demo.review.exampleLabel")} locale={locale} className="landing-panel-example">
          <div className="landing-card landing-review">
            <Badge className="landing-badge-info">{sample.review.badge}</Badge>
            <p className="landing-review-title">{sample.review.title}</p>
            <dl className="landing-review-fields">
              {sample.review.fields.map((field) => (
                <div key={field.label}>
                  <dt className="landing-meta">{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
            <p className="achievement-source-preview landing-review-source">{sample.review.source}</p>
            <div className="landing-row">
              <span className="button-primary landing-fake-button">{sample.review.confirm}</span>
              <span className="button-secondary landing-fake-button">{sample.review.editFirst}</span>
            </div>
          </div>
        </ExampleFrame>
      ),
    },
    {
      id: "cv",
      label: t(locale, "landing.demo.tab.cv"),
      title: t(locale, "landing.demo.cv.title"),
      body: t(locale, "landing.demo.cv.body"),
      steps: [1, 5],
      example: (
        <ExampleFrame label={t(locale, "landing.demo.cv.exampleLabel")} locale={locale} className="landing-panel-example landing-cv">
          <CvPreview model={sample.cv} locale={locale} dirty={false} />
          <span className="button-primary landing-fake-button landing-cv-download">
            <Download aria-hidden="true" size={16} strokeWidth={1.8} />
            {sample.downloadPdf}
          </span>
        </ExampleFrame>
      ),
    },
  ];

  return (
    <div className="landing">
      <a className="skip-link" href="#main-content">{t(locale, "landing.skip")}</a>
      <LandingHeader locale={locale} />

      <main id="main-content" tabIndex={-1}>
        <script dangerouslySetInnerHTML={{ __html: HERO_STORY_ARM_SCRIPT }} />
        <section id="landing-hero" className="landing-section landing-section--warm landing-hero" aria-labelledby="landing-hero-title">
          <div className="landing-container landing-hero-inner">
            <div className="landing-hero-text">
              <p className="landing-eyebrow">{t(locale, "landing.hero.eyebrow")}</p>
              <h1 id="landing-hero-title" className="landing-h1">{t(locale, "landing.hero.title")}</h1>
              <p className="landing-lead">{t(locale, "landing.hero.body")}</p>
              <div className="landing-actions">
                <SignUpCta locale={locale} label="landing.hero.cta" />
                <Link href="/sign-in" className="landing-text-link">{t(locale, "landing.hero.signIn")}</Link>
              </div>
            </div>
            <HeroStory sample={sample.hero} locale={locale} />
          </div>
        </section>

        <section id="landing-how" data-reveal className="landing-section" aria-labelledby="landing-how-title">
          <div className="landing-container landing-stack">
            <SectionIntro id="landing-how-title" eyebrow={t(locale, "landing.demo.eyebrow")} title={t(locale, "landing.demo.title")} />
            <div {...reveal(1)}><DemoTabs tabs={tabs} label={t(locale, "landing.demo.tablist")} locale={locale} /></div>
          </div>
        </section>

        <section id="landing-import" data-reveal className="landing-section landing-section--ruled" aria-labelledby="landing-import-title">
          <div className="landing-container landing-split">
            <SectionIntro id="landing-import-title" eyebrow={t(locale, "landing.import.eyebrow")} title={t(locale, "landing.import.title")} />
            <div className="landing-stack">
              <p className="landing-lead" {...reveal(1)}>{t(locale, "landing.import.body")}</p>
              <div {...reveal(2)}>
              <ExampleFrame label={t(locale, "landing.import.exampleLabel")} locale={locale}>
                <div className="landing-card landing-import">
                  <p className="landing-import-file">
                    <FileUp aria-hidden="true" size={18} strokeWidth={1.8} />
                    {sample.importExample.file}
                  </p>
                  <ul className="landing-import-rows">
                    {sample.importExample.rows.map((row) => (
                      <li key={row.title} className="landing-import-row">
                        <span className="min-w-0">
                          <span className="landing-import-title">{row.title}</span>
                          <span className="landing-meta">{row.detail}</span>
                        </span>
                        <span className="landing-row">
                          <span className="button-secondary landing-fake-button landing-fake-button--selected">{sample.importExample.keep}</span>
                          <span className="button-secondary landing-fake-button">{sample.importExample.skip}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </ExampleFrame>
              </div>
            </div>
          </div>
        </section>

        <section id="landing-data" data-reveal className="landing-section landing-section--warm" aria-labelledby="landing-data-title">
          <div className="landing-container landing-stack">
            <SectionIntro id="landing-data-title" eyebrow={t(locale, "landing.data.eyebrow")} title={t(locale, "landing.data.title")} />
            <ul className="landing-facts">
              {([
                [ShieldCheck, "landing.data.ai.title", "landing.data.ai.body"],
                [ScrollText, "landing.data.source.title", "landing.data.source.body"],
                [Trash2, "landing.data.delete.title", "landing.data.delete.body"],
              ] as const).map(([Icon, title, body], index) => (
                <li key={title} className="landing-fact" {...reveal(index + 1)}>
                  <h3 className="landing-fact-title"><Icon aria-hidden="true" size={22} strokeWidth={1.8} />{t(locale, title)}</h3>
                  <p className="landing-body">{t(locale, body)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="landing-maker" data-reveal className="landing-section" aria-labelledby="landing-maker-title">
          <div className="landing-container landing-container--narrow landing-stack">
            <h2 id="landing-maker-title" className="landing-eyebrow" {...reveal(0)}>{t(locale, "landing.maker.eyebrow")}</h2>
            <blockquote className="landing-quote" {...reveal(1)}>
              <p>{t(locale, "landing.maker.quote")}</p>
            </blockquote>
            <p className="landing-maker" {...reveal(2)}>
              <span className="landing-maker-name">{t(locale, "landing.maker.name")}</span>
              <a className="landing-text-link" href={`mailto:${CONTACT_EMAIL}`}>
                <Mail aria-hidden="true" size={16} strokeWidth={1.8} />
                {t(locale, "landing.maker.email")}
              </a>
            </p>
          </div>
        </section>

        <section id="landing-closing" data-reveal className="landing-section landing-section--warm-subtle" aria-labelledby="landing-closing-title">
          <div className="landing-container landing-closing">
            <BrandSymbol className="landing-closing-mark" />
            <h2 id="landing-closing-title" className="landing-h2" {...reveal(0)}>{t(locale, "landing.closing.title")}</h2>
            <p className="landing-body" {...reveal(1)}>{t(locale, "landing.closing.body")}</p>
            <div {...reveal(2)}><SignUpCta locale={locale} label="landing.closing.cta" /></div>
          </div>
        </section>
      </main>

      <LandingFooter locale={locale} />
      <RevealOnScroll />
    </div>
  );
}
