/**
 * Bileşen çizim testleri (react-test-renderer): plan v2 PlanViewV2 sabit veriden, kart kart açılış (ResultV2View) ve
 * deneme sonucu etiketi. Yerel modüller (Skia, expo-router, paylaşım) taklit; ağ yok.
 */
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { fixtureAnalysis } from "@/tests/fixtures/analysisV2";
import { fixturePlanView } from "@/tests/fixtures/planV2";
import type { PlanViewV2 } from "@/lib/coach/planTypes";
import { ResultV2View } from "@/mobile/src/components/analysis/result/ResultV2View";
import { TryonResult } from "@/mobile/src/components/tryon/TryonResult";
import { PlanViewV2 as PlanViewV2Screen } from "@/mobile/src/features/plan/PlanView";

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}), useFocusEffect: () => undefined, Stack: { Screen: () => null } }));
jest.mock("expo-sharing", () => ({ isAvailableAsync: async () => false, shareAsync: async () => undefined }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }) }));
jest.mock("expo-file-system", () => ({ File: class {}, Paths: { cache: "", document: "" }, Directory: class {} }));
jest.mock("@shopify/react-native-skia", () => {
  const React = jest.requireActual("react");
  const Null = () => null;
  const path = { addArc: () => undefined };
  return {
    Canvas: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Circle: Null,
    Path: Null,
    DashPathEffect: Null,
    PaintStyle: { Fill: 0 },
    matchFont: () => ({ measureText: () => ({ width: 1 }) }),
    Skia: { Path: { Make: () => path, MakeFromSVGString: () => path }, XYWHRect: () => ({}), Matrix: () => ({ scale: () => undefined }), Surface: { Make: () => null }, Paint: () => ({ setColor: () => undefined, setStyle: () => undefined, setAntiAlias: () => undefined }), Color: () => 0, Data: { fromURI: async () => null }, Image: { MakeImageFromEncoded: () => null } },
  };
});
const mockAura = {
  analyses: { get: jest.fn(async () => null) },
  me: { faceShape: jest.fn(async () => ({ override: null })) },
  plan: { create: jest.fn(async (): Promise<{ view: PlanViewV2; hairLossSignal: unknown } | null> => null), get: jest.fn(async () => null) },
  doctor: { get: jest.fn(async () => null), screen: jest.fn(async () => null) },
};
jest.mock("@/mobile/src/features/session/SessionProvider", () => ({ useSession: () => ({ aura: mockAura, api: { post: async () => null }, user: { id: "u1" } }) }));

function texts(r: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === "string") out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object" && "children" in n) walk((n as { children: unknown }).children);
  };
  walk(r.toJSON());
  return out.join(" ");
}

describe("plan v2 ekranı PlanViewV2 sabit veriden çizilir (KB §6.1; PLAN 4d)", () => {
  it("fazlar, öncelik sırası, adım kartları (₺, dk/gün, kanıt), 'Dene' ve berber kartı; doktor katmanı bayrak kapalıyken yok", async () => {
    const view = fixturePlanView();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<PlanViewV2Screen analysisId="11111111-1111-4111-8111-111111111111" initial={{ view, hairLossSignal: "possible" }} />);
    });
    const s = texts(r);
    for (const step of view.plan.steps) expect(s).toContain(step.title);
    expect(s).toContain("Fazlar");
    expect(s).toContain("Öncelik sırası");
    expect(s).toContain("Planın şunlara göre hazırlandı");
    expect(s).toContain("Kanıt");
    expect(s).toContain("Saç yoğunluğu hakkında bir not");
    expect(s).not.toContain("Doktor katmanı");
    expect(s).toContain("Tıbbi tavsiye değildir.");
    const denes = r.root.findAll((n) => n.props.title === "✂ Dene");
    expect(denes.length).toBe(view.plan.steps.filter((x) => x.tryonPresetId).length);
    expect(r.root.findAll((n) => n.props.title === "Berbere göster").length).toBe(view.plan.steps.filter((x) => x.barberSpec).length);
    expect(mockAura.plan.create).not.toHaveBeenCalled();
  });
  it("plan yoksa ilk açılışta üretilir (POST /api/plan)", async () => {
    mockAura.plan.create.mockImplementationOnce(async () => ({ view: fixturePlanView(), hairLossSignal: null }));
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<PlanViewV2Screen analysisId="11111111-1111-4111-8111-111111111111" initial={null} />);
    });
    expect(mockAura.plan.create).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", false);
    expect(texts(r)).toContain("Öncelik sırası");
  });
});

describe("kart kart açılış (KB P#23): sectionsReady'ye göre gerçek içerik / iskelet", () => {
  it("çalışan analizde yalnız hazır bölümler açılır; rapor iskelet kalır; tamamlanınca rapor bölgeleri ve kapanış görünür", async () => {
    const reveal = fixtureAnalysis("reveal");
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<ResultV2View initial={reveal} instantReveal />);
    });
    const s = texts(r);
    expect(s).toContain("5,8"); // genel skor açık
    expect(s).toContain("Cilt görünümü"); // alt skorlar açık
    expect(s).toContain("Hazırlanıyor…"); // rapor/ilk adımlar iskelet
    expect(s).not.toContain("Bölge bölge");
    expect(s).toContain("3 / 6 kart hazır");
    await act(async () => r.unmount()); // yoklama zamanlayıcısı kapanır

    const done = fixtureAnalysis("completed");
    await act(async () => {
      r = create(<ResultV2View initial={done} instantReveal />);
    });
    const s2 = texts(r);
    expect(s2).toContain("Bölge bölge");
    expect(s2).toContain("Kapanış");
    expect(s2).toContain("Tıbbi tavsiye değildir.");
    expect(s2).toContain("Önce odaklan");
    expect(s2).toContain("Bence değil");
    expect(s2).toContain("Dengeli aralık");
    expect(s2).not.toContain("Hazırlanıyor…");
    expect(mockAura.analyses.get).not.toHaveBeenCalled(); // tamamlanmış analizde yoklama yok
    await act(async () => r.unmount());
  });
  it("başarısız analizde hak düşmedi notu ve çekime dön", async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<ResultV2View initial={fixtureAnalysis("failed")} instantReveal />);
    });
    expect(texts(r)).toContain("hakkın düşmedi");
    await act(async () => r.unmount());
  });
});

describe("deneme sonucu: etiket görselin üstünde her zaman görünür (K16)", () => {
  it("önce/sonra görünümünde 'Aura ile oluşturuldu · YZ simülasyonu' yazar", async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<TryonResult result={{ eventId: "e1", mode: "glow_up", title: "İyileşmiş halin", beforeUri: "file:///b.jpg", afterUri: "file:///a.jpg", eyeLineY: 0.4, appliedSteps: [{ id: "st_spf", title: "Günlük SPF" }], qc: null, regenCount: 1 }} onShare={() => undefined} onFlag={() => undefined} flagged={false} onBack={() => undefined} />);
    });
    const s = texts(r);
    expect(s).toContain("Aura ile oluşturuldu · YZ simülasyonu");
    expect(s).toContain("Günlük SPF");
    expect(s).toContain("Bozuk görünüyor");
    expect(s).toContain("Göz hizası");
  });
});
