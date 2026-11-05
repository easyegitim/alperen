// Paylaşım kartı Skia ile cihazda çizilir ve sistem paylaşım sayfasına verilir; sunucuya gitmez (SPEC F10).
import { matchFont, PaintStyle, Skia, type SkImage } from "@shopify/react-native-skia";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { SHARE_RULES, type ShareCardSpec } from "@/lib/share/spec";
import { shareCardLayout, shareLayoutFromSpec, type Layout, type ShareCardInput } from "./layout";

const FAMILY = Platform.select({ ios: "Helvetica", android: "sans-serif", default: "sans-serif" });

function font(size: number, bold: boolean) {
  return matchFont({ fontFamily: FAMILY, fontSize: size, fontWeight: bold ? "bold" : "normal" });
}

/** Kartı çizer; JPEG base64 döner. photo: önceden yüklenmiş Skia görüntüsü (isteğe bağlı). */
export function renderShareCardBase64(input: ShareCardInput, photo: SkImage | null): string {
  return paintLayout(shareCardLayout({ ...input, hasPhoto: Boolean(photo) }), photo);
}

function paintLayout(layout: Layout, photo: SkImage | null): string {
  const surface = Skia.Surface.Make(layout.w, layout.h);
  if (!surface) throw new Error("surface");
  const canvas = surface.getCanvas();
  const bg = Skia.Paint();
  bg.setColor(Skia.Color("#0a0a0a"));
  canvas.drawRect(Skia.XYWHRect(0, 0, layout.w, layout.h), bg);

  if (photo && layout.photo) {
    const p = layout.photo;
    // kapak kırpımı: kısa kenara göre ölçekle, ortala
    const scale = Math.max(p.w / photo.width(), p.h / photo.height());
    const sw = p.w / scale, sh = p.h / scale;
    const sx = (photo.width() - sw) / 2, sy = (photo.height() - sh) / 2;
    const paint = Skia.Paint();
    canvas.save();
    canvas.clipRRect(Skia.RRectXY(Skia.XYWHRect(p.x, p.y, p.w, p.h), 48, 48), 1, true);
    canvas.drawImageRect(photo, Skia.XYWHRect(sx, sy, sw, sh), Skia.XYWHRect(p.x, p.y, p.w, p.h), paint);
    canvas.restore();
  }

  for (const b of layout.bars) {
    const track = Skia.Paint();
    track.setColor(Skia.Color("#262626"));
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(b.x, b.y, b.w, b.h), 8, 8), track);
    const fill = Skia.Paint();
    fill.setColor(Skia.Color("#e5e5e5"));
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(b.x, b.y, Math.max(16, b.w * b.ratio), b.h), 8, 8), fill);
  }

  for (const t of layout.texts) {
    const f = font(t.size, t.weight === "bold");
    const paint = Skia.Paint();
    paint.setStyle(PaintStyle.Fill);
    paint.setColor(Skia.Color(t.color));
    paint.setAntiAlias(true);
    const width = f.measureText(t.text).width;
    const x = t.align === "center" ? t.x - width / 2 : t.x;
    canvas.drawText(t.text, x, t.y, paint, f);
  }

  const image = surface.makeImageSnapshot();
  return image.encodeToBase64(undefined, 90);
}

/** Base64 JPEG'i önbelleğe yazar ve paylaşım sayfasını açar; sonra dosyayı siler. */
export async function shareBase64Jpeg(base64: string, title: string): Promise<"shared" | "unavailable"> {
  if (!(await Sharing.isAvailableAsync())) return "unavailable";
  const file = new File(Paths.cache, `aura-kart-${Date.now()}.jpg`);
  file.write(base64, { encoding: "base64" });
  try {
    await Sharing.shareAsync(file.uri, { mimeType: "image/jpeg", dialogTitle: title, UTI: "public.jpeg" });
  } finally {
    try {
      file.delete();
    } catch {
      // önbellek; sistem temizler
    }
  }
  return "shared";
}

export async function loadSkiaImage(uri: string): Promise<SkImage | null> {
  const data = await Skia.Data.fromURI(uri);
  return Skia.Image.MakeImageFromEncoded(data);
}

/**
 * v2 spec kartı (KB §8; CONTRACTS_V2 S3.3.1): çağıran shareSpecIssues ile doğrular (reklam kartında fotoğraf yok — K17;
 * berber kartı fotoğrafsız). Çizim aynı Skia yolu; JPEG base64 döner.
 */
export function renderShareSpecBase64(spec: ShareCardSpec, photo: SkImage | null): string {
  const allowPhoto = SHARE_RULES.photoAllowed(spec.kind, spec.audience);
  const layout = shareLayoutFromSpec(spec, Boolean(photo) && allowPhoto);
  return paintLayout(layout, allowPhoto ? photo : null);
}
