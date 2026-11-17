export default function Yukleniyor() {
  return (
    <div role="status" className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <span className="sr-only">Yükleniyor…</span>
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="h-8 w-1/2 rounded-md motion-safe:animate-pulse bg-surface-sunken" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 rounded-md border border-line bg-surface-raised motion-safe:animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
