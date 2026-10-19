// A Run for the Learn page (phase 6B, Task 2): `stubOnly` runs on Fugløy's stub ROM whatever ROM is
// stored, and `listing: false` never touches the workbench.
import { describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import * as realKit from '../app/utils/emulator/kit';
import { createRun, LESSON_NO_POWER } from '../app/composables/useRun';
import { createSources } from '../app/composables/useSources';
import type { Roms } from '../app/composables/useRoms';
import { fakeClock } from './emulator-support';
import { LOOP } from './source-run-support';

const workbench = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../app/composables/useWorkbench', async (orig) => ({
  ...(await orig<typeof import('../app/composables/useWorkbench')>()),
  useWorkbench: () => {
    workbench.calls++;
    throw new Error('a lesson must not open the workbench');
  },
}));

async function lesson() {
  const sources = createSources({ open: async () => null, starter: async () => LOOP });
  await sources.start();
  await sources.create({});
  const start = vi.fn(async () => null);
  const bytes = vi.fn(async () => new Uint8Array(0x3800));
  const roms = { have: () => true, info: () => null, bytes, add: async () => ({ ok: false, reason: '' }), remove: async () => {}, start, unavailable: { value: null } } as unknown as Roms;
  const clock = fakeClock();
  const run = createRun({ sources, roms, stubOnly: true, listing: false, kit: async () => realKit, runner: clock });
  return { run, clock, start, bytes };
}

describe('a stub-only Run without a listing', () => {
  it('runs on the stub ROM though a Model III ROM is stored, and never reads the ROM store', async () => {
    const { run, start, bytes } = await lesson();
    await run.run();
    expect(run.message.value).toBe(realKit.STUB_RUNNING);
    expect(run.state.value).toBe('running');
    expect(start).not.toHaveBeenCalled();
    expect(bytes).not.toHaveBeenCalled();
    expect(workbench.calls).toBe(0);
    expect(run.listable.value).toBe(false);
    await run.showInListing();
    expect(workbench.calls).toBe(0);
  });

  it('says there is no BASIC to turn on, and does nothing else', async () => {
    const { run } = await lesson();
    await run.powerOn();
    expect(run.message.value).toBe(LESSON_NO_POWER);
    expect(run.power.value).toBe('off');
    await run.run();
    await run.reset();
    expect(run.message.value).toBe(LESSON_NO_POWER);
    await run.runExample('sea-dragon');
    expect(run.message.value).toBe(LESSON_NO_POWER);
    expect(run.power.value).toBe('program');
  });

  it('steps with the debugger and fills the registers', async () => {
    const { run, clock } = await lesson();
    await run.run();
    clock.frame();
    run.debug.pause();
    await flushPromises();
    const pc = run.debug.pcAddr.value;
    run.debug.step();
    expect(run.debug.registers.value).not.toBeNull();
    expect(run.debug.pcAddr.value).not.toBe(pc);
    expect(workbench.calls).toBe(0);
  });
});
