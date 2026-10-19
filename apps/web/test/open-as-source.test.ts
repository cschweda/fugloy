// Open as source ✎ (plan 5B, Task 5): a disassembled program becomes a source in Source ✎,
// the zmac text Export ▾ downloads, named after the file, on the program's own model. Assembled,
// it is the program again, byte for byte; where it is not, a one-line note names the first
// address that differs. The last block runs it on the user's Model III ROM (local only).
import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { assemble } from '@fugloy/asm';
import { defaultDos, openProgram, renderSession, withHintText } from '@fugloy/disasm';
import type { Session } from '@fugloy/disasm';
import { createSources } from '../app/composables/useSources';
import { createOpenAsSource } from '../app/composables/useOpenAsSource';
import { firstDifference, reassemblyNote } from '../app/utils/source/reassembly';
import { prepareMachine } from '../app/utils/emulator/boot';
import { createRunner } from '../app/utils/emulator/runner';
import { openStore } from '../app/utils/store';
import type { Store } from '../app/utils/store';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const file = (path: string): Uint8Array => new Uint8Array(readFileSync(resolve(repo, path)));

const opened: Store[] = [];
const open = async (): Promise<Store | null> => {
  const s = await openStore();
  if (s !== null) opened.push(s);
  return s;
};
afterEach(async () => {
  for (const s of opened.splice(0)) s.db.close();
  await new Promise((r) => (indexedDB.deleteDatabase('fugloy').onsuccess = r));
});

/** Sea Dragon as the workbench opens it: the main build, its committed hints, on the Model III. */
function seaDragon(): Session {
  const s = openProgram(file('examples/sea-dragon/seadrg01.cmd'), { name: 'seadrg01.cmd', selection: { machine: 3, dos: defaultDos(3) } });
  return withHintText(s, readFileSync(resolve(repo, 'examples/sea-dragon/seadrg01.hints'), 'utf8'), 'seadrg01.hints');
}

/** A tiny .CMD at $7000: ED 63 34 12 (LD (1234H),HL in its ED form, which zmac assembles as 22 34 12), then JR $. */
function edForm(): Session {
  const data = [0xed, 0x63, 0x34, 0x12, 0x18, 0xfe];
  const cmd = Uint8Array.from([0x01, data.length + 2, 0x00, 0x70, ...data, 0x02, 0x02, 0x00, 0x70]);
  return openProgram(cmd, { name: 'EDFORM.CMD', selection: { machine: 1, dos: 'none' } });
}

describe('Open as source ✎', () => {
  it('Sea Dragon becomes a new source: its zmac text, named seadrg01.z, on the Model III', async () => {
    const sources = createSources({ open });
    const s = seaDragon();
    const src = await sources.fromSession(s);
    expect(src.text).toBe(renderSession(s, 'zmac'));
    expect(src.name).toBe('seadrg01.z');
    expect(src.model).toBe(3);
    expect(sources.current.value?.id).toBe(src.id);
    // A second open is a second source, never a replacement.
    const again = await sources.fromSession(s);
    expect(again.name).toBe('seadrg01-2.z');
    expect(sources.list.value).toHaveLength(2);
  });

  it('takes the model from the program: a Model I program opens on the Model I', async () => {
    const sources = createSources({ open });
    const src = await sources.fromSession(edForm());
    expect(src.model).toBe(1);
    expect(src.name).toBe('EDFORM.z');
  });

  it('assembled with model 3, the source is the program again: the same runs, bytes and entry', () => {
    const s = seaDragon();
    const r = assemble(renderSession(s, 'zmac'), { model: 3 });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
    const want = s.module.image;
    expect(r.image!.runs()).toEqual(want.runs());
    for (const run of want.runs()) expect(r.image!.bytes.subarray(run.start, run.end + 1)).toEqual(want.bytes.subarray(run.start, run.end + 1));
    expect(r.entry).toBe(s.analysis.transfer);
    expect(firstDifference(want, r.image)).toBeNull();
    expect(reassemblyNote(s, renderSession(s, 'zmac'), 3)).toBeNull();
  });

  it('a text that does not reassemble exactly opens with a one-line note naming the first differing address', () => {
    const s = edForm();
    const text = renderSession(s, 'zmac');
    // The emitter writes the ED form as DB (BYTE_EXACT_EXCEPTIONS), so it reassembles; spelled as the instruction, it does not.
    expect(text).toMatch(/DB\t0EDH,63H,34H,12H/);
    expect(reassemblyNote(s, text, 1)).toBeNull();
    const spelled = text.replace(/DB\t0EDH,63H,34H,12H/, 'LD\t(1234H),HL');
    const note = reassemblyNote(s, spelled, 1);
    expect(note).toMatch(/\$7000/);
    expect(note).not.toContain('\n');
    expect(note).toMatch(/\.$/);
  });

  it('a text with an error, or another entry, says so in one line', () => {
    const s = edForm();
    const text = renderSession(s, 'zmac');
    const bad = reassemblyNote(s, text.replace(/\tJR\t/, '\tJRX\t'), 1);
    expect(bad).toMatch(/^.*line \d+.*\.$/);
    expect(bad).not.toContain('\n');
    const moved = reassemblyNote(s, text.replace(/\tEND\t7000H/, '\tEND\t7004H'), 1);
    expect(moved).toMatch(/\$7004.*\$7000|\$7000.*\$7004/);
  });

  it('the shared opener makes the source, asks for Source ✎, and keeps the note for that source', async () => {
    const sources = createSources({ open });
    const s = edForm();
    const spelled = renderSession(s, 'zmac').replace(/DB\t0EDH,63H,34H,12H/, 'LD\t(1234H),HL');
    const opener = createOpenAsSource({ sources, render: () => spelled });
    expect(opener.requests.value).toBe(0);
    const src = await opener.open(s);
    expect(opener.requests.value).toBe(1);
    expect(sources.current.value?.text).toBe(spelled);
    expect(opener.note.value?.sourceId).toBe(src.id);
    expect(opener.note.value?.text).toMatch(/\$7000/);
    // Sea Dragon reassembles exactly: no note.
    const clean = createOpenAsSource({ sources });
    await clean.open(seaDragon());
    expect(clean.note.value).toBeNull();
  });

  it('a BASIC program cannot open as source', async () => {
    const sources = createSources({ open });
    const bas = Uint8Array.from([0xff, 0x0a, 0x7a, 0x0a, 0x00, 0xb2, 0x20, 0x22, 0x48, 0x49, 0x22, 0x00, 0x00, 0x00]);
    const s = openProgram(bas, { name: 'HI.BAS', selection: { machine: 3, dos: 'none' } });
    expect(s.module.format).toBe('bas');
    const opener = createOpenAsSource({ sources });
    expect(opener.can(s)).toBe(false);
    expect(opener.can(seaDragon())).toBe(true);
    await expect(opener.open(s)).rejects.toThrow(/BASIC/);
  });
});

/** The ROM fugloy.mcp.json (or $FUGLOY_CONFIG) names under `roms.model3`; null when there is none. */
function configuredRom(): Uint8Array | null {
  const config = process.env.FUGLOY_CONFIG || resolve(repo, 'fugloy.mcp.json');
  if (!existsSync(config)) return null;
  const entry = (JSON.parse(readFileSync(config, 'utf8')).roms ?? {}).model3 as string | undefined;
  if (entry === undefined) return null;
  const path = isAbsolute(entry) ? entry : resolve(dirname(config), entry);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}

const rom = configuredRom();
describe.skipIf(rom === null)('Sea Dragon, opened as source, on the real Model III ROM', { timeout: 120_000 }, () => {
  it('runs from the booted snapshot to its title screen', () => {
    const s = seaDragon();
    const result = assemble(renderSession(s, 'zmac'), { model: 3 });
    const m = prepareMachine({ model: 3, rom: rom!, result });
    let now = 0;
    let queued: (() => void) | null = null;
    const runner = createRunner({ machine: m, result, stub: false, schedule: (cb) => ((queued = cb), 1), cancel: () => (queued = null), now: () => now });
    runner.start();
    const title = 'BY: Wayne Westmoreland & Terry Gilman';
    // Up to 10 emulated seconds, a frame at a time, as the page's loop runs it.
    for (let k = 0; k < 600 && !m.video.text().join('\n').includes(title); k++) {
      now += 1000 / 60;
      const cb = queued as (() => void) | null;
      queued = null;
      cb?.();
    }
    expect(runner.state).toBe('running');
    const screen = m.video.text().join('\n');
    expect(screen).toContain(title);
    expect(screen).toContain('(C) Copyright 1982');
  });
});
