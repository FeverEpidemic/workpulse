export default function CvLoading() {
  return (
    <section className="space-y-5" aria-busy="true">
      <div className="app-card h-20 animate-pulse" />
      <div className="cv-layout">
        <div className="space-y-4">
          <div className="app-card h-40 animate-pulse" />
          <div className="app-card h-64 animate-pulse" />
        </div>
        <div className="app-card h-96 animate-pulse" />
      </div>
    </section>
  );
}
