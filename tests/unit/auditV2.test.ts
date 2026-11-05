import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AUDIT_JSON_SCHEMA, AUDIT_MAX_TOKENS, ClaudeAuditProvider } from "@/lib/ai/audit";
import { AUDIT_SYSTEM, buildAuditUserText } from "@/lib/ai/prompts/audit.v1";
import { getAiEnv } from "@/lib/config/ai.server";
import { auditTexts, type AuditText } from "@/lib/score/engine/audit";
import { FakeAudit } from "../helpers/engineV2Fixtures";

// Denetim geçişi (PLAN_V2 3f): yeniden yazım uygulanır → güvenlik taraması → takılan cümle şablona düşer; rapor boş gitmez.

const T: AuditText[] = [
  { path: "letter", text: "En güçlü yanın cilt dokun.", fallback: "ŞABLON-MEKTUP" },
  { path: "regions.nose.seen", text: "Burnun basık burun yapısında.", fallback: "ŞABLON-BURUN" },
  { path: "explanations.skin.lowered[0]", text: "Puanın 6,2.", fallback: "" },
  { path: "seeProfessional", text: "Rozasea olabilir.", fallback: "", allowMaybeDiagnosis: true },
];

describe("auditTexts", () => {
  it("sağlayıcı yok: yalnız güvenlik taraması; takılan cümle şablona, boş şablonlu satır boş kalır", async () => {
    const ac = new AbortController();
    const r = await auditTexts(T, { skin: 6.2 }, null, { signal: ac.signal, timeoutMs: 1000 });
    expect(r.summary.audited).toBe(false);
    expect(r.texts.map((t) => t.text)).toEqual(["En güçlü yanın cilt dokun.", "ŞABLON-BURUN", "", "Rozasea olabilir."]);
    expect(r.summary.fallbacks).toBe(2);
    expect(r.summary.flags).toEqual(expect.arrayContaining(["structural_critique", "score_in_text"]));
  });
  it("boş aday metin şablona düşer ama 'fallback' sayılmaz (is_fallback yalnız gerçek filtrelemede)", async () => {
    const ac = new AbortController();
    const r = await auditTexts([{ path: "observations.other[0]", text: "   ", fallback: "" }, { path: "letter", text: "", fallback: "ŞABLON" }], {}, null, { signal: ac.signal, timeoutMs: 1000 });
    expect(r.texts.map((t) => t.text)).toEqual(["", "ŞABLON"]);
    expect(r.summary.fallbacks).toBe(0);
    expect(r.summary.flags).toEqual([]);
  });
  it("yeniden yazım uygulanır (yalnız bilinen yol, boş olmayan); temiz yeniden yazım şablona düşmez", async () => {
    const p = new FakeAudit({
      rewrites: [
        { path: "regions.nose.seen", text: "Burun yapısal bir özellik; bakım planının konusu değil." },
        { path: "explanations.skin.lowered[0]", text: "Puanı T bölgesindeki parlama aşağı çekti." },
        { path: "bilinmeyen.yol", text: "x" },
        { path: "letter", text: "   " },
      ],
      notes: ["iki cümle düzeltildi"],
    });
    const r = await auditTexts(T, { skin: 6.2 }, p, { signal: new AbortController().signal, timeoutMs: 1000 });
    expect(p.calls).toBe(1);
    expect(p.lastItems).toHaveLength(4);
    expect(r.summary).toMatchObject({ audited: true, rewrites: 2, fallbacks: 0, flags: [] });
    expect(r.texts[1].text).toBe("Burun yapısal bir özellik; bakım planının konusu değil.");
    expect(r.texts[2].text).toBe("Puanı T bölgesindeki parlama aşağı çekti.");
    expect(r.texts[0].text).toBe("En güçlü yanın cilt dokun.");
  });
  it("kuralı hâlâ bozan yeniden yazım da şablona düşer; sağlayıcı hatası denetimi atlar (reason)", async () => {
    const bad = new FakeAudit({ rewrites: [{ path: "regions.nose.seen", text: "Burnun orantısız." }], notes: [] });
    const r = await auditTexts(T, {}, bad, { signal: new AbortController().signal, timeoutMs: 1000 });
    expect(r.texts[1].text).toBe("ŞABLON-BURUN");
    const broken = new FakeAudit(null, "timeout");
    const r2 = await auditTexts(T, {}, broken, { signal: new AbortController().signal, timeoutMs: 1000 });
    expect(r2.summary).toMatchObject({ audited: false, reason: "timeout", rewrites: 0 });
    expect(r2.texts[0].text).toBe("En güçlü yanın cilt dokun.");
  });
});

describe("ClaudeAuditProvider isteği (gerçek SDK, sahte fetch)", () => {
  function mocked(body: unknown, status = 200) {
    const calls: Record<string, unknown>[] = [];
    const client = new Anthropic({
      apiKey: "test-key",
      maxRetries: 0,
      fetch: async (_i: string | URL | Request, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      },
    });
    return { p: new ClaudeAuditProvider({ env: getAiEnv({ CLAUDE_AUDIT_EFFORT: "low", CLAUDE_FALLBACKS: "off" }), client }), calls };
  }
  const msg = (text: string | null, over: Record<string, unknown> = {}) => ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "thinking", thinking: "", signature: "s" }, ...(text === null ? [] : [{ type: "text", text, citations: null }])],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: { input_tokens: 800, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, iterations: null },
    ...over,
  });
  it("önbellekli sistem, düşük efor, JSON şema; örnekleme parametresi yok; yanıt ayrıştırılır", async () => {
    const { p, calls } = mocked(msg(JSON.stringify({ rewrites: [{ path: "letter", text: "a" }], notes: [] })));
    const r = await p.audit({ scores: { skin: 6.2 }, items: [{ path: "letter", text: "x" }] }, new AbortController().signal, 1000);
    expect(r.out?.rewrites).toEqual([{ path: "letter", text: "a" }]);
    expect(r.usage.input).toBe(800);
    const body = calls[0];
    for (const k of ["temperature", "top_p", "top_k", "thinking", "tool_choice", "fallbacks"]) expect(body).not.toHaveProperty(k);
    expect(body.max_tokens).toBe(AUDIT_MAX_TOKENS);
    expect(body.system).toEqual([{ type: "text", text: AUDIT_SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }]);
    expect(body.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: AUDIT_JSON_SCHEMA } });
    expect(String((body.messages as { content: string }[])[0].content)).toBe(buildAuditUserText({ scores: { skin: 6.2 }, items: [{ path: "letter", text: "x" }] }));
  });
  it("refusal / max_tokens / bozuk JSON / HTTP hatası → out null, neden dolu; fırlatmaz", async () => {
    for (const [body, status, reason] of [
      [msg("{", { stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } }), 200, "refusal"],
      [msg("{", { stop_reason: "max_tokens" }), 200, "max_tokens"],
      [msg("{bozuk"), 200, "schema"],
      [{ type: "error", error: { type: "api_error", message: "x" } }, 500, "transient"],
    ] as const) {
      const { p } = mocked(body, status);
      const r = await p.audit({ scores: {}, items: [] }, new AbortController().signal, 1000);
      expect(r.out).toBeNull();
      expect(r.reason).toBe(reason);
    }
  });
});
