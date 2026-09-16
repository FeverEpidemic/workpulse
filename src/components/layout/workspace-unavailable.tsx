import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { t, type Locale, type MessageKey } from "@/i18n/messages";

export function WorkspaceUnavailable({
  titleKey,
  locale,
}: {
  titleKey: MessageKey;
  locale: Locale;
}) {
  return (
    <section className="space-y-5">
      <header className="space-y-3">
        <Badge>{t(locale, "workspace.notAvailable")}</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">{t(locale, titleKey)}</h1>
      </header>
      <EmptyState
        title={t(locale, "workspace.emptyTitle")}
        description={t(locale, "workspace.unavailableDescription")}
      />
    </section>
  );
}
