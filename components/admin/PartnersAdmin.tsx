"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { EXPERT_SPECIALTIES } from "@/content/expert-specialties";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api/client";

type Partner = { id: string; name: string; kind: string; specialties: string[]; city: string; institution: string | null; license_no: string; contact_email: string; commercial_model: string; commission_rate: number | null; active: boolean; verified_at: string | null };
type Referral = { id: string; ref_code: string; specialty: string; contact: string; message: string | null; status: string; created_at: string; partner: { name: string } | null; revenue: { amount_try: number; model: string }[] };

const KINDS = ["doctor", "clinic", "dietitian", "psychologist", "dentist"] as const;
const MODELS = ["none", "commission", "listing_fee", "lead_fee"] as const;
const STATUSES = ["sent", "contacted", "booked", "completed", "cancelled"] as const;

async function patch(path: string, body: unknown) {
  const res = await fetch(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** /admin partner yönetimi (SPEC 12.3 madde 5–6): ekle/düzenle/doğrula/aktifleştir, talepler, durum, gelir girişi. Yalnız ADMIN_EMAILS. */
export function PartnersAdmin() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [form, setForm] = useState({ name: "", kind: "doctor", specialties: [] as string[], city: "", institution: "", license_no: "", contact_email: "", commercial_model: "none", commission_rate: "" });
  const [revenue, setRevenue] = useState({ referralId: "", amountTry: "", model: "none", notes: "" });

  async function load() {
    const [p, r] = await Promise.all([fetch("/api/admin/partners").then((x) => (x.ok ? x.json() : [])), fetch("/api/admin/referrals").then((x) => (x.ok ? x.json() : []))]);
    setPartners(p);
    setReferrals(r);
  }
  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await postJson("/api/admin/partners", {
        ...form,
        institution: form.institution || null,
        commission_rate: form.commission_rate ? Number(form.commission_rate) : null,
        active: false,
        verified: false,
      });
      toast.success("Partner eklendi");
      setForm({ ...form, name: "", license_no: "", contact_email: "", institution: "", specialties: [] });
      await load();
    } catch {
      toast.error("Eklenemedi (alanları kontrol et)");
    }
  }

  async function togglePartner(p: Partner, field: "active" | "verified") {
    try {
      await patch(`/api/admin/partners/${p.id}`, field === "active" ? { active: !p.active } : { verified: !p.verified_at });
      await load();
    } catch {
      toast.error("Güncellenemedi");
    }
  }

  async function setStatus(r: Referral, status: string) {
    try {
      await patch(`/api/admin/referrals/${r.id}`, { status });
      await load();
    } catch {
      toast.error("Güncellenemedi");
    }
  }

  async function addRevenue(e: FormEvent) {
    e.preventDefault();
    try {
      await postJson("/api/admin/revenue", { referralId: revenue.referralId, amountTry: Number(revenue.amountTry), model: revenue.model, notes: revenue.notes || undefined });
      toast.success("Gelir kaydı eklendi");
      setRevenue({ referralId: "", amountTry: "", model: "none", notes: "" });
      await load();
    } catch {
      toast.error("Eklenemedi");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Partnerler ({partners.length})</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {partners.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{p.name}</strong> · {p.kind} · {p.specialties.join(", ")} · {p.city} · {p.license_no} · {p.contact_email} · {p.commercial_model}{p.commission_rate ? ` %${p.commission_rate}` : ""}
                </span>
                <span className="flex gap-2">
                  <Button size="sm" variant={p.verified_at ? "default" : "outline"} onClick={() => togglePartner(p, "verified")}>{p.verified_at ? "Doğrulandı" : "Doğrula"}</Button>
                  <Button size="sm" variant={p.active ? "default" : "outline"} onClick={() => togglePartner(p, "active")}>{p.active ? "Aktif" : "Pasif"}</Button>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Partner ekle</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-2 sm:grid-cols-2">
            <Input required placeholder="Ad / kurum adı" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              {EXPERT_SPECIALTIES.map((s) => (
                <label key={s.id} className="flex items-center gap-1 text-xs">
                  <Checkbox checked={form.specialties.includes(s.id)} onCheckedChange={(v) => setForm({ ...form, specialties: v === true ? [...form.specialties, s.id] : form.specialties.filter((x) => x !== s.id) })} />
                  {s.nameTr}
                </label>
              ))}
            </div>
            <Input required placeholder="Şehir" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <Input placeholder="Kurum (isteğe bağlı)" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
            <Input required placeholder="Diploma / tescil no" value={form.license_no} onChange={(e) => setForm({ ...form, license_no: e.target.value })} />
            <Input required type="email" placeholder="İletişim e-postası" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.commercial_model} onChange={(e) => setForm({ ...form, commercial_model: e.target.value })}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select>
            <Input type="number" step="0.01" placeholder="Komisyon % (varsa)" value={form.commission_rate} onChange={(e) => setForm({ ...form, commission_rate: e.target.value })} />
            <Button type="submit" className="sm:col-span-2">Ekle (pasif, doğrulanmamış)</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Talepler ({referrals.length})</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {referrals.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{r.ref_code}</strong> · {r.partner?.name ?? "-"} · {r.specialty} · {r.contact} · {new Date(r.created_at).toLocaleDateString("tr-TR")}
                  {r.message ? <span className="block text-xs text-muted-foreground">{r.message}</span> : null}
                  {r.revenue?.length ? <span className="block text-xs">Gelir: {r.revenue.map((x) => `${x.amount_try} ₺ (${x.model})`).join(", ")}</span> : null}
                </span>
                <select className="h-8 rounded-md border bg-background px-2 text-xs" value={r.status} onChange={(e) => setStatus(r, e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Gelir kaydı</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={addRevenue} className="grid gap-2 sm:grid-cols-4">
            <select required className="h-9 rounded-md border bg-background px-2 text-sm" value={revenue.referralId} onChange={(e) => setRevenue({ ...revenue, referralId: e.target.value })}>
              <option value="">Talep seç</option>
              {referrals.map((r) => <option key={r.id} value={r.id}>{r.ref_code}</option>)}
            </select>
            <Input required type="number" step="0.01" placeholder="Tutar ₺" value={revenue.amountTry} onChange={(e) => setRevenue({ ...revenue, amountTry: e.target.value })} />
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={revenue.model} onChange={(e) => setRevenue({ ...revenue, model: e.target.value })}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select>
            <Input placeholder="Not" value={revenue.notes} onChange={(e) => setRevenue({ ...revenue, notes: e.target.value })} />
            <Button type="submit" className="sm:col-span-4">Kaydet</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
