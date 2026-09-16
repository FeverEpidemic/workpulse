import { RecordUnavailable } from "@/components/ui/record-unavailable";
import { getRequestLocale } from "@/server/auth/context";

export default async function NotFoundPage() {
  const locale = await getRequestLocale();
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <RecordUnavailable locale={locale} />
    </main>
  );
}
