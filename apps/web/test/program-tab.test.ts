import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { defaultDos, openProgram, programFacts, withHintText } from '@fugloy/disasm';
import { exampleById } from '../app/data/examples';
import ProgramTab from '../app/components/side/ProgramTab.vue';
import MemoryMap from '../app/components/side/MemoryMap.vue';
import { memorySegments } from '../app/utils/spec-sheet';

const file = (path: string): Buffer => readFileSync(fileURLToPath(new URL(`../../../examples/${path}`, import.meta.url)));

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
