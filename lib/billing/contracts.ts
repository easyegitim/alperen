import "server-only";

import { getLegalDoc } from "@/lib/legal/docs";
import { PLANS, formatTry, type PlanId } from "@/lib/config/plans";
import { markdownToBasicHtml } from "@/lib/email/resend";

export type ContractProduct = PlanId | "one_time_report";
const PERIOD_TR: Record<ContractProduct, string> = { weekly: "hafta", monthly: "ay", yearly: "yıl", week_pass: "7 gün (tek seferlik)", one_time_report: "tek seferlik (bir analiz)" };
const NAME_TR: Record<ContractProduct, string> = { weekly: "Haftalık", monthly: "Aylık", yearly: "Yıllık", week_pass: "7 Günlük Geçiş", one_time_report: "Tek Seferlik Rapor" };

/**
 * Mesafeli satış sözleşmesi ve ön bilgilendirme formu alıcı bilgisi ve fiyatla doldurulur (SPEC 15.3).
 * one_time_report fiyatı env'den gelir (lib/config/plans.ts getProductPrice); çağıran priceTry verir.
 */
export async function renderContracts(input: { plan: ContractProduct; priceTry?: number; buyerName: string; buyerEmail: string; buyerAddress: string }) {
  const [sale, info] = await Promise.all([getLegalDoc("mesafeli-satis"), getLegalDoc("on-bilgilendirme")]);
  const vars: Record<string, string> = {
    buyerName: input.buyerName,
    buyerEmail: input.buyerEmail,
    buyerAddress: input.buyerAddress,
    planName: NAME_TR[input.plan],
    price: formatTry(input.priceTry ?? (input.plan === "one_time_report" ? 0 : PLANS[input.plan].priceTry)),
    period: PERIOD_TR[input.plan],
  };
  const fill = (md: string) => md.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
  return {
    saleVersion: sale.version,
    infoVersion: info.version,
    html: `<h1>${sale.title}</h1>${markdownToBasicHtml(fill(sale.body))}<hr/><h1>${info.title}</h1>${markdownToBasicHtml(fill(info.body))}`,
    saleMarkdown: fill(sale.body),
    infoMarkdown: fill(info.body),
  };
}
