import type { ReactNode } from "react";
import { NewTabNote } from "./ui";

/**
 * Renders admin-edited text with a deliberately small format — never as HTML, so
 * nothing typed into the editor can run on a public page:
 *   blank line   → new paragraph      ## / ###  → heading
 *   - item       → bulleted list      **text**  → bold
 *   [text](url)  → link, only to https://, http://, mailto: or a path on this site
 * Used on the public pages and for the editor's live preview.
 */

type Block = { kind: "h2" | "h3" | "p"; text: string } | { kind: "ul"; items: string[] };

const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/))/i;
const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "ul", items: list });
    list = [];
  };

  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: heading[1] === "##" ? "h2" : "h3", text: heading[2]! });
      continue;
    }
    const item = line.match(/^[-•]\s+(.+)$/);
    if (item) {
      flushParagraph();
      list.push(item[1]!);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      parts.push(<strong key={n++}>{m[1]}</strong>);
    } else {
      const [label, href] = [m[2]!, m[3]!];
      if (!SAFE_HREF.test(href)) {
        parts.push(`${label} (${href})`);
      } else if (href.startsWith("mailto:")) {
        parts.push(
          <a key={n++} href={href} dir="ltr" className="font-medium text-accent-dark underline underline-offset-4">
            {label}
          </a>,
        );
      } else if (href.startsWith("/")) {
        parts.push(
          <a key={n++} href={href} className="font-medium text-accent-dark underline underline-offset-4">
            {label}
          </a>,
        );
      } else {
        parts.push(
          <a key={n++} href={href} target="_blank" rel="noreferrer" className="font-medium text-accent-dark underline underline-offset-4">
            {label}
            <NewTabNote />
          </a>,
        );
      }
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function RichText({ body }: { body: string }) {
  return (
    <>
      {parseBlocks(body).map((block, i) => {
        if (block.kind === "h2")
          return (
            <h2 key={i} className="mt-2 text-xl font-bold">
              <Inline text={block.text} />
            </h2>
          );
        if (block.kind === "h3")
          return (
            <h3 key={i} className="text-lg font-bold">
              <Inline text={block.text} />
            </h3>
          );
        if (block.kind === "ul")
          return (
            <ul key={i} className="flex list-disc flex-col gap-1 ps-6">
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            <Inline text={block.text} />
          </p>
        );
      })}
    </>
  );
}
