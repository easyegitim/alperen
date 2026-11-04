"use client";

import { Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { track } from "@/lib/analytics";
import { APP_NAME, APP_URL } from "@/lib/config/app";
import { SUB_KEYS_V2, type SubKey } from "@/lib/config/teaser";
import { renderShareCard, shareOrDownload } from "@/lib/share/card";
import { SHARE_RULES, shareFileName, shareSpecIssues, type ShareCardFormat, type ShareCardKind, type ShareCardSpec } from "@/lib/share/spec";

export type StrongestInfo = { sub: SubKey; label: string; line: string };

type Props = {
  overall: number;
  potential: number | null;
  /** En çok 3 alt skor (en yüksekler); key verilmezse sıra anahtarı yalnız tipi doldurur. */
  subs: { key?: SubKey; label: string; value: number }[];
  /** Raporun en güçlü alt alanı (strongestSub + ExplanationV2.held[0]); yoksa "En güçlü yanın" kartı sunulmaz. */
  strongest?: StrongestInfo | null;
};

export const APP_HOST = APP_URL.replace(/^https?:\/\//, "");

/**
 * Paylaşım kartı (F10 → Faz 6, KB §8 R2-Ö3): varsayılan skor kartı; isteğe bağlı "En güçlü yanın: …" (sayı yok).
 * Fotoğraf eklemek kullanıcı seçimi (varsayılan kapalı), cihazdan seçilir ve yalnız kişisel paylaşımda mümkündür (K17:
 * audience "marketing" bu arayüzden üretilmez). Kart cihazda üretilir; sunucuya gitmez.
 */
export function ShareCardButton({ overall, potential, subs, strongest = null }: Props) {
  const t = useTranslations("share");
  const tv = useTranslations("share.v2");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ShareCardKind>("score");
  const [withPhoto, setWithPhoto] = useState(false);
  const [format, setFormat] = useState<ShareCardFormat>("story");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<ImageBitmap | null>(null);
  const kinds: ShareCardKind[] = strongest ? ["score", "strongest"] : ["score"];
  const photoAllowed = SHARE_RULES.photoAllowed(kind, "personal");

  async function onFile(file?: File) {
    if (!file) return;
    try {
      photo?.close();
      setPhoto(await createImageBitmap(file, { imageOrientation: "from-image" }));
    } catch {
      toast.error(t("photoError"));
    }
  }

  function buildSpec(): ShareCardSpec {
    const common = { format, audience: "personal" as const, appName: APP_NAME, url: APP_HOST, disclaimer: tv("disclaimer"), withPhoto: photoAllowed && withPhoto && photo !== null };
    if (kind === "strongest" && strongest) return { ...common, kind: "strongest", sub: strongest.sub, title: tv("strongestTitle", { area: strongest.label }), line: strongest.line.slice(0, SHARE_RULES.maxLineChars) };
    return { ...common, kind: "score", overall, potential, subs: subs.slice(0, 3).map((s, i) => ({ key: s.key ?? SUB_KEYS_V2[i] ?? SUB_KEYS_V2[0], label: s.label, value: s.value })) };
  }

  async function create() {
    setBusy(true);
    try {
      const spec = buildSpec();
      if (shareSpecIssues(spec).length) {
        toast.error(tv("invalid"));
        return;
      }
      const blob = await renderShareCard(spec, spec.withPhoto ? photo : null, { overall: tv("labels.overall"), potential: tv("labels.potential") });
      track("share_card_created", { withPhoto: spec.withPhoto, kind: spec.kind });
      const r = await shareOrDownload(blob, shareFileName(spec.kind), t("shareTitle"));
      toast.success(r === "shared" ? tv("shared") : tv("downloaded"));
      setOpen(false);
    } catch {
      toast.error(tv("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <Share2 aria-hidden="true" /> {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tv("title")}</DialogTitle>
            <DialogDescription>{tv(`kindHint.${kind}`)}</DialogDescription>
          </DialogHeader>
          {kinds.length > 1 ? (
            <Tabs value={kind} onValueChange={(v) => setKind(v as ShareCardKind)}>
              <TabsList className="w-full" aria-label={tv("kindAria")}>
                {kinds.map((k) => (
                  <TabsTrigger key={k} value={k} className="flex-1">
                    {tv(`kinds.${k}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}
          <Tabs value={format} onValueChange={(v) => setFormat(v as ShareCardFormat)}>
            <TabsList className="w-full" aria-label={tv("formatAria")}>
              <TabsTrigger value="story" className="flex-1">
                {t("story")}
              </TabsTrigger>
              <TabsTrigger value="square" className="flex-1">
                {t("square")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {photoAllowed ? (
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <label htmlFor="share-photo" className="text-sm">
                {tv("photoToggle")}
                <span className="block text-xs text-muted-foreground">{tv("photoHint")}</span>
              </label>
              <Switch
                id="share-photo"
                checked={withPhoto}
                onCheckedChange={(v) => {
                  setWithPhoto(v);
                  if (v && !photo) fileRef.current?.click();
                }}
              />
            </div>
          ) : null}
          {photoAllowed && withPhoto ? (
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
              {photo ? t("changePhoto") : t("pickPhoto")}
            </Button>
          ) : null}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button onClick={create} disabled={busy || (photoAllowed && withPhoto && !photo)}>
            {tv("create")}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">{tv("deviceNote")}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
