"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiClientError, postJson } from "@/lib/api/client";
import type { DoctorItem, DoctorStatus } from "@/lib/doctor/types";

type Row = { id: string; user_id: string; analysis_id: string; status: DoctorStatus; ai_items: DoctorItem[]; physician_items: DoctorItem[] | null; physician_notes: string | null; created_at: string; reviewed_at: string | null };

/** Hekim kuyruğu: taslağı gör, değiştirerek onayla ya da reddet (POST /api/doctor/review; sunucu doz/marka/satış/alan kuralını uygular). */
export function DoctorQueue() {
  const t = useTranslations("doctor.admin");
  const [status, setStatus] = useState<DoctorStatus>("draft");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [edits, setEdits] = useState<Record<string, { items: DoctorItem[]; notes: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    // ExpertDirectory kalıbı: setState yalnız ağ cevabı geldiğinde; iptal bayrağıyla eski cevap yazılmaz.
    let cancelled = false;
    fetch(`/api/doctor/review?status=${status}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Row[]) => {
        if (cancelled) return;
        setRows(data);
        setEdits(Object.fromEntries(data.map((d) => [d.id, { items: d.physician_items ?? d.ai_items, notes: d.physician_notes ?? "" }])));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [status, reload]);

  async function decide(id: string, decision: "physician_reviewed" | "rejected") {
    setBusy(id);
    try {
      const e = edits[id] ?? { items: [], notes: "" };
      const r = await postJson<{ ok: boolean; issues: { index: number; issue: string }[] }>("/api/doctor/review", { id, decision, items: decision === "rejected" ? [] : e.items, notes: e.notes || undefined });
      if (!r?.ok) toast.error(`${t("rejectedByRule")}: ${r?.issues.map((i) => `#${i.index + 1} ${i.issue}`).join(", ") || "-"}`);
      else toast.success(t(decision));
      setReload((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("error"));
    } finally {
      setBusy(null);
    }
  }

  const setItem = (id: string, i: number, patch: Partial<DoctorItem>) =>
    setEdits((e) => {
      const cur = e[id] ?? { items: [], notes: "" };
      const items = cur.items.map((it, j) => (j === i ? { ...it, ...patch } : it));
      return { ...e, [id]: { ...cur, items } };
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("queueTitle")}>
        {(["draft", "physician_reviewed", "delivered", "rejected"] as const).map((s) => (
          <Button key={s} role="tab" aria-selected={status === s} variant={status === s ? "default" : "outline"} size="sm" onClick={() => {
              setRows(null);
              setStatus(s);
            }}>
            {t(s)}
          </Button>
        ))}
      </div>
      {rows === null ? <p className="text-sm text-muted-foreground">…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("noDraft")}</p> : null}
      <ul className="space-y-3">
        {(rows ?? []).map((r) => {
          const e = edits[r.id] ?? { items: r.ai_items, notes: "" };
          const editable = r.status === "draft" || r.status === "physician_reviewed";
          return (
            <li key={r.id} className="space-y-3 rounded-2xl border bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="num">{r.id.slice(0, 8)} · {new Date(r.created_at).toLocaleString("tr-TR")}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{t(r.status)}</span>
              </div>
              <section className="space-y-1">
                <h3 className="text-sm font-semibold">{t("aiDraft")}</h3>
                <ul className="space-y-1 text-sm">
                  {r.ai_items.map((it, i) => (
                    <li key={i} className="rounded-xl bg-muted/60 p-2">
                      <span className="font-medium">{it.methodId}</span> · {it.area}
                      <p className="text-muted-foreground">{it.rationale}</p>
                      <p className="break-all text-[11px] text-muted-foreground">{it.sources.join(" ")}</p>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t("finalItems")}</h3>
                {e.items.map((it, i) => (
                  <div key={i} className="grid gap-2 rounded-xl border p-2">
                    <Input value={it.methodId} disabled={!editable} onChange={(ev) => setItem(r.id, i, { methodId: ev.target.value })} aria-label="methodId" />
                    <textarea className="min-h-20 w-full rounded-xl border border-input bg-card p-2 text-sm" value={it.rationale} disabled={!editable} onChange={(ev) => setItem(r.id, i, { rationale: ev.target.value })} aria-label={t("rationale")} />
                    <Input value={it.sources.join(" ")} disabled={!editable} onChange={(ev) => setItem(r.id, i, { sources: ev.target.value.split(/\s+/).filter(Boolean) })} aria-label={t("sources")} placeholder="https://titck.gov.tr/… https://doi.org/…" />
                  </div>
                ))}
                <label className="block text-sm">
                  <span className="font-medium">{t("notes")}</span>
                  <textarea className="mt-1 min-h-16 w-full rounded-xl border border-input bg-card p-2 text-sm" value={e.notes} disabled={!editable} onChange={(ev) => setEdits((x) => ({ ...x, [r.id]: { ...e, notes: ev.target.value } }))} />
                </label>
              </section>
              {editable ? (
                <div className="flex gap-2">
                  <Button className="flex-1" disabled={busy === r.id} onClick={() => decide(r.id, "physician_reviewed")}>
                    {t("edit")}
                  </Button>
                  <Button className="flex-1" variant="outline" disabled={busy === r.id} onClick={() => decide(r.id, "rejected")}>
                    {t("reject")}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
