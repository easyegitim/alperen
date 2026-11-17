import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/legal/Markdown";
import { getLegalDoc, isLegalSlug, listLegalSlugs } from "@/lib/legal/docs";

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await listLegalSlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/yasal/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  if (!isLegalSlug(slug)) return {};
  const doc = await getLegalDoc(slug);
  return { title: doc.title };
}

/** F16: content/legal/*.md; sürüm ve tarih; development'ta "Avukat onayı bekleniyor" bandı. */
export default async function LegalPage({ params }: PageProps<"/yasal/[slug]">) {
  const { slug } = await params;
  if (!isLegalSlug(slug)) notFound();
  const [doc, t] = await Promise.all([getLegalDoc(slug), getTranslations("legal")]);
  const showPendingBanner = process.env.NODE_ENV === "development" && !doc.approved;

  return (
    <article className="mx-auto w-full max-w-3xl space-y-5 px-4 pt-8 pb-14">
      {showPendingBanner ? (
        <p role="status" className="rounded-2xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
          {t("pendingApproval")}
        </p>
      ) : null}
      <header className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">{doc.title}</h1>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-brand-soft px-2.5 text-[11px] font-semibold text-brand">
            {t("version", { version: doc.version })}
          </span>
          <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-[11px] font-medium text-muted-foreground">
            {t("updatedAt", { date: doc.updatedAt })}
          </span>
        </div>
      </header>
      <div className="rounded-2xl border bg-card p-5 shadow-card">
        <Markdown>{doc.body}</Markdown>
      </div>
    </article>
  );
}
