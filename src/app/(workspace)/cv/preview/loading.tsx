import { Skeleton } from "@/components/ui/skeleton";

export default function CvPreviewLoading() {
  return (
    <section className="space-y-5" aria-busy="true" data-testid="cv-export-loading">
      <div className="app-card h-20 animate-pulse" />
      <div className="cv-export-layout">
        <div className="space-y-4">
          <div className="app-card space-y-3">
            <Skeleton className="block h-6 w-48" />
            <Skeleton className="block h-4 w-72" />
            <Skeleton className="block h-11 w-40" />
          </div>
          <div className="app-card h-40 animate-pulse" />
        </div>
        <div className="app-card h-96 animate-pulse" />
      </div>
    </section>
  );
}
