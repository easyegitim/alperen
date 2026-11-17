import { assertBodySize, assertJsonBody, assertSameOrigin, CHAT_BODY_MAX, parseChatRequest } from '@/server/chat/request';
import { chatSession, errorResponse } from '@/server/chat/session';
import { eventStream, SSE_HEADERS } from '@/server/chat/sse';
import { executeTurn, prepareTurn } from '@/server/chat/turn';

// Koç sohbeti (PLAN-v2 §2, §6): POST gövdesi {conversation_id?, text, upload_ids[], mode?, seed?} → text/event-stream
// (start · text · tool · restart · done · error). Kişisel veri: önbelleğe alınmaz, Node çalışma ortamı (pg).
// Kapılar gövde okunmadan önce: aynı köken (403), yalnız application/json (415), gövde boyu (411/413).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonBody(request);
    assertBodySize(request, CHAT_BODY_MAX, 'Mesaj çok uzun. Daha kısa yazmayı dene.');
    const body = parseChatRequest(await request.json().catch(() => null));
    const { deps, student } = await chatSession();
    const prepared = await prepareTurn(deps, { ...body, student });
    // İstemci ayrılsa da tur tamamlanır ve kaydedilir (öğrenci döndüğünde yanıtı görür).
    return new Response(eventStream((emit) => executeTurn(deps, prepared, emit)), { headers: SSE_HEADERS });
  } catch (err) {
    return errorResponse(err);
  }
}
