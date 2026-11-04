import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SERVER_FALLBACK_BETA } from "@/lib/ai/observeProvider";
import { ClaudePlanSelectionProvider, PLAN_SELECTION_JSON_SCHEMA, PLAN_SELECTION_MAX_TOKENS } from "@/lib/ai/provider";
import { getAiEnv } from "@/lib/config/ai.server";

// Gerçek SDK 1.3.0, sahte fetch: ağ ve ücretli çağrı yok. Opus 5.5 kalıbı: thinking ilk blok, stop_reason kontrolü, json_schema.

type Json = Record<string, unknown>;
const SELECTION = { selections: [{ id: "st_spf", phase: "weeks_0_4", region: "skin", rationale: "Parlama için." }, { id: "st_spf", phase: "weeks_0_4", region: "skin", rationale: "tekrar" }] };

function message(text: string | null, over: Json = {}): Json {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "thinking", thinking: "", signature: "sig" }, ...(text === null ? [] : [{ type: "text", text, citations: null }])],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: { input_tokens: 2000, output_tokens: 600, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, iterations: null },
    ...over,
  };
}
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });

function mocked(responses: (() => Response)[], env: Record<string, string> = {}) {
  const calls: Json[] = [];
  const headers: Headers[] = [];
  let i = 0;
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push(JSON.parse(String(init?.body)) as Json);
    headers.push(new Headers(init?.headers));
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return r();
  };
  const client = new Anthropic({ apiKey: "test-key", maxRetries: 0, fetch: fetchImpl });
  return { p: new ClaudePlanSelectionProvider({ env: getAiEnv({ AI_COACH_PROVIDER: "claude", ...env }), client }), calls, headers };
}
const signal = () => new AbortController().signal;

describe("ClaudePlanSelectionProvider (PLAN 4e; CLAUDE SDK notları)", () => {
  it("istek gövdesi: model, json_schema biçimi, efor, önbellekli sistem, sunucu yedeği; temperature/thinking/tool_choice/prefill yok", async () => {
    const { p, calls, headers } = mocked([() => jsonResponse(message(JSON.stringify(SELECTION)))]);
    const r = await p.selectPlan("kullanıcı mesajı", signal(), 10_000);
    const body = calls[0]!;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.max_tokens).toBe(PLAN_SELECTION_MAX_TOKENS);
    expect((body.output_config as Json).format).toEqual({ type: "json_schema", schema: PLAN_SELECTION_JSON_SCHEMA });
    expect((body.output_config as Json).effort).toBe("low");
    expect(body.fallbacks).toBe("default");
    expect(headers[0]!.get("anthropic-beta")).toContain(SERVER_FALLBACK_BETA);
    expect((body.system as Json[])[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect((body.messages as Json[])).toHaveLength(1);
    for (const k of ["temperature", "top_p", "top_k", "thinking", "tool_choice", "tools"]) expect(k in body, k).toBe(false);
    expect(r.out?.selections).toHaveLength(1); // tekrar tekilleşti
    expect(r.model).toBe("claude-opus-5-5");
    expect(r.usage.input).toBe(2000);
    expect(r.estUsd).toBeGreaterThan(0);
  });

  it("refusal, max_tokens, bozuk JSON ve şema dışı yanıtta out null (çağıran belirlenimci yedeğe düşer); hata fırlatmaz", async () => {
    const refusal = mocked([() => jsonResponse(message(null, { stop_reason: "refusal", stop_details: { type: "refusal", category: "general_harms", explanation: "" } }))]);
    expect((await refusal.p.selectPlan("x", signal(), 5000)).reason).toBe("refusal");
    const maxed = mocked([() => jsonResponse(message("{", { stop_reason: "max_tokens" }))]);
    expect((await maxed.p.selectPlan("x", signal(), 5000)).reason).toBe("max_tokens");
    const broken = mocked([() => jsonResponse(message("{not json"))]);
    expect((await broken.p.selectPlan("x", signal(), 5000)).reason).toBe("schema");
    const wrong = mocked([() => jsonResponse(message(JSON.stringify({ selections: [{ id: 1 }] })))]);
    expect((await wrong.p.selectPlan("x", signal(), 5000)).reason).toBe("schema");
    const http = mocked([() => jsonResponse({ type: "error", error: { type: "overloaded_error", message: "x" } }, 529)]);
    const r = await http.p.selectPlan("x", signal(), 5000);
    expect(r.out).toBeNull();
    expect(r.reason).toBe("transient");
  });

  it("CLAUDE_FALLBACKS=off → yedek parametresi yok", async () => {
    const { p, calls } = mocked([() => jsonResponse(message(JSON.stringify(SELECTION)))], { CLAUDE_FALLBACKS: "off" });
    await p.selectPlan("x", signal(), 5000);
    expect("fallbacks" in calls[0]!).toBe(false);
  });
});
