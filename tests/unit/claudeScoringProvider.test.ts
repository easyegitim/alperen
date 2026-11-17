import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SERVER_FALLBACK_BETA, SampleError } from "@/lib/ai/observeProvider";
import { ClaudeScoringProvider, SCORE_V2_JSON_SCHEMA, SCORE_V2_MAX_TOKENS, getScoringProviderV2 } from "@/lib/ai/provider";
import { SCORE_V2_SYSTEM, buildScoreV2UserText } from "@/lib/ai/prompts/score.v2";
import { ScoreOutputV2 } from "@/lib/ai/scoreSchema.v2";
import { getAiEnv } from "@/lib/config/ai.server";
import { SUB_KEYS_V2 } from "@/lib/config/teaser";
import { planStepsForPrompt } from "@/lib/score/engine/planSteps";
import { scoreOutput } from "../helpers/engineV2Fixtures";

// Gerçek SDK 1.3.0, sahte fetch. Ağ ve ücretli istek yok; görsel yerine yer tutucu dize.

type Json = Record<string, unknown>;

function message(text: string | null, over: Json = {}, usageOver: Json = {}): Json {
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
    usage: { input_tokens: 5000, output_tokens: 2500, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, iterations: null, ...usageOver },
    ...over,
  };
}

function mocked(body: unknown, status = 200, env: Record<string, string> = {}) {
  const calls: { body: Json; headers: Headers }[] = [];
  const client = new Anthropic({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (_i: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) as Json, headers: new Headers(init?.headers) });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_1" } });
    },
  });
  return { p: new ClaudeScoringProvider({ env: getAiEnv(env), client }), calls };
}

const IMAGES = [
  { view: "front" as const, data: "AAAA" },
  { view: "profile_left" as const, data: "BBBB" },
  { view: "hairline" as const, data: "CCCC" },
];
const TEXT = buildScoreV2UserText({ ageBand: "25_34", presentation: "male", device: null, views: ["front", "profile_left", "hairline"], planSteps: planStepsForPrompt({ hairAllowed: true, beardAllowed: true }) });

describe("ClaudeScoringProvider isteği", () => {
  it("tüm görseller tek kullanıcı mesajında, her biri etiketli; sistem önbellekli; efor medium; JSON şeması; örnekleme yok", async () => {
    const { p, calls } = mocked(message(JSON.stringify(scoreOutput())));
    await p.scoreOnce(IMAGES, TEXT, new AbortController().signal, 1000);
    const body = calls[0].body;
    for (const k of ["temperature", "top_p", "top_k", "thinking", "tool_choice"]) expect(body).not.toHaveProperty(k);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.max_tokens).toBe(SCORE_V2_MAX_TOKENS);
    expect(body.system).toEqual([{ type: "text", text: SCORE_V2_SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }]);
    expect(body.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: SCORE_V2_JSON_SCHEMA } });
    const messages = body.messages as { role: string; content: { type: string; text?: string; source?: { data: string; media_type: string } }[] }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    const c = messages[0].content;
    expect(c.filter((b) => b.type === "image").map((b) => b.source?.data)).toEqual(["AAAA", "BBBB", "CCCC"]);
    expect(c[0]).toEqual({ type: "text", text: "Photo 1: front view" });
    expect(c[2].text).toBe("Photo 2: left side profile");
    expect(c[4].text).toBe("Photo 3: hairline (forehead) view");
    expect(c[c.length - 1]).toEqual({ type: "text", text: TEXT });
    expect(c.every((b) => b.type !== "image" || b.source?.media_type === "image/jpeg")).toBe(true);
    expect(body.fallbacks).toBe("default");
    expect(calls[0].headers.get("anthropic-beta") ?? "").toContain(SERVER_FALLBACK_BETA);
  });
  it("CLAUDE_SCORE_EFFORT ve CLAUDE_FALLBACKS=off okunur", async () => {
    const { p, calls } = mocked(message(JSON.stringify(scoreOutput())), 200, { CLAUDE_SCORE_EFFORT: "high", CLAUDE_FALLBACKS: "off" });
    await p.scoreOnce(IMAGES, TEXT, new AbortController().signal, 1000);
    expect((calls[0].body.output_config as Json).effort).toBe("high");
    expect(calls[0].body).not.toHaveProperty("fallbacks");
  });
  it("giden şemada sınır yok; her nesne additionalProperties:false; enum korunur; 7 alt skor zorunlu", () => {
    const walk = (n: unknown, visit: (o: Json) => void): void => {
      if (Array.isArray(n)) return n.forEach((x) => walk(x, visit));
      if (typeof n !== "object" || n === null) return;
      visit(n as Json);
      Object.values(n).forEach((v) => walk(v, visit));
    };
    walk(SCORE_V2_JSON_SCHEMA, (n) => {
      for (const k of ["$schema", "minimum", "maximum", "minLength", "maxLength", "maxItems"]) expect(n).not.toHaveProperty(k);
      if (n.type === "object") expect(n.additionalProperties).toBe(false);
    });
    const subs = (SCORE_V2_JSON_SCHEMA.properties as Json).subscores as Json;
    expect(subs.required).toEqual([...SUB_KEYS_V2]);
    expect(JSON.stringify(SCORE_V2_JSON_SCHEMA)).toContain('"harsh_or_dim"');
  });
});

describe("ClaudeScoringProvider yanıtı", () => {
  it("geçerli yanıt: şema doğrulanır, kullanım okunur", async () => {
    const { p } = mocked(message(JSON.stringify(scoreOutput({ skin: 6.4 }))));
    const s = await p.scoreOnce(IMAGES, TEXT, new AbortController().signal, 1000);
    expect(s.out.subscores.skin.score).toBe(6.4);
    expect(s.usage).toEqual({ input: 5000, output: 2500, cacheRead: 3000, cacheWrite5m: 0, cacheWrite1h: 0 });
    expect(s.fallbackServed).toBe(false);
    expect(ScoreOutputV2.safeParse(s.out).success).toBe(true);
  });
  it("refusal / max_tokens / bozuk JSON / şema dışı → SampleError (kullanım taşır); 500 → transient; iptal → aborted", async () => {
    const cases: [Json, number, string][] = [
      [message("{", { stop_reason: "refusal", stop_details: { type: "refusal", category: "general_harms", explanation: null } }), 200, "refusal"],
      [message(JSON.stringify(scoreOutput()).slice(0, 50), { stop_reason: "max_tokens" }), 200, "max_tokens"],
      [message("{bozuk"), 200, "schema"],
      [message(JSON.stringify({ ...scoreOutput(), subscores: {} })), 200, "schema"],
      [{ type: "error", error: { type: "api_error", message: "x" } }, 500, "transient"],
      [{ type: "error", error: { type: "invalid_request_error", message: "x" } }, 400, "fatal"],
      [{ type: "error", error: { type: "invalid_request_error", message: "x" } }, 413, "too_large"],
    ];
    for (const [body, status, reason] of cases) {
      const { p } = mocked(body, status);
      const err = await p.scoreOnce(IMAGES, TEXT, new AbortController().signal, 1000).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SampleError);
      expect((err as SampleError).reason).toBe(reason);
      if (status === 200) expect((err as SampleError).usage?.output).toBe(2500);
    }
    const ac = new AbortController();
    ac.abort("early_stop");
    const { p } = mocked(message(JSON.stringify(scoreOutput())));
    const err = await p.scoreOnce(IMAGES, TEXT, ac.signal, 1000).catch((e: unknown) => e);
    expect((err as SampleError).reason).toBe("aborted");
  });
  it("sunucu taraflı yedek usage.iterations'tan algılanır ve model başına faturalanır", async () => {
    const iter = { input_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null };
    const iterations = [
      { type: "message", model: "claude-opus-5-5", output_tokens: 300, ...iter },
      { type: "fallback_message", model: "claude-opus-5", output_tokens: 2500, ...iter },
    ];
    const { p } = mocked(message(JSON.stringify(scoreOutput()), { model: "claude-opus-5" }, { iterations }));
    const s = await p.scoreOnce(IMAGES, TEXT, new AbortController().signal, 1000);
    expect(s.fallbackServed).toBe(true);
    expect(s.model).toBe("claude-opus-5");
    expect(s.usageByModel?.map((m) => m.model).sort()).toEqual(["claude-opus-5", "claude-opus-5-5"]);
  });
  it("getScoringProviderV2 Claude döner; ANTHROPIC_API_KEY yoksa fatal SampleError (sahte başarı yok)", async () => {
    const p = getScoringProviderV2(getAiEnv({}));
    expect(p).toBeInstanceOf(ClaudeScoringProvider);
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const err = await new ClaudeScoringProvider({ env: getAiEnv({}) }).scoreOnce(IMAGES, TEXT, new AbortController().signal, 10).catch((e: unknown) => e);
      expect((err as SampleError).reason).toBe("fatal");
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
