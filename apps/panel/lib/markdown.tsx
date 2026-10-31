// Hukuk metinleri için küçük Markdown görüntüleyici: başlık, paragraf, madde listesi, tablo, alıntı, **kalın**, `kod`.
// HTML üretmez (dangerouslySetInnerHTML yok); metin React düğümü olarak basılır, HTML yorumları atlanır.
// Başlıklar title-3, metin body sınıfıyla (BLUEPRINT §7 onay/page.tsx "legal ton").
import * as React from 'react';

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'code'; text: string };

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i += 1;
      continue;
    }
    if (t.startsWith('```')) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      i += 1;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const h = /^#{1,6}\s+(.+)$/.exec(t);
    if (h) {
      blocks.push({ kind: 'heading', text: h[1].trim() });
      i += 1;
      continue;
    }
    if (t.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      const body = rows.filter((r, idx) => !(idx === 1 && r.every((c) => /^:?-{3,}:?$/.test(c))));
      blocks.push({ kind: 'table', head: body[0] ?? [], rows: body.slice(1) });
      continue;
    }
    if (t.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) q.push(lines[i++].trim().replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', text: q.join(' ') });
      continue;
    }
    const li = /^(-|\d+\.)\s+(.+)$/.exec(t);
    if (li) {
      const ordered = li[1] !== '-';
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(-|\d+\.)\s+(.+)$/.exec(lines[i].trim());
        if (!m || (m[1] !== '-') !== ordered) break;
        items.push(m[2].trim());
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const p = lines[i].trim();
      if (!p || /^(#{1,6}\s|\||>|```|-\s|\d+\.\s)/.test(p)) break;
      para.push(p);
      i += 1;
    }
    blocks.push({ kind: 'para', text: para.join(' ') });
  }
  return blocks;
}

/** **kalın** ve `kod` satır içi biçimleri. */
export function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(m[1] !== undefined ? <strong key={k++}>{m[1]}</strong> : <code key={k++}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = React.useMemo(() => parseBlocks(source), [source]);
  return (
    <div className={className}>
      {blocks.map((b, idx) => {
        switch (b.kind) {
          case 'heading':
            return (
              <h3 key={idx} className="t-title-3">
                <Inline text={b.text} />
              </h3>
            );
          case 'para':
            return (
              <p key={idx} className="t-body">
                <Inline text={b.text} />
              </p>
            );
          case 'quote':
            return (
              <blockquote key={idx} className="t-body">
                <Inline text={b.text} />
              </blockquote>
            );
          case 'code':
            return (
              <pre key={idx} className="t-small">
                {b.text}
              </pre>
            );
          case 'list': {
            const items = b.items.map((it, j) => (
              <li key={j} className="t-body">
                <Inline text={it} />
              </li>
            ));
            return b.ordered ? <ol key={idx}>{items}</ol> : <ul key={idx}>{items}</ul>;
          }
          case 'table':
            return (
              <div key={idx} className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} scope="col">
                          <Inline text={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, n) => (
                          <td key={n}>
                            <Inline text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
