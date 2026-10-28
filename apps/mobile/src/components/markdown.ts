// Tiny Markdown reader for the bundled legal documents (docs/legal/*.md).
// Supports exactly what those files use: headings, paragraphs, bullet and numbered lists, tables, **bold** and `code`.
// Plain text in, plain data out: no HTML, no links, nothing is ever executed.

export type Inline = { text: string; bold?: boolean; code?: boolean };
export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; content: Inline[] }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'bullet'; content: Inline[] }
  | { type: 'numbered'; marker: string; content: Inline[] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] };

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    out.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], code: true });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSeparator = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', content: parseInline(para.join(' ')) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    let m: RegExpMatchArray | null;
    if (!trimmed) { flush(); continue; }
    if ((m = trimmed.match(/^(#{1,3})\s+(.*)$/))) {
      flush();
      blocks.push({ type: 'heading', level: m[1].length as 1 | 2 | 3, content: parseInline(m[2]) });
    } else if ((m = trimmed.match(/^[-*]\s+(.*)$/))) {
      flush();
      blocks.push({ type: 'bullet', content: parseInline(m[1]) });
    } else if ((m = trimmed.match(/^(\d+\.)\s+(.*)$/))) {
      flush();
      blocks.push({ type: 'numbered', marker: m[1], content: parseInline(m[2]) });
    } else if (trimmed.startsWith('|')) {
      flush();
      const header = cells(trimmed).map(parseInline);
      const rows: Inline[][][] = [];
      let j = i + 1;
      if (j < lines.length && isSeparator(lines[j])) j++;
      for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(cells(lines[j]).map(parseInline));
      blocks.push({ type: 'table', header, rows });
      i = j - 1;
    } else {
      para.push(trimmed);
    }
  }
  flush();
  return blocks;
}
