import { parseInline, parseMarkdown } from '../src/components/markdown';
import { legal } from '../src/legal';

describe('legal markdown reader', () => {
  it('reads bold and code inline', () => {
    expect(parseInline('a **b** `c` d')).toEqual([
      { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', code: true }, { text: ' d' },
    ]);
  });

  it('reads headings, lists, paragraphs and tables', () => {
    const blocks = parseMarkdown('# Title\n\nSome text\ncontinues.\n\n- one\n- two\n\n1. first\n\n| A | B |\n|---|---|\n| 1 | **2** |\n');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'bullet', 'bullet', 'numbered', 'table']);
    expect(blocks[1]).toEqual({ type: 'paragraph', content: [{ text: 'Some text continues.' }] });
    const table = blocks[5];
    expect(table.type === 'table' && table.rows).toEqual([[[{ text: '1' }], [{ text: '2', bold: true }]]]);
  });

  it('never turns text into links or markup', () => {
    const blocks = parseMarkdown('[click](http://evil.example) <b>x</b>');
    expect(blocks).toEqual([{ type: 'paragraph', content: [{ text: '[click](http://evil.example) <b>x</b>' }] }]);
  });

  it.each(Object.keys(legal))('reads the whole %s document', (key) => {
    const d = legal[key as keyof typeof legal];
    const blocks = parseMarkdown(d.body);
    expect(blocks.length).toBeGreaterThan(5);
    expect(blocks.some((b) => b.type === 'heading')).toBe(true);
    // nothing is dropped: every table row of the source ends up in a table block
    const sourceRows = d.body.split('\n').filter((l) => l.trim().startsWith('|') && !/^\|?\s*:?-{2,}/.test(l.trim())).length;
    const parsedRows = blocks.reduce((n, b) => n + (b.type === 'table' ? 1 + b.rows.length : 0), 0);
    expect(parsedRows).toBe(sourceRows);
  });
});
