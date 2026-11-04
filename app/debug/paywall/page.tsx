import { notFound } from "next/navigation";
import { PaywallDebug } from "@/components/paywall/PaywallDebug";

/** Yalnız development: v2 paywall önizlemesi (kullanıcı verisi yok). /debug/paywall?step=benefits|products&presentation=male|female|unspecified */
export default async function PaywallDebugPage({ searchParams }: PageProps<"/debug/paywall">) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  const step = sp.step === "products" ? "products" : "benefits";
  const presentation = sp.presentation === "female" ? "female" : sp.presentation === "unspecified" ? "unspecified" : "male";
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <h1 className="sr-only">/debug/paywall</h1>
      <PaywallDebug step={step} presentation={presentation} />
    </div>
  );
}
