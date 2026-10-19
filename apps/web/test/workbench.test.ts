import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatRow } from '@fugloy/disasm';
import { createWorkbench, emptyMessage, notAProgramMessage, tooBigForRawMessage } from '../app/composables/useWorkbench';

const examplesDir = (path: string): string => fileURLToPath(new URL(`../../../examples/${path}`, import.meta.url));
/** The composable's file reader, over the repo's examples/ instead of fetch. */
const readExample = async (path: string): Promise<Uint8Array | null> => {
  try {
    return new Uint8Array(readFileSync(examplesDir(path)));
  } catch {
    return null;
  }
};
const text = (wb: ReturnType<typeof createWorkbench>): string => wb.rows.value.map(formatRow).join('\n');

describe('useWorkbench', () => {
  it("openExample('sea-dragon') opens seadrg01 with its hints, as Model III", async () => {
    const wb = createWorkbench({ readExample });
    await wb.openExample('sea-dragon');
    expect(wb.error.value).toBeNull();
    expect(wb.session.value?.name).toBe('seadrg01.cmd');
    expect(wb.session.value?.hintSource).toBe('seadrg01.hints');
    expect(text(wb)).toContain('L497F:');
    expect(wb.session.value?.selection).toEqual({ machine: 3, dos: 'trsdos' });
    expect(wb.example.value?.id).toBe('sea-dragon');
    expect(wb.facts.value?.entry).toBe(0x8881);
  });

  it('openExample opens another build from the menu', async () => {
    const wb = createWorkbench({ readExample });
    await wb.openExample('sea-dragon', 'seadrg06.cmd');
    expect(wb.session.value?.name).toBe('seadrg06.cmd');
    expect(wb.session.value?.hintSource).toBeUndefined();
  });

  it('openBytes of a JPEG header says it is not a program and offers a raw load', () => {
    const wb = createWorkbench({ readExample });
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    wb.openBytes(jpeg, 'photo.jpg');
    expect(wb.error.value).toBe(notAProgramMessage('photo.jpg'));
    expect(wb.session.value).toBeNull();
    expect(wb.rawCandidate.value?.name).toBe('photo.jpg');
    expect(wb.suggestManuals.value).toBe(false);
    wb.openRaw(0x7000);
    expect(wb.error.value).toBeNull();
    expect(wb.session.value?.module.format).toBe('raw');
  });

  it('a non-program over 64K (a disk image) is not offered as a raw binary, and a raw load over 64K is refused before it is opened', () => {
    const wb = createWorkbench({ readExample });
    const dsk = new Uint8Array(200 * 1024).fill(0xe5);
    wb.openBytes(dsk, 'game.dsk');
    expect(wb.error.value).toBe(`${notAProgramMessage('game.dsk')} ${tooBigForRawMessage(dsk.length)}`);
    expect(wb.error.value).toContain('204,800 bytes');
    expect(wb.rawCandidate.value).toBeNull();
    wb.openBytes(dsk, 'game.dsk', { base: 0 });
    expect(wb.session.value).toBeNull();
    expect(wb.error.value).toBe(`game.dsk cannot be loaded as a raw binary. ${tooBigForRawMessage(dsk.length)}`);
    // Exactly 64K still loads, at 0.
    wb.openBytes(new Uint8Array(0x10000), 'full.bin', { base: 0 });
    expect(wb.session.value?.module.format).toBe('raw');
  });

  it('a dropped PDF also suggests the Manuals page, and an empty file says it is empty', () => {
    const wb = createWorkbench({ readExample });
    wb.openBytes(new TextEncoder().encode('%PDF-1.7\n%...'), 'trm.pdf');
    expect(wb.error.value).toBe(notAProgramMessage('trm.pdf'));
    expect(wb.suggestManuals.value).toBe(true);
    wb.openBytes(new Uint8Array(0), 'blank.cmd');
    expect(wb.error.value).toBe(emptyMessage('blank.cmd'));
    expect(wb.rawCandidate.value).toBeNull();
    expect(wb.suggestManuals.value).toBe(false);
  });

  it("openBytes(_, 'x.bin', { base: 0x7000 }) on [0xC9] gives a raw session", () => {
    const wb = createWorkbench({ readExample });
    wb.openBytes(Uint8Array.from([0xc9]), 'x.bin', { base: 0x7000 });
    expect(wb.error.value).toBeNull();
    expect(wb.session.value?.module.format).toBe('raw');
    expect(text(wb)).toContain('7000  C9');
  });

  it('sets the picker from the machine verdict when it names one machine, else Model III', async () => {
    const wb = createWorkbench({ readExample });
    // elimin8d's verdict is model1 (it calls $01D3, BASICRANDOM, which only the Model I ROM has).
    wb.openBytes((await readExample('eliminator/elimin8d.cmd'))!, 'elimin8d.cmd');
    expect(wb.facts.value?.machine.fit).toBe('model1');
    expect(wb.session.value?.selection).toEqual({ machine: 1, dos: 'ldos' });
    // seadrg01 without hints: only the stub is decoded, so the verdict is unknown.
    wb.openBytes((await readExample('sea-dragon/seadrg01.cmd'))!, 'seadrg01.cmd');
    expect(wb.facts.value?.machine.fit).toBe('unknown');
    expect(wb.session.value?.selection).toEqual({ machine: 3, dos: 'trsdos' });
  });

  it("setSelection({ machine: 1, dos: 'ldos' }) re-renders with Model I names", async () => {
    const wb = createWorkbench({ readExample });
    await wb.openExample('sea-dragon');
    expect(text(wb)).not.toContain('CTRLCHARTAB');
    const opened = wb.openCount.value;
    wb.setSelection({ machine: 1, dos: 'ldos' });
    expect(wb.session.value?.selection).toEqual({ machine: 1, dos: 'ldos' });
    expect(text(wb)).toContain('; symbols: Model I ROM, hardware, LDOS 5.1');
    expect(text(wb)).toContain('LD DE,CTRLCHARTAB+0001H');
    expect(text(wb)).toContain('L497F:');
    // The same program, so the listing keeps its key (and its cursor anchor).
    expect(wb.openCount.value).toBe(opened);
  });

  it('a new program clears the cursor and selection and bumps the open count', async () => {
    const wb = createWorkbench({ readExample });
    await wb.openExample('sea-dragon');
    wb.cursor.value = 0x499f;
    wb.selection.value = { from: 0x499f, to: 0x49a1 };
    const before = wb.openCount.value;
    await wb.openExample('rear-guard');
    expect(wb.openCount.value).toBe(before + 1);
    expect(wb.cursor.value).toBeNull();
    expect(wb.selection.value).toBeNull();
    expect(wb.session.value?.name).toBe('reargrd1.cmd');
  });

  it('a missing example file leaves the workbench as it was, with an error', async () => {
    const wb = createWorkbench({ readExample: async () => null });
    await wb.openExample('eliminator');
    expect(wb.session.value).toBeNull();
    expect(wb.error.value).toContain('elimin8d.cmd');
  });

  it('opens Eliminator as Model I, the machine its manifest gives', async () => {
    const wb = createWorkbench({ readExample });
    await wb.openExample('eliminator');
    expect(wb.session.value?.name).toBe('elimin8d.cmd');
    expect(wb.session.value?.selection).toEqual({ machine: 1, dos: 'ldos' });
  });

  it('an unknown build or a reported problem clears a stale raw offer', async () => {
    const wb = createWorkbench({ readExample });
    wb.openBytes(new TextEncoder().encode('%PDF-1.7'), 'trm.pdf');
    expect(wb.rawCandidate.value).not.toBeNull();
    await wb.openExample('sea-dragon', 'seadrg05.cmd');
    expect(wb.error.value).toContain('seadrg05.cmd');
    expect(wb.rawCandidate.value).toBeNull();
    expect(wb.suggestManuals.value).toBe(false);
    wb.openBytes(new TextEncoder().encode('%PDF-1.7'), 'trm.pdf');
    wb.report('x.cmd could not be read.');
    expect(wb.error.value).toBe('x.cmd could not be read.');
    expect(wb.rawCandidate.value).toBeNull();
    expect(wb.suggestManuals.value).toBe(false);
  });

  it('ignores a second openExample while one is loading', async () => {
    const reads: string[] = [];
    const wb = createWorkbench({
      readExample: async (path) => {
        reads.push(path);
        return readExample(path);
      },
    });
    await Promise.all([wb.openExample('rear-guard'), wb.openExample('eliminator')]);
    expect(wb.session.value?.name).toBe('reargrd1.cmd');
    expect(reads).toEqual(['rear-guard/reargrd1.cmd']);
  });

  it('says a dropped file would replace the open program only when it is a program', async () => {
    const wb = createWorkbench({ readExample });
    const cmd = (await readExample('sea-dragon/seadrg06.cmd'))!;
    expect(wb.wouldReplace(cmd)).toBe(false);
    await wb.openExample('sea-dragon');
    expect(wb.wouldReplace(cmd)).toBe(true);
    expect(wb.wouldReplace(new TextEncoder().encode('%PDF-1.7'))).toBe(false);
    expect(wb.wouldReplace(new Uint8Array(0))).toBe(false);
    // A file that is not a program fails without replacing the open one.
    wb.openBytes(new TextEncoder().encode('%PDF-1.7'), 'trm.pdf');
    expect(wb.session.value?.name).toBe('seadrg01.cmd');
    expect(wb.suggestManuals.value).toBe(true);
  });

  describe('a Source ✎ program in the listing (Ruling 10)', () => {
    // ORG 7000H: LD A,1 / NOP / JR $ ; END 7000H, as a .CMD.
    const cmd = (extra = 0): Uint8Array => Uint8Array.from([0x01, 0x07 + extra, 0x00, 0x70, 0x3e, 0x01, 0x00, ...Array<number>(extra).fill(0), 0x18, 0xfe, 0x02, 0x02, 0x00, 0x70]);
    const sel = { machine: 3, dos: 'trsdos' } as const;

    it('opens with no program open, then refreshes its own listing quietly, keeping the cursor where its address still exists', () => {
      const wb = createWorkbench({ readExample });
      expect(wb.openSource(cmd(), 'mine.cmd', { sourceId: 's-1', selection: sel })).toBe(true);
      expect(wb.origin.value).toEqual({ kind: 'source', sourceId: 's-1' });
      expect(wb.keptView.value).toBe(true);
      wb.cursor.value = 0x7002;
      expect(wb.openSource(cmd(1), 'mine.cmd', { sourceId: 's-1', selection: sel })).toBe(true);
      expect(wb.cursor.value).toBe(0x7002);
      // Another source's Run does not replace this one's listing.
      expect(wb.openSource(cmd(), 'other.cmd', { sourceId: 's-2', selection: sel })).toBe(false);
      expect(wb.session.value?.name).toBe('mine.cmd');
    });

    it('never replaces a program opened from a file unless forced, and a forced open is not quiet', async () => {
      const wb = createWorkbench({ readExample });
      await wb.openExample('sea-dragon');
      expect(wb.origin.value).toBeNull();
      const count = wb.openCount.value;
      expect(wb.openSource(cmd(), 'mine.cmd', { sourceId: 's-1', selection: sel })).toBe(false);
      expect(wb.session.value?.name).toBe('seadrg01.cmd');
      expect(wb.openCount.value).toBe(count);
      expect(wb.openSource(cmd(), 'mine.cmd', { sourceId: 's-1', selection: sel, force: true })).toBe(true);
      expect(wb.session.value?.name).toBe('mine.cmd');
      expect(wb.keptView.value).toBe(false);
      // A file opened afterwards is a file again.
      wb.openBytes(Uint8Array.from([0xc9]), 'x.bin', { base: 0x7000 });
      expect(wb.origin.value).toBeNull();
      expect(wb.keptView.value).toBe(false);
    });

    it('close leaves the writing mode too', () => {
      const wb = createWorkbench({ readExample });
      wb.writing.value = true;
      wb.openSource(cmd(), 'mine.cmd', { sourceId: 's-1', selection: sel });
      wb.close();
      expect(wb.writing.value).toBe(false);
      expect(wb.origin.value).toBeNull();
    });
  });
});
