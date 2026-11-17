import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Yasal metinler için güvenli markdown (ham HTML işlenmez). */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed [&_a]:font-medium [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:border-l-2 [&_blockquote]:border-brand [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-4 [&_h3]:font-medium [&_li]:ml-4 [&_ol]:list-decimal [&_table]:w-full [&_table]:text-xs [&_strong]:font-semibold [&_td]:border-t [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
