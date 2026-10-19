// A first Run before the Run tab was ever opened (Ctrl/⌘+Enter from the editor) uses the ROM
// stored on an earlier visit: Run reads the ROM store itself, with nothing loaded beforehand.
// The ROM here is synthetic (it prints READY and waits), stored in fake IndexedDB.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { assemble } from '@fugloy/asm';
import * as realKit from '../app/utils/emulator/kit';
import { createRun } from '../app/composables/useRun';
import { createRoms } from '../app/composables/useRoms';
import { createSources } from '../app/composables/useSources';
import { createWorkbench } from '../app/composables/useWorkbench';

function readyRom(): Uint8Array {
  const r = assemble(['        ORG 0', '        LD HL,MSG', '        LD DE,3C00H', '        LD BC,5', '        LDIR', 'HERE:   JR HERE', "MSG:    DB 'READY'", '        END', ''].join('\n'));
  const rom = new Uint8Array(0x3800);
  for (const run of r.image!.runs()) rom.set(r.image!.bytes.subarray(run.start, run.end + 1), run.start);
  return rom;
}

const readExample = async (path: string): Promise<Uint8Array | null> => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../examples/${path}`, import.meta.url))));

describe('the first Run', () => {
  it('uses the stored ROM though nothing has read the ROM store yet', async () => {
    // An earlier visit kept a Model III ROM.
    const earlier = createRoms({ hash: async () => 'synthetic' });
    expect(await earlier.add(new File([readyRom() as Uint8Array<ArrayBuffer>], 'mine.rom'), 3)).toEqual({ ok: true, model: 3 });

    // This visit: Run is pressed in the editor, so no Run tab has started the ROM store.
    const sources = createSources({ open: async () => null });
    await sources.create({ name: 'mine.z', text: '        ORG     7000H\nSTART:  CALL    01C9H\nWAIT:   JR      WAIT\n        END     START\n' });
    const prepare = vi.fn(realKit.prepareMachine);
    const run = createRun({ sources, wb: createWorkbench({ readExample }), kit: async () => ({ ...realKit, prepareMachine: prepare }), runner: { schedule: () => 0, cancel: () => {}, now: () => 0 } });
    await run.run();
    expect(run.message.value).toBe('Running on your Model III ROM.');
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]![0].rom.length).toBe(0x3800);
    expect(run.state.value).toBe('running');
  });
});
