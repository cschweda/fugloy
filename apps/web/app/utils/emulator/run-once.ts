// One press of Run ▶ (plan 5B, Task 4), loaded with the kit so it stays off the first screen:
// assemble the source; on errors, say so (useRun sends them to Source ✎); otherwise turn the ROM
// notes into warnings, write the .CMD (for the listing), refuse code in the ROM's space on any
// ROM, and with no ROM stored refuse a program that needs one (romUse) and use the stub. Then a
// fresh Machine from the booted snapshot, in a Runner (not started; useRun starts it), with a
// Stepper (5C) holding the source's breakpoints, applied before the first frame. The Stepper's
// temporary breakpoints are cleared on every pause and stop, before the caller's onPause and
// onStop. `kit` is the kit module itself, passed in so the tests can replace a part of it.
import type { AsmResult, Diagnostic } from '@fugloy/asm';
import type { Model } from '@fugloy/emu';
import type { RunKit } from './kit';
import type { Runner, RunnerOptions } from './runner';
import type { Stepper } from './stepping';

export const STUB_RUNNING = "Running on Fugløy's stub ROM (no ROM needed for this program).";

export interface RunInput {
  text: string;
  model: Model;
  /** The stored ROM for the model, or null to run on the stub. */
  rom: Uint8Array | null;
  runner: Omit<RunnerOptions, 'machine' | 'result' | 'stub'>;
  /** The source's breakpoints, as source lines (5C Ruling 8). */
  breakpoints?: readonly number[];
}

/** What one Run came to. `bytes` is the program's .CMD, whenever it assembled to one. */
export type RunOutcome = {
  result: AsmResult;
  diagnostics: readonly Diagnostic[];
  notes: readonly Diagnostic[];
  bytes: Uint8Array | null;
  message: string;
  problem: boolean;
  /** The first error's line, when it did not assemble. */
  errorLine: number | null;
  runner: Runner | null;
  /** The runner's breakpoints and stepping, whenever there is a runner. */
  stepper: Stepper | null;
  /** The breakpoint lines with no instruction to stop at. */
  inactive: number[];
};

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

export function runOnce(kit: RunKit, input: RunInput): RunOutcome {
  const { text, model, rom } = input;
  const result = kit.assemble(text, { model });
  const base = { result, diagnostics: result.diagnostics, notes: [] as Diagnostic[], bytes: null, errorLine: null, runner: null, stepper: null, inactive: [] as number[], problem: true };
  if (!result.ok) {
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    const first = errors[0]!;
    return {
      ...base,
      errorLine: first.line,
      message: `The program has ${plural(errors.length, 'error')}, so it did not run. The first is on line ${first.line}: ${first.message.replace(/\.?$/, '.')} Fix it in Source ✎, then press Run again.`,
    };
  }
  const lines = text.split(/\r\n|\r|\n/);
  const notes: Diagnostic[] = kit.romNotes(result, model).map((f) => ({ line: f.line, column: 1, endColumn: (lines[f.line - 1]?.length ?? 0) + 1, severity: 'warning', message: f.text }));
  let bytes: Uint8Array;
  try {
    bytes = kit.toCmd(result);
  } catch (err) {
    return { ...base, notes, message: `${err instanceof Error ? err.message : String(err)} Write some instructions in Source ✎, then press Run again.` };
  }
  const refused = kit.romSpaceCode(result, model) ?? (rom === null ? kit.romUse(result, model) : null);
  if (refused !== null) return { ...base, notes, bytes, message: refused.text };
  try {
    const machine = kit.prepareMachine({ model, rom: rom ?? kit.stubRom(model), result, cmd: bytes });
    const opts = input.runner;
    let stepper: Stepper | null = null;
    const runner = kit.createRunner({
      ...opts,
      machine,
      result,
      stub: rom === null,
      onPause: (r) => {
        stepper?.clearTemps();
        opts.onPause?.(r);
      },
      onStop: (r) => {
        stepper?.clearTemps();
        opts.onStop?.(r);
      },
    });
    stepper = kit.createStepper(runner);
    const { inactive } = stepper.setBreakpoints(input.breakpoints ?? []);
    return { ...base, notes, bytes, runner, stepper, inactive, problem: false, message: rom === null ? STUB_RUNNING : `Running on your ${kit.MODEL_NAMES[model]} ROM.` };
  } catch (err) {
    // The boot's own failures are sentences already; anything else is the emulator's, wrapped in one.
    const message =
      err instanceof kit.SentenceError
        ? err.message
        : `The emulator could not start the program (${err instanceof Error ? err.message.replace(/\.$/, '') : String(err)}). Press Run to try again, or reload the page if it happens again.`;
    return { ...base, notes, bytes, message };
  }
}
