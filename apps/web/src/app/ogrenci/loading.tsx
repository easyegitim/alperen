export default function Yukleniyor() {
  return (
    <div role="status" className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <span className="sr-only">Yükleniyor…</span>
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="h-8 w-2/3 rounded-md motion-safe:animate-pulse bg-surface-sunken" />
        <div className="h-56 rounded-lg border border-line bg-surface-raised motion-safe:animate-pulse" />
        <div className="flex flex-col gap-3">
          <div className="h-4 w-full rounded-md motion-safe:animate-pulse bg-surface-sunken" />
          <div className="h-4 w-5/6 rounded-md motion-safe:animate-pulse bg-surface-sunken" />
          <div className="h-4 w-2/3 rounded-md motion-safe:animate-pulse bg-surface-sunken" />
        </div>
      </div>
    </div>
  );
}
