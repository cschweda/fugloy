// Run ▶ (plan 5B, Task 4): one press assembles the current source and, when it is clean and
// needs nothing the stub cannot give, runs it on a fresh Machine. Errors go to Source ✎; a
// program that calls the ROM with no ROM stored is refused with its sentence; a stored ROM
// runs from its booted snapshot. A clean Run also refreshes the source's own listing,
// quietly, and never replaces a program opened from a file. Sources and ROMs live in memory.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import starter from '@fugloy/asm-examples/clear-screen.z?raw';
import * as realKit from '../app/utils/emulator/kit';
import type { RunKit } from '../app/composables/useRun';
import { createRun, KIT_FAILED, STOPPED, STOPPED_MODEL, STOPPED_SOURCE } from '../app/composables/useRun';
import { loadFailed } from '../app/utils/lazy';
import { STUB_RUNNING } from '../app/utils/emulator/kit';
import { createSources } from '../app/composables/useSources';
import { createWorkbench } from '../app/composables/useWorkbench';
import { createPersistence } from '../app/composables/usePersistence';
import type { Roms } from '../app/composables/useRoms';
import type { ModelId } from '../app/utils/store';

const FRAME = 1000 / 60;
const program = (...lines: string[]): string => ['        ORG     7000H', ...lines, '        END     START', ''].join('\n');
const BROKEN = '\tORG\t7000H\nSTART:\tLDA\n\tPUSH\tA\n\tEND\tSTART\n';

/** A fake animation-frame clock: `frame()` advances time and runs the queued callback. */
function fakeClock() {
  let t = 0;
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    schedule: (cb: () => void): number => {
      queue.set(next, cb);
      return next++;
    },
    cancel: (id: number): void => void queue.delete(id),
    now: (): number => t,
    frame(): void {
      t += FRAME;
      const [id, cb] = [...queue][0] ?? [];
      if (id === undefined) return;
      queue.delete(id);
      cb!();
    },
  };
}

/** ROMs in memory: `stored` maps a model to its bytes. */
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

const examplesDir = (path: string): string => fileURLToPath(new URL(`../../../examples/${path}`, import.meta.url));
const readExample = async (path: string): Promise<Uint8Array | null> => new Uint8Array(readFileSync(examplesDir(path)));

/** A kit that arrives only when `arrive()` is called, as a first Run's chunk does. */
function slowKit() {
  let arrive!: () => void;
  const ready = new Promise<void>((r) => (arrive = r));
  return { kit: async (): Promise<RunKit> => (await ready, realKit), arrive };
}

async function setup(text: string | null, opts: { roms?: Roms; kit?: RunKit; loadKit?: () => Promise<RunKit> } = {}) {
  const sources = createSources({ open: async () => null, starter: async () => starter });
  await sources.start();
  if (text === null) await sources.create();
  else await sources.create({ name: 'mine.z', text });
  const wb = createWorkbench({ readExample });
  const clock = fakeClock();
  const kit = opts.kit ?? realKit;
  const run = createRun({ sources, roms: opts.roms ?? fakeRoms(), wb, kit: opts.loadKit ?? (async () => kit), runner: clock });
  return { sources, wb, clock, run };
}

const screenBlank = (run: ReturnType<typeof createRun>): boolean => run.runner.value!.machine.video.text().every((l) => /^ *$/.test(l));

describe('Run ▶', () => {
  it('a source with errors marks them, asks Source to reveal the first, and starts no Machine', async () => {
    const prepare = vi.fn(realKit.prepareMachine);
    const { run } = await setup(BROKEN, { kit: { ...realKit, prepareMachine: prepare } });
    await run.run();
    expect(prepare).not.toHaveBeenCalled();
    expect(run.runner.value).toBeNull();
    expect(run.report.value?.text).toBe(BROKEN);
    expect(run.report.value?.diagnostics.filter((d) => d.severity === 'error').map((d) => d.line)).toEqual([2, 3]);
    expect(run.reveal.value?.line).toBe(2);
    expect(run.message.value).toMatch(/^The program has 2 errors, so it did not run\. The first is on line 2: .+ Fix it in Source ✎, then press Run again\.$/);
    expect(run.lastResult.value?.ok).toBe(false);
  });

  it('the starter with no ROM runs on the stub, says so, and blanks the screen', async () => {
    const { run, clock, wb } = await setup(null);
    await run.run();
    expect(run.message.value).toBe(STUB_RUNNING);
    expect(STUB_RUNNING).toBe("Running on Fugløy's stub ROM (no ROM needed for this program).");
    expect(run.state.value).toBe('running');
    // Dirty the screen, then let the program blank it.
    const m = run.runner.value!.machine;
    m.mem.write(0x3c00, new Uint8Array(0x400).fill(0x41));
    expect(screenBlank(run)).toBe(false);
    for (let k = 0; k < 10; k++) clock.frame();
    expect(screenBlank(run)).toBe(true);
    expect(run.runner.value!.pc).toBe(run.lastResult.value!.symbol('WAIT')!.value);
    // Its own listing opened, quietly, as a source program.
    expect(wb.session.value?.name).toBe('clear-screen.cmd');
    expect(wb.origin.value).toEqual({ kind: 'source', sourceId: expect.any(String) });
    expect(wb.keptView.value).toBe(true);
  });

  it('a program that calls the ROM, with no ROM stored, is refused with the sentence, shows its listing, and runs nothing', async () => {
    const prepare = vi.fn(realKit.prepareMachine);
    const { run, wb } = await setup(program('START:  LD      A,1', '        CALL    $VDCLS', 'WAIT:   JR      WAIT'), { kit: { ...realKit, prepareMachine: prepare } });
    await run.run();
    expect(prepare).not.toHaveBeenCalled();
    expect(run.runner.value).toBeNull();
    expect(run.message.value).toMatch(/^Line 3 calls \$VDCLS, the ROM's routine at \$01C9 \(clear the screen\), but no ROM is loaded\. Add a Model III ROM in the Run tab/);
    expect(run.problem.value).toBe(true);
    expect(wb.session.value?.name).toBe('mine.cmd');
  });

  it('with a stored ROM it boots from that ROM (its snapshot), not the stub, and still refuses code in the ROM space', async () => {
    const rom = new Uint8Array(0x3800).fill(0xc9);
    const prepare = vi.fn((o: Parameters<typeof realKit.prepareMachine>[0]) => realKit.prepareMachine({ ...o, rom: realKit.stubRom(o.model) }));
    const { run, sources } = await setup(program('START:  LD      A,1', '        CALL    $VDCLS', 'WAIT:   JR      WAIT'), { roms: fakeRoms({ 3: rom }), kit: { ...realKit, prepareMachine: prepare } });
    await run.run();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]![0].rom).toBe(rom);
    expect(prepare.mock.calls[0]![0].model).toBe(3);
    expect(run.message.value).toBe('Running on your Model III ROM.');
    expect(run.state.value).toBe('running');

    sources.update(sources.current.value!.id, { text: '        ORG     1000H\nSTART:  JR      START\n        END     START\n' });
    await run.run();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(run.runner.value).toBeNull();
    expect(run.message.value).toMatch(/^Line 1 puts the program at \$1000, inside the ROM's space/);
  });

  it("the ROM-copy notes go to Source's list as warnings on their line", async () => {
    const { run } = await setup(program('START:  LD      HL,0', '        LD      DE,3C00H', '        LD      BC,64', '        LDIR', 'WAIT:   JR      WAIT'));
    await run.run();
    expect(run.report.value?.notes).toEqual([expect.objectContaining({ line: 2, severity: 'warning', column: 1, message: expect.stringMatching(/^Line 2 points HL at \$0000/) })]);
    expect(run.state.value).toBe('running');
  });

  it('a second Run stops the first and starts a fresh machine; Stop stops it', async () => {
    const { run } = await setup(null);
    await run.run();
    const first = run.runner.value!;
    await run.run();
    expect(first.state).toBe('stopped');
    expect(run.runner.value).not.toBe(first);
    expect(run.runner.value!.machine).not.toBe(first.machine);
    run.stop();
    expect(run.state.value).toBe('stopped');
  });

  it('a trap under the stub shows its sentence when the runner stops', async () => {
    const { run, clock } = await setup(program('START:  RET'));
    await run.run();
    for (let k = 0; k < 3; k++) clock.frame();
    expect(run.state.value).toBe('stopped');
    expect(run.message.value).toMatch(/^Line 2 returns \(RET\) to the ROM/);
    expect(run.problem.value).toBe(true);
  });

  it('never replaces a program opened from a file; Show in Listing does, and a source listing is not saved', async () => {
    const { run, wb } = await setup(null);
    await wb.openExample('sea-dragon');
    const persistence = createPersistence(wb, { open: async () => null, readExample });
    await run.run();
    expect(wb.session.value?.name).toBe('seadrg01.cmd');
    expect(run.state.value).toBe('running');
    await run.showInListing();
    expect(wb.session.value?.name).toBe('clear-screen.cmd');
    expect(wb.keptView.value).toBe(false);
    expect(persistence.status.value).toBe('not saved (assembled from your source)');
  });

  it('with no source, says how to get one', async () => {
    const sources = createSources({ open: async () => null, starter: async () => starter });
    const run = createRun({ sources, roms: fakeRoms(), wb: createWorkbench({ readExample }), kit: async () => realKit, runner: fakeClock() });
    await run.run();
    expect(run.message.value).toBe('There is no source to run. Open Source ✎ to write a program, then press Run.');
  });

  it('a Run that writes no program clears what Show in Listing would open', async () => {
    const { run, sources } = await setup(null);
    await run.run();
    expect(run.listable.value).toBe(true);
    sources.update(sources.current.value!.id, { text: '; nothing but a comment\n' });
    await run.run();
    expect(run.lastResult.value?.ok).toBe(true);
    expect(run.listable.value).toBe(false);
    expect(run.message.value).toMatch(/Write some instructions in Source ✎, then press Run again\.$/);
  });

  it("an emulator failure becomes a sentence with a next step; the boot's own sentences pass as they are", async () => {
    const boom = vi.fn(() => {
      throw new Error('boom');
    });
    const { run } = await setup(null, { kit: { ...realKit, prepareMachine: boom } });
    await run.run();
    expect(run.message.value).toBe('The emulator could not start the program (boom). Press Run to try again, or reload the page if it happens again.');
    const said = 'The ROM did not reach READY within 8 emulated seconds, so Fugløy cannot run programs on it. Check that it is a Model III ROM, or remove it to run on Fugløy’s stand-in.';
    const { run: run2 } = await setup(null, {
      kit: {
        ...realKit,
        prepareMachine: () => {
          throw new realKit.SentenceError(said);
        },
      },
    });
    await run2.run();
    expect(run2.message.value).toBe(said);
  });

  it('Stop while a Run is still loading cancels it: nothing starts, no listing opens, and Run works again', async () => {
    const slow = slowKit();
    const { run, wb } = await setup(null, { loadKit: slow.kit });
    const pending = run.run();
    await Promise.resolve();
    expect(run.busy.value).toBe(true);
    run.stop();
    expect(run.busy.value).toBe(false);
    expect(run.message.value).toBe(STOPPED);
    slow.arrive();
    await pending;
    expect(run.runner.value).toBeNull();
    expect(run.state.value).toBe('idle');
    expect(wb.session.value).toBeNull();
    expect(run.report.value).toBeNull();
    // Closing the workbench (or leaving the page) stops the same way, and the next press runs.
    await run.run();
    expect(run.state.value).toBe('running');
    expect(wb.session.value?.name).toBe('clear-screen.cmd');
  });

  it('a Run runs the source as it is once its parts have loaded, and reveals a line of that text', async () => {
    const slow = slowKit();
    const { run, sources } = await setup(null, { loadKit: slow.kit });
    const pending = run.run();
    await Promise.resolve();
    // Typed while the emulator was loading: the broken text is what runs, and its line is revealed.
    sources.update(sources.current.value!.id, { text: BROKEN });
    slow.arrive();
    await pending;
    expect(run.report.value?.text).toBe(BROKEN);
    expect(run.reveal.value?.line).toBe(2);
    expect(run.runner.value).toBeNull();
  });

  it('changing the model or switching source stops the running program, saying why', async () => {
    const { run, sources } = await setup(null);
    await run.run();
    const first = run.runner.value!;
    sources.update(sources.current.value!.id, { model: 1 });
    await nextTick();
    expect(first.state).toBe('stopped');
    expect(run.state.value).toBe('stopped');
    expect(run.message.value).toBe(STOPPED_MODEL);
    expect(run.problem.value).toBe(false);

    await run.run();
    const second = run.runner.value!;
    expect(second.state).toBe('running');
    await sources.create({ name: 'other.z', text: program('START:  JR      START') });
    await nextTick();
    expect(second.state).toBe('stopped');
    expect(run.message.value).toBe(STOPPED_SOURCE);
  });

  it('says the emulator could not load, in the sentence every lazy part uses, with Run as the next step', async () => {
    expect(KIT_FAILED).toBe(loadFailed('The emulator', 'Press Run again'));
    const { run } = await setup(null, { loadKit: async () => Promise.reject(new Error('offline')) });
    await run.run();
    expect(run.message.value).toBe(KIT_FAILED);
    expect(run.problem.value).toBe(true);
  });
});

describe('Run ▶ while debugging (5C)', () => {
  // Line 2 LD A,1; 3 INC A (LOOP); 4 JR LOOP.
  const LOOP2 = program('START:  LD      A,1', 'LOOP:   INC     A', '        JR      LOOP');

  it('each pause and step is an announcement of its own: the sentence, and whether a step made it (Ruling 12)', async () => {
    const { run, clock } = await setup(LOOP2);
    run.debug.toggleBreakpoint(3);
    await run.run();
    clock.frame();
    const paused = run.debug.announcement.value;
    expect(paused).toEqual({ text: 'Paused at line 3, INC A, at a breakpoint.', step: false });
    expect(run.message.value).toBe(paused!.text);
    run.debug.step();
    const first = run.debug.announcement.value;
    expect(first).toEqual({ text: expect.stringMatching(/^Line 4, JR LOOP\./), step: true });
    run.debug.step();
    run.debug.step();
    // The same line again is a new announcement, so it is spoken again.
    expect(run.debug.announcement.value).not.toBe(first);
    expect(run.debug.announcement.value!.text).toMatch(/^Line 4, JR LOOP\./);
  });

  it('a sentence the stepper returns is announced too, as a problem', async () => {
    const { run, clock } = await setup(program('START:  DI', '        HALT', 'NEXT:   NOP'));
    run.debug.toggleBreakpoint(2);
    await run.run();
    clock.frame();
    run.debug.step();
    run.debug.step();
    run.debug.step();
    expect(run.debug.announcement.value).toEqual({ text: realKit.HALTED_INTERRUPTS_OFF, step: false });
    expect(run.problem.value).toBe(true);
  });

  it("Step Over's and Run to Here's own stops are announced as steps; a user breakpoint in the callee still says so (review finding 3)", async () => {
    // 2 LD A,1; 3 CALL SUB (LOOP); 4 JR LOOP; 5 INC A (SUB); 6 RET.
    const { run, clock } = await setup(program('START:  LD      A,1', 'LOOP:   CALL    SUB', '        JR      LOOP', 'SUB:    INC     A', '        RET'));
    run.debug.toggleBreakpoint(3);
    await run.run();
    clock.frame();
    expect(run.debug.announcement.value).toEqual({ text: 'Paused at line 3, CALL SUB, at a breakpoint.', step: false });
    run.debug.stepOver();
    clock.frame();
    expect(run.debug.mode.value).toBe('paused');
    expect(run.debug.announcement.value).toEqual({ text: expect.stringMatching(/^Line 4, JR LOOP\. Changed: A\b/), step: true });
    run.debug.step();
    run.debug.toggleBreakpoint(5);
    run.debug.stepOver();
    clock.frame();
    expect(run.debug.announcement.value).toEqual({ text: 'Paused at line 5, INC A, at a breakpoint.', step: false });
    run.debug.toggleBreakpoint(5);
    run.debug.runToLine(4);
    clock.frame();
    expect(run.debug.announcement.value).toEqual({ text: expect.stringMatching(/^Line 4, JR LOOP\./), step: true });
  });
});
