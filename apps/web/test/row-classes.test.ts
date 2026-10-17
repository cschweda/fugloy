import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { Row, SpanKind } from '@fugloy/disasm';
import { spanClass } from '../app/utils/row-classes';
import ListingRow from '../app/components/listing/ListingRow.vue';

const KINDS: SpanKind[] = ['mnemonic', 'register', 'condition', 'number', 'label', 'table', 'string', 'punct', 'directive'];

const render = (row: Row): Promise<string> => renderToString(createSSRApp({ render: () => h(ListingRow, { row, cursor: false, selected: false }) }));

describe('spanClass', () => {
  it('gives each of the nine span kinds its own class', () => {
    const classes = KINDS.map(spanClass);
    expect(new Set(classes).size).toBe(KINDS.length);
    for (const c of classes) expect(c).toMatch(/^fg-tok-[a-z]+$/);
  });
});

describe('ListingRow', () => {
  const row: Row = {
    kind: 'code',
    addr: 0x499f,
    bytes: [0xcd, 0x9e, 0x4b],
    spans: [
      { text: 'CALL', kind: 'mnemonic' },
      { text: ' ', kind: 'punct' },
      { text: 'SUB_4B9E', kind: 'label', target: 0x4b9e },
    ],
    comment: 'entry',
  };

  it('renders a label span as a focusable link to its target', async () => {
    const html = await render(row);
    expect(html).toMatch(/<a [^>]*href="#\$4B9E"[^>]*data-target="19358"[^>]*>SUB_4B9E<\/a>/);
    expect(html).toContain('class="fg-tok-label fg-follow"');
  });

  it('renders a table span as a focusable link, and other spans as plain text', async () => {
    const html = await render({
      kind: 'code',
      addr: 0x499f,
      bytes: [0xd3, 0xec],
      spans: [
        { text: 'OUT', kind: 'mnemonic' },
        { text: ' ', kind: 'punct' },
        { text: '(', kind: 'punct' },
        { text: 'MODEPORT', kind: 'table', target: 0xec },
        { text: '),', kind: 'punct' },
        { text: 'A', kind: 'register' },
      ],
    });
    expect(html).toMatch(/<a [^>]*href="#\$00EC"[^>]*data-target="236"[^>]*>MODEPORT<\/a>/);
    expect(html).toContain('<span class="fg-tok-register">A</span>');
    expect(html.match(/<a /g)?.length).toBe(1);
  });

  it('shows the address, bytes, text, and comment columns as the CLI prints them', async () => {
    const html = await render(row);
    expect(html).toContain('>499F<');
    expect(html).toContain('>CD 9E 4B<');
    expect(html).toContain('; entry');
  });
});
