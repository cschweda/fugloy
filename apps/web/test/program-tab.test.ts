// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { defaultDos, openProgram, programFacts, withHintText } from '@fugloy/disasm';
import type { MoverProposal, TableProposal } from '@fugloy/disasm';
import { exampleById } from '../app/data/examples';
import ProgramTab from '../app/components/side/ProgramTab.vue';
import MemoryMap from '../app/components/side/MemoryMap.vue';
import { memorySegments } from '../app/utils/spec-sheet';

const file = (path: string): Buffer => readFileSync(resolve(import.meta.dirname, '../../../examples', path));

function sea(): { html: Promise<string> } {
  const s = withHintText(
    openProgram(new Uint8Array(file('sea-dragon/seadrg01.cmd')), { name: 'seadrg01.cmd', selection: { machine: 3, dos: defaultDos(3) } }),
    file('sea-dragon/seadrg01.hints').toString('utf8'),
    'seadrg01.hints',
  );
  const props = { facts: programFacts(s.analysis), example: exampleById('sea-dragon'), diagnostics: s.analysis.pass1.diagnostics, proposals: s.analysis.proposals };
  return { html: renderToString(createSSRApp({ render: () => h(ProgramTab, props) })) };
}

describe('ProgramTab on Sea Dragon', () => {
  it('shows the machine verdict, its evidence, the loading facts, and the rights', async () => {
    const html = await sea().html;
    for (const want of [
      'Model III',
      'Writes port $EC (MODEPORT), which only the Model III has.',
      '$5200–$888F',
      '$8881',
      '32K',
      'public domain',
    ]) expect(html, want).toContain(want);
  });

  it('lists its sections in order', async () => {
    const html = await sea().html;
    const at = ['History', 'Machine', 'Loading', 'Talks to', 'Code', 'Analysis'].map((t) => html.indexOf(`>${t}<`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe('MemoryMap', () => {
  it('labels the axis and puts the program in its own segment after ROM and keyboard/video', async () => {
    const html = await renderToString(createSSRApp({ render: () => h(MemoryMap, { loads: [{ start: 0x5200, end: 0x888f }], relocations: [] }) }));
    for (const l of ['$0000', '$4000', '$8000', '$C000', '$FFFF']) expect(html).toContain(l);
    const segs = memorySegments([{ start: 0x5200, end: 0x888f }], []);
    expect(segs.map((s) => s.kind)).toEqual(['rom', 'video', 'free', 'program', 'free']);
    expect(segs.reduce((n, s) => n + s.length, 0)).toBe(0x10000);
  });
});

describe('ProgramTab details', () => {
  const s = withHintText(
    openProgram(new Uint8Array(file('sea-dragon/seadrg01.cmd')), { name: 'seadrg01.cmd', selection: { machine: 3, dos: defaultDos(3) } }),
    file('sea-dragon/seadrg01.hints').toString('utf8'),
    'seadrg01.hints',
  );
  const facts = programFacts(s.analysis);
  const base = { facts, example: exampleById('sea-dragon'), diagnostics: [], proposals: [] };

  it('shows the Model III evidence first, in full, and folds the shared lines into one summary', async () => {
    const html = await renderToString(createSSRApp({ render: () => h(ProgramTab, base) }));
    expect(html.indexOf('Writes port $EC (MODEPORT)')).toBeLessThan(html.indexOf('<details'));
    expect(html).toMatch(/Also uses \d+ things both machines have: [^<]*VIDEO/);
    const open = html.slice(0, html.indexOf('<details'));
    expect(open).not.toContain('which both machines have.');
  });

  it('says where the relocated game is copied to', async () => {
    const html = await renderToString(createSSRApp({ render: () => h(ProgramTab, base) }));
    expect(html).toContain('is copied to');
    expect(html).toContain('$497F');
  });

  it('Apply emits the hint lines of a table proposal and of a mover proposal', async () => {
    const table: TableProposal = { kind: 'table', addr: 0x6000, count: 4, hint: 'block 0:$0010 table 4 2' };
    const move: MoverProposal = { kind: 'move', ldir: 0x7000, src: 0x7100, dst: 0x4000, length: 0x100, hints: ['block 0:$0100 relocate $4000', 'block 0:$0000 entry'] };
    const w = mount(ProgramTab, { props: { ...base, proposals: [table, move] } });
    const buttons = w.findAll('button').filter((b) => b.text() === 'Apply');
    expect(buttons).toHaveLength(2);
    await buttons[0]!.trigger('click');
    await buttons[1]!.trigger('click');
    expect(w.emitted('apply-hint-lines')).toEqual([[['block 0:$0010 table 4 2']], [['block 0:$0100 relocate $4000', 'block 0:$0000 entry']]]);
  });

  it('gives a conflict its own badge style', () => {
    const conflict = { ...facts, machine: { ...facts.machine, fit: 'conflict' as const } };
    const w = mount(ProgramTab, { props: { ...base, facts: conflict } });
    expect(w.findAll('.fg-badge-conflict')).toHaveLength(2);
    expect(w.findAll('.fg-badge-on')).toHaveLength(0);
  });
});
