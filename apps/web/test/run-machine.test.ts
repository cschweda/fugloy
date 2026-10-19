// Phase 5D, Task 3: the TRS-80 is simply on. Power on boots the model's stored ROM live, with no
// program (a programless runner, never attached to the debugger); Reset boots it again; Power off
// stops it; a Run replaces it and Power on replaces a Run. A Program to try fetches a bundled game's
// main build and runs it, programless, on the booted snapshot. The "ROM" is the stub's bytes stored
// as the user's: the live path never waits for READY.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { parseCmd } from '@fugloy/emu';
import * as realKit from '../app/utils/emulator/kit';
import { createRun, EXAMPLE_NEEDS_ROM, NO_ROM_POWER, POWERED_OFF, POWERED_ON, STOPPED } from '../app/composables/useRun';
import type { RunKit } from '../app/composables/useRun';
import { createSources } from '../app/composables/useSources';
import { createWorkbench } from '../app/composables/useWorkbench';
import type { Roms } from '../app/composables/useRoms';
import type { ModelId } from '../app/utils/store';
import { MODEL_NAMES } from '../app/utils/emulator/rom-ids';
import { fakeClock, frames } from './emulator-support';
import { LOOP } from './source-run-support';

function fakeRoms(stored: Partial<Record<ModelId, Uint8Array>> = {}): Roms {
  return {
    have: (m) => stored[m] !== undefined,
    info: (m) => (stored[m] === undefined ? null : { name: `model${m}.rom`, sha256: 'x', recognized: null }),
    bytes: async (m) => stored[m] ?? null,
    add: async () => ({ ok: false, reason: 'not here' }),
    remove: async () => {},
    start: async () => null,
    unavailable: { value: null } as Roms['unavailable'],
  };
}

const seaDragon = new Uint8Array(readFileSync(fileURLToPath(new URL('../../../examples/sea-dragon/seadrg01.cmd', import.meta.url))));

/** The kit, arriving only when `arrive` is called. */
function slowKit() {
  let arrive!: () => void;
  const ready = new Promise<void>((r) => (arrive = r));
  return { kit: async (): Promise<RunKit> => (await ready, realKit), arrive };
}

async function setup(opts: { roms?: Roms; text?: string | null; fetch?: typeof fetch; kit?: () => Promise<RunKit> } = {}) {
  const sources = createSources({ open: async () => null, starter: async () => LOOP });
  await sources.start();
  if (opts.text !== null) await sources.create({ name: 'loop.z', text: opts.text ?? LOOP });
  const clock = fakeClock();
  const wb = createWorkbench({ readExample: async () => null });
  const run = createRun({ sources, roms: opts.roms ?? fakeRoms({ 3: realKit.stubRom(3) }), wb, kit: opts.kit ?? (async () => realKit), runner: clock, fetch: opts.fetch });
  return { sources, clock, run };
}

describe('the machine session', () => {
  it('Power on boots the stored ROM live with no program: one programless runner, on, running, nothing typed', async () => {
    const { run, clock } = await setup();
    await run.powerOn();
    const r = run.runner.value!;
    expect(r).not.toBeNull();
    expect(r.result).toBeNull();
    expect(run.power.value).toBe('on');
    expect(run.state.value).toBe('running');
    expect(run.machineModel.value).toBe(3);
    expect(run.message.value).toBe(POWERED_ON(3));
    expect(POWERED_ON(3)).toBe('The Model III is on. Type to it on the screen.');
    expect(run.problem.value).toBe(false);
    const before = r.machine.cycles;
    frames(clock, 5);
    expect(r.machine.cycles).toBeGreaterThan(before);
    // emu's KeyQueue counts what is queued (`pending`); its typings leave it out.
    expect((r.machine.keyboard as unknown as { pending: number }).pending).toBe(0);
    expect(run.debug.live.value).toBe(false);
  });

  it('Power on with no ROM says so, not as a problem, and starts nothing', async () => {
    const { run } = await setup({ roms: fakeRoms() });
    await run.powerOn();
    expect(run.runner.value).toBeNull();
    expect(run.power.value).toBe('off');
    expect(run.message.value).toBe(NO_ROM_POWER(3));
    expect(NO_ROM_POWER(3)).toBe('There is no Model III ROM in this browser, so the Model III cannot be turned on. Add your ROM below.');
    expect(run.problem.value).toBe(false);
  });

  it('Power on with no source boots the Model III', async () => {
    const { run } = await setup({ text: null, roms: fakeRoms({ 3: realKit.stubRom(3) }) });
    await run.powerOn();
    expect(run.machineModel.value).toBe(3);
    expect(run.power.value).toBe('on');
  });

  it('Reset replaces the runner, and Power off stops it', async () => {
    const { run } = await setup();
    await run.powerOn();
    const first = run.runner.value!;
    await run.reset();
    const second = run.runner.value!;
    expect(second).not.toBe(first);
    expect(first.state).toBe('stopped');
    expect(run.power.value).toBe('on');
    run.powerOff();
    expect(second.state).toBe('stopped');
    expect(run.power.value).toBe('off');
  });

  it('Final review 1: Power off forgets the runner and says the machine is off, not STOPPED', async () => {
    const { run } = await setup();
    await run.powerOn();
    const r = run.runner.value!;
    run.powerOff();
    expect(r.state).toBe('stopped');
    expect(run.runner.value).toBeNull();
    expect(run.state.value).toBe('idle');
    expect(run.machineModel.value).toBeNull();
    expect(run.power.value).toBe('off');
    expect(run.message.value).toBe(POWERED_OFF(3));
    expect(POWERED_OFF(3)).toBe('The Model III is off. Press Power on to turn it on again.');
    expect(run.problem.value).toBe(false);
  });

  it('Final review 1: Stop on the machine with no program turns it off too; Stop on a program keeps its last frame and STOPPED', async () => {
    const { run } = await setup();
    await run.powerOn();
    run.stop();
    expect(run.runner.value).toBeNull();
    expect(run.power.value).toBe('off');
    expect(run.message.value).toBe(POWERED_OFF(3));
    await run.run();
    const prog = run.runner.value!;
    expect(run.power.value).toBe('program');
    run.stop();
    expect(run.runner.value).toBe(prog);
    expect(run.state.value).toBe('stopped');
    expect(run.message.value).toBe(STOPPED);
  });

  it('Final review 4: busy is set while a power-on and a Program to try load, and cleared after', async () => {
    const slow = slowKit();
    const { run } = await setup({ kit: slow.kit, fetch: (async () => new Response(seaDragon)) as unknown as typeof fetch });
    const on = run.powerOn();
    await Promise.resolve();
    expect(run.busy.value).toBe(true);
    slow.arrive();
    await on;
    expect(run.busy.value).toBe(false);
    expect(run.power.value).toBe('on');
    const tried = run.runExample('sea-dragon');
    expect(run.busy.value).toBe(true);
    await tried;
    expect(run.busy.value).toBe(false);
    expect(run.power.value).toBe('program');
  });

  it('Final review 4: a Run during a power-on still loading is not swallowed by its busy', async () => {
    const slow = slowKit();
    const { run } = await setup({ kit: slow.kit });
    const on = run.powerOn();
    await Promise.resolve();
    expect(run.busy.value).toBe(true);
    const r = run.run();
    slow.arrive();
    await Promise.all([on, r]);
    expect(run.power.value).toBe('program');
    expect(run.busy.value).toBe(false);
  });

  it('Pause and Continue act on the machine itself', async () => {
    const { run } = await setup();
    await run.powerOn();
    run.pauseMachine();
    expect(run.state.value).toBe('paused');
    expect(run.power.value).toBe('on');
    run.continueMachine();
    expect(run.state.value).toBe('running');
  });

  it('Run while on replaces the machine with the program, and Power on replaces the program', async () => {
    const { run } = await setup();
    await run.powerOn();
    const on = run.runner.value!;
    await run.run();
    expect(on.state).toBe('stopped');
    const prog = run.runner.value!;
    expect(prog).not.toBe(on);
    expect(prog.result).not.toBeNull();
    expect(run.power.value).toBe('program');
    await run.powerOn();
    expect(prog.state).toBe('stopped');
    expect(run.runner.value!.result).toBeNull();
    expect(run.power.value).toBe('on');
    expect(run.debug.live.value).toBe(false);
  });

  it('Power on cancels a Run still loading, and a Run cancels a Power on still loading', async () => {
    const { run } = await setup();
    const a = run.run();
    const b = run.powerOn();
    await Promise.all([a, b]);
    expect(run.power.value).toBe('on');
    const c = run.powerOn();
    const d = run.run();
    await Promise.all([c, d]);
    expect(run.power.value).toBe('program');
  });

  it('Review Focus 1: a ROM of 16K HALTs powers on without throwing and stays on', async () => {
    const { run, clock } = await setup({ roms: fakeRoms({ 3: new Uint8Array(0x4000).fill(0x76) }) });
    await run.powerOn();
    expect(run.power.value).toBe('on');
    frames(clock, 3);
    expect(run.power.value).toBe('on');
    expect(run.runner.value!.state).toBe('running');
  });

  it('changing the model while on powers on the new model, or says there is no ROM for it', async () => {
    const { run, sources } = await setup({ roms: fakeRoms({ 3: realKit.stubRom(3), 1: realKit.stubRom(1) }) });
    await run.powerOn();
    sources.update(sources.current.value!.id, { model: 1 });
    await nextTick();
    await flushPromises();
    expect(run.power.value).toBe('on');
    expect(run.machineModel.value).toBe(1);
    expect(run.message.value).toBe(POWERED_ON(1));
    sources.update(sources.current.value!.id, { model: 4 });
    await nextTick();
    await flushPromises();
    expect(run.power.value).toBe('off');
    expect(run.runner.value).toBeNull();
    expect(run.message.value).toBe(NO_ROM_POWER(4));
  });

  it('a Program to try with no ROM for its model is refused as a problem', async () => {
    const fetcher = vi.fn(async () => new Response(seaDragon));
    const { run } = await setup({ roms: fakeRoms(), fetch: fetcher as unknown as typeof fetch });
    await run.runExample('sea-dragon');
    expect(run.message.value).toBe(EXAMPLE_NEEDS_ROM('Sea Dragon', 3));
    expect(EXAMPLE_NEEDS_ROM('Sea Dragon', 3)).toBe('Sea Dragon needs the Model III ROM, which is not in this browser yet. Add your ROM below, then press Run again.');
    expect(run.problem.value).toBe(true);
    expect(run.runner.value).toBeNull();
  });

  it('a Program to try runs its main build programless, from its transfer address', async () => {
    const fetcher = vi.fn(async (_url: string) => new Response(seaDragon));
    const { run } = await setup({ fetch: fetcher as unknown as typeof fetch });
    await run.runExample('sea-dragon');
    expect(fetcher).toHaveBeenCalledWith('/examples/sea-dragon/seadrg01.cmd');
    const r = run.runner.value!;
    expect(r.result).toBeNull();
    // No frame has run yet (the fake clock has not ticked): PC is where the .CMD loader left it.
    expect(r.pc).toBe(parseCmd(seaDragon).entry);
    expect(run.power.value).toBe('program');
    expect(run.machineModel.value).toBe(3);
    expect(run.message.value).toBe('Sea Dragon is running on your Model III ROM.');
    expect(run.problem.value).toBe(false);
    expect(run.debug.live.value).toBe(false);
  });

  it("the sentences name each model as rom-ids does", () => {
    for (const m of [1, 3, 4] as const) {
      expect(POWERED_ON(m)).toBe(`The ${MODEL_NAMES[m]} is on. Type to it on the screen.`);
      expect(POWERED_OFF(m)).toBe(`The ${MODEL_NAMES[m]} is off. Press Power on to turn it on again.`);
    }
  });

  it('a Program to try that cannot be fetched says so, and leaves the machine on', async () => {
    const { run } = await setup({ fetch: (async () => new Response('', { status: 404 })) as unknown as typeof fetch });
    await run.powerOn();
    await run.runExample('rear-guard');
    expect(run.message.value).toMatch(/^Rear Guard could not be loaded/);
    expect(run.problem.value).toBe(true);
    expect(run.power.value).toBe('on');
  });

  it('Armored Patrol is not offered', async () => {
    const { run } = await setup();
    await expect(run.runExample('armored-patrol')).rejects.toThrow(Error);
  });
});
