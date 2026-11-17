import "server-only";

// Resend REST: POST https://api.resend.com/emails { from, to, subject, html }. Anahtar yoksa sessizce atlanır (geliştirme).
export type EmailInput = { to: string; subject: string; html: string };

export async function sendEmail(input: EmailInput): Promise<{ sent: boolean; id?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || `Aura <no-reply@${new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").hostname}>`;
  if (!apiKey) return { sent: false };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html }),
  });
  if (!res.ok) throw new Error(`resend_failed_${res.status}`);
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { sent: true, id: data.id };
}

/** Çok küçük markdown → HTML (başlık, paragraf, liste, kalın). Yasal metin e-postaları için yeterli. */
export function markdownToBasicHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*[-*]\s+(.*)$/) || line.match(/^\s*\d+\.\s+(.*)$/);
    if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(esc(li[1]))}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) out.push(`<h${h[1].length + 1}>${inline(esc(h[2]))}</h${h[1].length + 1}>`);
    else if (line.startsWith("|")) out.push(`<pre>${esc(line)}</pre>`);
    else if (line.startsWith(">")) out.push(`<blockquote>${inline(esc(line.slice(1).trim()))}</blockquote>`);
    else out.push(`<p>${inline(esc(line))}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
  function inline(s: string) {
    return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }
}
