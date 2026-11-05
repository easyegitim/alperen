import { assertBodySize, assertJsonBody, assertSameOrigin } from '@/server/chat/request';
import { SSE_HEADERS } from '@/server/chat/sse';
import { executeParentTurn, parentEventStream, prepareParentTurn, toParentDisplay } from '@/server/parent/agent';
import { PARENT_CHAT_BODY_MAX, parseParentChatRequest } from '@/server/parent/request';
import { parentErrorResponse, parentSession } from '@/server/parent/session';

// Veli sohbeti (PLAN-v2 §10, mockup S10b). POST {student_id, conversation_id?, text, new?} → text/event-stream
// (start · text · tool · restart · report · done · error); koç akışıyla aynı biçim. GET ?student_id=&conversation_id=
// → {conversation_id, turn_in_progress, messages[{id, from: parent|assistant, text, reports?}]}.
// Kapılar gövde okunmadan önce: aynı köken (403), yalnız application/json (415), gövde boyu (411/413).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonBody(request);
    assertBodySize(request, PARENT_CHAT_BODY_MAX, 'Mesaj çok uzun. Daha kısa yazmayı deneyin.');
    const body = parseParentChatRequest(await request.json().catch(() => null));
    const { deps } = await parentSession();
    const prepared = await prepareParentTurn(deps, { ...body, studentRef: null });
    // Veli ayrılsa da tur tamamlanır ve kaydedilir (döndüğünde yanıtı görür).
    return new Response(parentEventStream((emit) => executeParentTurn(deps, prepared, emit)), { headers: SSE_HEADERS });
  } catch (err) {
    return parentErrorResponse(err);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const studentId = url.searchParams.get('student_id');
    const conversationId = url.searchParams.get('conversation_id');
    if (!studentId || !UUID.test(studentId) || (conversationId && !UUID.test(conversationId))) {
      return Response.json({ error: { code: 'bad_request', message: 'İstek anlaşılamadı.' } }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const { deps } = await parentSession();
    const h = await deps.store.history({ conversationId, studentId, limit: 80 });
    if (!h) return Response.json({ error: { code: 'forbidden', message: 'Bu öğrencinin bilgilerine erişiminiz yok.' } }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    return Response.json(
      { conversation_id: h.conversation?.id ?? null, turn_in_progress: h.conversation?.turnInProgress ?? false, messages: toParentDisplay(h.messages) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return parentErrorResponse(err);
  }
}
