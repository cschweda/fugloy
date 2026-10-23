/**
 * MAME as the Model I's trace reference (emu phase 7, Model I, Task 3). The refusal, trace-file and
 * follow tests always run: they need no MAME (a fake binary, synthetic ROMs, and traces written
 * from our own machine stand in). The rest run with FUGLOY_MAME=1 and then need MAME 0.289
 * (`brew install mame`, `pnpm mame:install`) and the Model I ROM (fugloy.mcp.json, roms.model1);
 * either missing fails them (gate.js).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { clockHz, Machine } from '../../src/index.js';
import { compareRun, formatReport, keyEvents, videoGate } from './compare.js';
import { mameSkip, requireRom } from './gate.js';
import { checkMame, checkRomSet, IRQ, loadRuns, MAME_CLOCK_HZ, MAME_ROMS, MAME_VERSION, openTrace, recordMameTrace, writeTrace } from './mame-trace.js';
import { recordOurs, syntheticRom } from './own-trace.js';
import { configuredRom } from '../rom.js';

const dir = mkdtempSync(join(tmpdir(), 'fugloy-mame-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const CLI = fileURLToPath(new URL('../../scripts/mame-trace.mjs', import.meta.url));
const DIFF = fileURLToPath(new URL('../../scripts/diff.mjs', import.meta.url));
/** `pnpm diff --model 1 --reference mame --trace <file>` with `args`. @param {string} trace @param {string[]} args */
const diffTrace = (trace, args) => spawnSync(process.execPath, [DIFF, '--model', '1', '--reference', 'mame', '--trace', trace, ...args], { encoding: 'utf8' });
const SEA_DRAGON = fileURLToPath(new URL('../../../../examples/sea-dragon/seadrg01.cmd', import.meta.url));
/**
 * `pnpm diff examples/sea-dragon/seadrg01.cmd --model 1 --reference mame` with `args`: no trace is
 * named, so the command records the program's own. Its temporary folder is `tmp`, a folder of the
 * test's own, so that what the run leaves there can be seen.
 * @param {string[]} args @param {string} tmp @param {NodeJS.ProcessEnv} [env]
 */
const diffRecord = (args, tmp, env = {}) => spawnSync(process.execPath, [DIFF, SEA_DRAGON, '--model', '1', '--reference', 'mame', ...args], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmp, ...env } });
let tmps = 0;
/** A new empty folder under the test folder, for a command's TMPDIR. */
const freshTmp = () => {
  const path = join(dir, `cli-tmp-${++tmps}`);
  mkdirSync(path);
  return path;
};

/** A shell script at `rel` under the test folder. @param {string} rel @param {string} body */
function script(rel, body) {
  const path = join(dir, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe('MAME refuses what it cannot trust (Review Focus 1)', () => {
  it('names brew install mame when there is no MAME', () => {
    const bin = join(dir, 'no-such-mame');
    expect(() => checkMame({ bin })).toThrow(`no MAME at ${bin}; install MAME 0.289 with \`brew install mame\`, then run \`pnpm mame:install\``);
  });

  it('refuses a MAME that is not Homebrew\'s 0.289, by the Cellar folder it resolves into', () => {
    const bin = script('Cellar/mame/0.288/bin/mame', `echo '${MAME_VERSION}'`);
    expect(() => checkMame({ bin })).toThrow(`${bin} is not Homebrew's MAME 0.289 (it resolves to ${realpathSync(bin)}); install it with \`brew install mame\`, then run \`pnpm mame:install\``);
  });

  it('refuses a MAME whose -version is not the pinned one', () => {
    const bin = script('Cellar/mame/0.289/bin/mame', "echo '0.288 (mame0288)'");
    expect(() => checkMame({ bin })).toThrow(`${bin} says it is MAME 0.288 (mame0288), not the pinned 0.289 (unknown); install MAME 0.289 with \`brew install mame\`, then run \`pnpm mame:install\``);
  });

  it('accepts a binary that is both, and says which', () => {
    const bin = script('Cellar/mame/0.289/bin/mame-ok', `echo '${MAME_VERSION}'`);
    expect(checkMame({ bin })).toEqual({ path: bin, version: MAME_VERSION });
  });

  it('refuses a ROM whose pieces match neither of the driver\'s sets, naming their CRCs', () => {
    const rom = new Uint8Array(12288);
    expect(() => checkRomSet({ dir, rom })).toThrow('the Model I ROM (roms.model1) splits into 4K pieces with CRCs c71c0011, c71c0011, c71c0011, which match neither of MAME 0.289\'s trs80l2 sets (level2: 37c59db2, 05818718, 306e5d66; rsl2: be46faf5, 6c791c2d, 55b3ad13), so MAME cannot run it');
    expect(() => checkRomSet({ dir, rom: new Uint8Array(16384) })).toThrow('a Model I Level II ROM is 12,288 bytes; this one is 16384');
  });
});

// --- Traces written from our own machine: the format and the follow plumbing, without MAME. ---

/**
 * The synthetic ROM (own-trace.js): after DI, LD SP,$8000 and IM 1, EI, then a loop reading
 * keyboard row 0 into $5000 (LD A,($3801) / LD ($5000),A / NOP / JR back); the IM 1 handler at
 * $0038 reads $37E0 into $5001.
 */
const ROM = syntheticRom([0xfb, 0x3a, 0x01, 0x38, 0x32, 0x00, 0x50, 0x00, 0x18, 0xf7]);
const romPath = join(dir, 'synthetic.rom');
writeFileSync(romPath, ROM);
const newSynthetic = () => new Machine({ model: 1, roms: { level2: ROM } });

/** A machine that pressed A (row 0 bit 1) and ran `steps` with its interrupts, as a trace. */
function keyedTrace(steps = 20_000) {
  const b = newSynthetic();
  b.system.keyboard.pressKey(0, 1);
  return recordOurs(b, steps);
}

describe('a trace file replays as a Reference that our machine follows', () => {
  it('writes and reads back records exactly, about nine bytes each', () => {
    const t = keyedTrace(2_000);
    const path = join(dir, 'roundtrip.fmt');
    writeTrace(path, { header: {}, ...t });
    const ref = openTrace(path);
    for (let k = 0; k < 2_000; k++) {
      const rec = t.records[k];
      expect(ref.regs().pc).toBe(rec.w[0]);
      const s = ref.step();
      expect(s.cycles).toBe(t.records[k + 1].total - rec.total);
      expect(ref.writes()).toEqual(rec.writes);
    }
    ref.close?.();
    expect(statSync(path).size - 4096 - 2 * 65536).toBeLessThan(2_000 * 16);
  });

  it('keyboard bytes from the trace reach our matrix at the recorded reads', () => {
    const t = keyedTrace();
    const path = join(dir, 'keyed.fmt');
    writeTrace(path, { header: {}, ...t });
    expect(t.records.some((r) => r.reads.some((x) => x.addr === 0x3801 && x.value === 0x02))).toBe(true);
    const m = newSynthetic();
    const r = compareRun({ machine: m, reference: openTrace(path), instructions: 20_000 });
    expect(r.divergence).toBeNull();
    expect(r.ended).toBeUndefined();
    expect(r.known).toEqual({});
    // Ours stored the key the trace read, with no key down in its own matrix.
    expect(m.mem.read(0x5000, 1)[0]).toBe(0x02);
    expect([...m.system.keyboard.rows].every((x) => x === 0)).toBe(true);
  });

  it('takes the trace\'s interrupts where it took them, and starts in its power-on state', () => {
    const t = keyedTrace();
    const irqs = t.records.flatMap((r, k) => (r.kind === IRQ ? [k] : []));
    expect(irqs.length).toBeGreaterThan(0);
    const path = join(dir, 'irq.fmt');
    // MAME's power-on video RAM is $00, ours spaces: the trace's wins.
    t.start.fill(0, 0x3c00, 0x4000);
    writeTrace(path, { header: {}, ...t });
    const m = newSynthetic();
    const r = compareRun({ machine: m, reference: openTrace(path), instructions: 20_000 });
    expect(r.divergence).toBeNull();
    expect(m.mem.read(0x5001, 1)[0]).toBe(0x80); // the handler read the clock bit
  });

  it('reports irqTime where the trace took no interrupt and ours would have (MAME\'s request later)', () => {
    const b = newSynthetic();
    b.system.nextRtcAt += 200;
    const t = recordOurs(b, 20_000);
    const j = t.records.findIndex((r) => r.kind === IRQ);
    const path = join(dir, 'irq-late.fmt');
    writeTrace(path, { header: {}, ...t });
    const r = compareRun({ machine: newSynthetic(), reference: openTrace(path), instructions: 20_000 });
    expect(r.divergence?.fields).toEqual(['irqTime']);
    expect(r.divergence?.known).toBeNull();
    // Ours was asked for it at its own 40 Hz tick, a few instructions before the trace's.
    expect(r.divergence?.index).toBeLessThan(j);
    expect(r.divergence?.index).toBeGreaterThan(j - 60);
  });

  it('reports irqTime where the trace took an interrupt ours had not been asked for (MAME\'s request earlier)', () => {
    const b = newSynthetic();
    b.system.nextRtcAt -= 200;
    const t = recordOurs(b, 20_000);
    const j = t.records.findIndex((r) => r.kind === IRQ);
    const path = join(dir, 'irq-early.fmt');
    writeTrace(path, { header: {}, ...t });
    const r = compareRun({ machine: newSynthetic(), reference: openTrace(path), instructions: 20_000 });
    expect(r.divergence?.index).toBe(j);
    expect(r.divergence?.fields).toEqual(['irqTime']);
  });

  it('reports keys where ours read the keyboard and the trace did not', () => {
    const t = keyedTrace();
    const j = t.records.findIndex((r) => r.reads.length > 0);
    t.records[j] = { ...t.records[j], reads: [] };
    const path = join(dir, 'keys-missing.fmt');
    writeTrace(path, { header: {}, ...t });
    const r = compareRun({ machine: newSynthetic(), reference: openTrace(path), instructions: 20_000 });
    expect(r.divergence?.index).toBe(j);
    expect(r.divergence?.fields).toContain('keys');
  });

  it('refuses keys, syncing and pokes: the trace brings its own', () => {
    const t = keyedTrace(10);
    const path = join(dir, 'small.fmt');
    writeTrace(path, { header: {}, ...t });
    const ref = openTrace(path);
    expect(() => compareRun({ machine: newSynthetic(), reference: ref, instructions: 5, keys: [{ at: 0, row: 0, bit: 0, down: true }] })).toThrow('compareRun: a trace reference brings its own keys (the bytes its keyboard reads returned); pass none');
    expect(() => ref.syncFrom(newSynthetic())).toThrow('a MAME trace cannot be synced (Ruling 4: our machine follows it instead)');
    expect(() => ref.poke(0x4000, [1])).toThrow('a MAME trace cannot be written (Ruling 4: our machine follows it instead)');
    const ran = newSynthetic();
    ran.step(1);
    expect(() => compareRun({ machine: ran, reference: openTrace(path), instructions: 5 })).toThrow('a MAME trace starts at power-on; this machine has already run');
  });
});

/**
 * A small .CMD (emu phase 7, Task 5): at $5100 it stores $42 at $5200, then ORs keyboard row 6
 * ($3840, ENTER in bit 0) into $5300 for ever; a second block puts 'a' ($61) in video RAM's first
 * cell, which the Model I's gate reads as '!' ($21).
 */
const PROGRAM = Uint8Array.from([
  0x01, 0x11, 0x00, 0x51, 0x3e, 0x42, 0x32, 0x00, 0x52, 0x3a, 0x40, 0x38, 0x21, 0x00, 0x53, 0xb6, 0x77, 0x18, 0xf6,
  0x01, 0x03, 0x00, 0x3c, 0x61,
  0x02, 0x02, 0x00, 0x51,
]);
const sha = (/** @type {Uint8Array} */ b) => createHash('sha256').update(b).digest('hex');

describe('a trace that loaded a program: our machine loads it at the same step', () => {
  /**
   * Our machine runs `before` instructions, loads PROGRAM as MAME's debugger does (between the
   * state before an instruction and the instruction), and runs `after` more: in the trace, record
   * `before` keeps the PC the load replaced and its instruction is the program's first.
   */
  const loadedTrace = (before = 5_000, after = 20_000) => {
    const a = newSynthetic();
    const t = recordOurs(a, before - 1);
    const pc = a.cpu.regs.pc;
    a.load.cmd(PROGRAM);
    const u = recordOurs(a, after);
    const first = { ...u.records[0], w: [pc, ...u.records[0].w.slice(1)] };
    const load = { at: before, cycles: 0, sha256: sha(PROGRAM), entry: 0x5100, pc, runs: [{ addr: 0x3c00, len: 1 }, { addr: 0x5100, len: 15 }] };
    return { header: { load, requested: before + after }, start: t.start, records: [...t.records, first, ...u.records.slice(1)], machine: a };
  };

  it('runs into the program where the trace did, its bytes in both memories, video through the gate', () => {
    const { header, start, records } = loadedTrace();
    const path = join(dir, 'loaded.fmt');
    writeTrace(path, { header, start, records });
    const ref = openTrace(path, { program: PROGRAM });
    const m = newSynthetic();
    const r = compareRun({ machine: m, reference: ref, instructions: 25_000 });
    expect(r.divergence).toBeNull();
    expect(r.ended).toBeUndefined();
    expect(r.known).toEqual({});
    expect(m.mem.read(0x5200, 1)[0]).toBe(0x42);
    expect(m.mem.read(0x3c00, 1)[0]).toBe(0x21);
    expect(ref.peek(0x3c00, 1)[0]).toBe(0x61);
    expect(ref.peek(0x5100, 3)).toEqual(PROGRAM.subarray(4, 7));
  });

  it('a load at another step than the trace\'s is a divergence (the PC)', () => {
    const { header, start, records } = loadedTrace();
    const path = join(dir, 'loaded-late.fmt');
    writeTrace(path, { header: { ...header, load: { ...header.load, at: header.load.at + 1 } }, start, records });
    const r = compareRun({ machine: newSynthetic(), reference: openTrace(path, { program: PROGRAM }), instructions: 25_000 });
    expect(r.divergence?.index).toBe(header.load.at);
    expect(r.divergence?.fields).toContain('pc');
  });

  it('refuses to open without the program, or with another one', () => {
    const { header, start, records } = loadedTrace(100, 100);
    const path = join(dir, 'loaded-refuse.fmt');
    writeTrace(path, { header, start, records });
    expect(() => openTrace(path)).toThrow(`${path} loaded a program (SHA-256 ${sha(PROGRAM)}) at instruction 100; give the same program (openTrace's program, pnpm diff's <program>, or pnpm mame:trace lines --program <file>)`);
    const other = PROGRAM.slice();
    other[4] = 0x3d;
    expect(() => openTrace(path, { program: other })).toThrow(`${path} loaded another program (SHA-256 ${sha(PROGRAM)}) than the one given (${sha(other)})`);
  });

  it('loadRuns: consecutive bytes as one run, a later block over an earlier, nothing below $3C00', () => {
    const over = Uint8Array.from([0x01, 0x04, 0x00, 0x60, 0x11, 0x22, 0x01, 0x03, 0x01, 0x60, 0x33, 0x01, 0x03, 0x02, 0x60, 0x44, 0x02, 0x02, 0x00, 0x60]);
    expect(loadRuns(over)).toEqual([{ addr: 0x6000, bytes: Uint8Array.from([0x11, 0x33, 0x44]) }]);
    expect(loadRuns(PROGRAM).map((r) => [r.addr, r.bytes.length])).toEqual([[0x3c00, 1], [0x5100, 15]]);
    const low = Uint8Array.from([0x01, 0x03, 0xff, 0x3b, 0x00, 0x02, 0x02, 0x00, 0x60]);
    expect(() => loadRuns(low)).toThrow('the program writes $3BFF, below $3C00; a MAME session loads only RAM and video RAM');
  });

  it('pnpm diff compares such a trace with its program named, refuses it without, and refuses a program for a trace that loaded none', () => {
    const { header, start, records } = loadedTrace();
    const path = join(dir, 'cli-loaded.fmt');
    writeTrace(path, { header, start, records });
    const program = join(dir, 'program.cmd');
    writeFileSync(program, PROGRAM);
    const run = diffTrace(path, [program, '--rom', romPath]);
    expect(run.stdout).toContain(`compared from power-on, ${program} loaded before instruction ${header.load.at}`);
    expect(run.stdout).toContain('divergence: none');
    expect(run.status).toBe(0);
    const without = diffTrace(path, ['--rom', romPath]);
    expect(without.status).toBe(2);
    expect(without.stderr).toContain(`${path} loaded a program (SHA-256 ${sha(PROGRAM)}) at instruction ${header.load.at}; give the same program (openTrace's program, pnpm diff's <program>, or pnpm mame:trace lines --program <file>)`);
    const plain = join(dir, 'cli-plain.fmt');
    writeTrace(plain, { header: {}, ...keyedTrace(100) });
    const stray = diffTrace(plain, [program, '--rom', romPath]);
    expect(stray.status).toBe(2);
    expect(stray.stderr).toContain(`${plain} loaded no program (pnpm mame:trace record records the ROM's boot and typed keys); pass none`);
  });

  it('pnpm mame:trace lines reads a trace that loaded a program, given it with --program, and names the option without it', () => {
    const { header, start, records } = loadedTrace(100, 100);
    const path = join(dir, 'lines-loaded.fmt');
    writeTrace(path, { header, start, records });
    const program = join(dir, 'lines-program.cmd');
    writeFileSync(program, PROGRAM);
    const run = spawnSync(process.execPath, [CLI, 'lines', path, '--program', program], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const lines = run.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(records.length);
    expect(lines.every((l, k) => l.startsWith(`${k} `))).toBe(true);
    // The load's record as MAME wrote it, with the PC the load replaced (TraceLoad); the next is
    // the state after the program's first instruction, LD A,$42 at $5100.
    const pc = (/** @type {string} */ l) => l.split(' ')[1];
    expect(pc(lines[header.load.at])).toBe(header.load.pc.toString(16).toUpperCase().padStart(4, '0'));
    expect(lines[header.load.at + 1]).toMatch(new RegExp(`^${header.load.at + 1} 5102 42`));
    const without = spawnSync(process.execPath, [CLI, 'lines', path], { encoding: 'utf8' });
    expect(without.status).toBe(2);
    expect(without.stderr).toContain(`${path} loaded a program (SHA-256 ${sha(PROGRAM)}) at instruction ${header.load.at}; give the same program (openTrace's program, pnpm diff's <program>, or pnpm mame:trace lines --program <file>)`);
  });
});

describe('a trace that ends early says so, never "no divergence" (Review Focus 3)', () => {
  const SENTENCE = (n, N, reason) => `MAME's trace ends after ${n} of ${N} instructions (${reason}), so the run proves nothing past that point.`;

  it('a recording MAME did not finish: the reason in its header', () => {
    const t = keyedTrace(100);
    const path = join(dir, 'unfinished.fmt');
    writeTrace(path, { header: { complete: false, reason: 'MAME exited with code 1', requested: 1000 }, ...t });
    const r = compareRun({ machine: newSynthetic(), reference: openTrace(path), instructions: 1000 });
    expect(r.divergence).toBeNull();
    expect(r.instructions).toBe(100);
    expect(r.ended).toBe(SENTENCE(100, 1000, 'MAME exited with code 1'));
    const report = formatReport(r);
    expect(report).toContain(SENTENCE(100, 1000, 'MAME exited with code 1'));
    expect(report).not.toContain('divergence: none');
  });

  it('a file cut short after it was written', () => {
    const t = keyedTrace(1000);
    const path = join(dir, 'cut.fmt');
    writeTrace(path, { header: {}, ...t });
    truncateSync(path, 4096 + 2 * 65536 + 4000);
    const ref = openTrace(path);
    const r = compareRun({ machine: newSynthetic(), reference: ref, instructions: 1000 });
    expect(r.divergence).toBeNull();
    expect(r.instructions).toBeGreaterThan(0);
    expect(r.instructions).toBeLessThan(1000);
    expect(r.ended).toBe(SENTENCE(r.instructions, 1000, `the file is cut short: it holds ${r.instructions + 1} of the 1001 records its header lists`));
  });

  it('a trace with no records (MAME stopped before the first): the sentence, and pnpm diff exits 3 with it', () => {
    const path = join(dir, 'empty.fmt');
    writeTrace(path, { header: { complete: false, reason: 'MAME exited with code 1: no such BIOS', requested: 1000 }, start: new Uint8Array(65536), records: [] });
    const r = compareRun({ machine: newSynthetic(), reference: openTrace(path), instructions: 1000 });
    expect(r).toMatchObject({ instructions: 0, divergence: null, known: {} });
    expect(r.ended).toBe(SENTENCE(0, 1000, 'MAME exited with code 1: no such BIOS'));
    const run = diffTrace(path, ['--instructions', '1000', '--rom', romPath]);
    expect(run.status).toBe(3);
    expect(run.stdout).toContain(SENTENCE(0, 1000, 'MAME exited with code 1: no such BIOS'));
    expect(run.stdout).not.toContain('divergence: none');
  });

  it('a MAME that writes nothing to the trace is stopped after the silence, never waited on, and its trace says why', async () => {
    // Homebrew's 0.289 by its Cellar folder and -version, then silent (it never opens the trace).
    const bin = script('silent/Cellar/mame/0.289/bin/mame', `case "$1" in -version) echo '${MAME_VERSION}';; *) exec sleep 600;; esac`);
    const out = join(dir, 'silent.fmt');
    const t0 = performance.now();
    const rec = await recordMameTrace({ instructions: 100, out, bin, romDir: dir, skipRomCheck: true, silenceMs: 1000 });
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(rec).toEqual({ path: out, instructions: 0 });
    const ref = openTrace(out);
    expect(ref.header).toMatchObject({ complete: false, verified: false, records: 0, reason: 'MAME wrote nothing to the trace for 1 s, so the recorder stopped it' });
    const r = compareRun({ machine: newSynthetic(), reference: ref, instructions: 100 });
    expect(r.ended).toBe(SENTENCE(0, 100, 'MAME wrote nothing to the trace for 1 s, so the recorder stopped it'));
  });

  it('a complete trace shorter than the run', () => {
    const t = keyedTrace(100);
    const path = join(dir, 'short.fmt');
    writeTrace(path, { header: {}, ...t });
    const r = compareRun({ machine: newSynthetic(), reference: openTrace(path), instructions: 500 });
    expect(r.ended).toBe(SENTENCE(100, 500, 'it was recorded for 100 instructions'));
  });

  it('pnpm mame:trace compare points at pnpm diff, where it moved', () => {
    const run = spawnSync(process.execPath, [CLI, 'compare', 'x.fmt'], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('pnpm mame:trace compare moved: run pnpm diff --model 1 --reference mame --trace <file> [--instructions N]');
  });

  it('pnpm diff --reference mame prints the sentence and exits 3', () => {
    const t = keyedTrace(100);
    const path = join(dir, 'cli-short.fmt');
    writeTrace(path, { header: { complete: false, reason: 'MAME stopped at its time limit of 6 emulated seconds', requested: 1000 }, ...t });
    const run = diffTrace(path, ['--instructions', '1000', '--rom', romPath]);
    expect(run.status).toBe(3);
    expect(run.stdout).toContain(SENTENCE(100, 1000, 'MAME stopped at its time limit of 6 emulated seconds'));
    expect(run.stdout).not.toContain('divergence: none');
    // The whole trace compared: 0. The report names the schedule our 40 Hz ran on.
    const full = diffTrace(path, ['--instructions', '100', '--rom', romPath]);
    expect(full.stdout).toContain('divergence: none');
    expect(full.stdout).toContain('our 40 Hz on MAME\'s clock (1,774,083 Hz): test-only, test/diff/mame-clock.js\n');
    expect(full.status).toBe(0);
  });
});

describe('the silence watchdog stops only a MAME that wrote nothing (the Model I sweep, Review Focus 3)', () => {
  /**
   * A stand-in for Homebrew's MAME 0.289 at `rel` (its Cellar folder and -version) that records a
   * whole trace: FUGLOY_MAME_RECORDS records, each one's PC its index, and no memory writes, so its
   * start and end memory (64K of zeros) agree with the records and the recording verifies. Before
   * the records it writes lines the recorder reads and ignores for `busy` seconds, so it is never
   * silent; after closing the trace it takes `exit` seconds to exit (as one process, so a SIGKILL
   * ends it), as MAME does while it shuts down.
   * @param {string} rel @param {{ busy?: number, exit?: number }} opts
   */
  const wholeTrace = (rel, { busy = 0, exit = 0 }) => script(rel, [
    `case "$1" in -version) echo '${MAME_VERSION}'; exit 0;; esac`,
    'head -c 65536 /dev/zero > "$FUGLOY_MAME_START"',
    'cp "$FUGLOY_MAME_START" "$FUGLOY_MAME_END"',
    '{',
    `  end=$(( $(date +%s) + ${busy} ))`,
    '  while [ "$(date +%s)" -lt "$end" ]; do i=0; while [ $i -lt 200 ]; do echo "W 0000 00"; i=$((i+1)); done; done',
    '  i=0',
    '  while [ $i -lt "$FUGLOY_MAME_RECORDS" ]; do',
    '    printf "T %04X 0000 0000 0000 0000 0000 0000 0000 0000 FFFF FFFF 0000 00 00 0 0 0 %d 00\\n" $i $((i * 4))',
    '    i=$((i+1))',
    '  done',
    '  echo E',
    '} > "$FUGLOY_MAME_TRACE"',
    `exec sleep ${exit}`,
  ].join('\n'));
  const whole = { complete: true, verified: true, records: 11, reason: null };

  it('a busy recorder does not take MAME for silent', async () => {
    const bin = wholeTrace('busy/Cellar/mame/0.289/bin/mame', { busy: 4 });
    const out = join(dir, 'busy.fmt');
    const recording = recordMameTrace({ instructions: 10, out, bin, romDir: dir, skipRomCheck: true, silenceMs: 1000 });
    // The recorder's own event loop blocked for 2.5 s while MAME writes on, as another session's
    // synchronous compareRun blocks it when recordings run at once (outside the timers phase, so
    // the watchdog's tick comes before the trace's waiting data when the loop runs again).
    setTimeout(() => setImmediate(() => {
      const t = Date.now();
      while (Date.now() - t < 2_500);
    }), 500);
    expect(await recording).toEqual({ path: out, instructions: 10 });
    const ref = openTrace(out);
    expect(ref.header).toMatchObject(whole);
    ref.close?.();
  }, 30_000);

  it('the watchdog ends with the stream: a MAME slow to exit after its last record leaves the trace complete', async () => {
    const bin = wholeTrace('slow-exit/Cellar/mame/0.289/bin/mame', { exit: 3 });
    const out = join(dir, 'slow-exit.fmt');
    expect(await recordMameTrace({ instructions: 10, out, bin, romDir: dir, skipRomCheck: true, silenceMs: 1000 })).toEqual({ path: out, instructions: 10 });
    const ref = openTrace(out);
    expect(ref.header).toMatchObject(whole);
    ref.close?.();
  }, 30_000);

  it('a MAME that never exits after its last record is stopped, not waited on, and its trace stays whole', async () => {
    const bin = wholeTrace('stuck-exit/Cellar/mame/0.289/bin/mame', { exit: 600 });
    const out = join(dir, 'stuck-exit.fmt');
    const t0 = performance.now();
    expect(await recordMameTrace({ instructions: 10, out, bin, romDir: dir, skipRomCheck: true, silenceMs: 1000 })).toEqual({ path: out, instructions: 10 });
    expect(performance.now() - t0).toBeLessThan(10_000);
    const ref = openTrace(out);
    expect(ref.header).toMatchObject(whole);
    ref.close?.();
  }, 30_000);
});

describe('pnpm diff <program> --model 1 --reference mame records a trace of the program: what it refuses (the Model I sweep, Task 2)', { timeout: 30_000 }, () => {
  // MAME's absence (checkMame) or the ROM's refusal (checkRomSet), whichever comes first: a sentence
  // either way, the one on a machine with no MAME and the other on one with it.
  const REFUSAL = /^(no MAME at |\S+ is not Homebrew's MAME |\S+ says it is MAME |a Model I Level II ROM is 12,288 bytes; this one is \d+|the Model I ROM \(roms\.model1\) splits into 4K pieces)/;
  const shortRom = join(dir, 'short.rom');
  writeFileSync(shortRom, new Uint8Array(100));

  it.each([
    ['a ROM of the right size whose pieces are not the Level II ROM\'s', romPath],
    ['a file too short to be a ROM', shortRom],
  ])('--rom naming %s: exit 2 with a sentence, and nothing left in the temporary folder', (_what, rom) => {
    const tmp = freshTmp();
    const run = diffRecord(['--rom', rom], tmp);
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(REFUSAL);
    expect(run.stderr.trim().split('\n')).toHaveLength(1);
    expect(run.stdout).toBe('');
    // The session's folder is made before MAME is asked for anything, and removed when the
    // recording throws (the Model I sweep's Review Focus 5).
    expect(readdirSync(tmp)).toEqual([]);
  });

  it('a program that is not a .CMD is refused before MAME is asked for anything (the format is told from the content)', () => {
    const program = join(dir, 'not-a-cmd.bin');
    writeFileSync(program, new Uint8Array(64));
    const tmp = freshTmp();
    const run = spawnSync(process.execPath, [DIFF, program, '--model', '1', '--reference', 'mame', '--rom', romPath], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmp } });
    expect(run.status).toBe(2);
    expect(run.stderr).toBe(`${program}: a MAME run loads a .CMD program (the format is told from the content, and this one is not a .CMD)\n`);
    expect(readdirSync(tmp)).toEqual([]);
  });

  it.each([
    ['is not JSON', 'nope', /keys\.json is not JSON: /],
    ['is not a list of presses', '{"at": 1}', /keys\.json: expected a JSON array of \{ "at": T-states, "key": "ENTER", "hold": T-states \(optional\) \}\n$/],
    ['names a key the matrix has not', '[{ "at": 0, "key": "NOSUCHKEY" }]', /keys\.json: press: no matrix key for "NOSUCHKEY"\n$/],
  ])('a --keys script that %s is refused before MAME is asked for anything', (_what, text, sentence) => {
    const keys = join(dir, 'keys.json');
    writeFileSync(keys, text);
    const tmp = freshTmp();
    const run = diffRecord(['--keys', keys, '--rom', romPath], tmp);
    expect(run.status).toBe(2);
    expect(run.stderr.replace(keys, 'keys.json')).toMatch(sentence);
    expect(readdirSync(tmp)).toEqual([]);
  });
});

describe('a program MAME cannot load is refused before the recorder makes anything (the Model I sweep, Review Focus 5)', { timeout: 30_000 }, () => {
  // A .CMD of one byte at $3800 (the keyboard) with its entry at $5200: loadRuns refuses it.
  const low = Uint8Array.from([0x01, 0x03, 0x00, 0x38, 0x00, 0x02, 0x02, 0x00, 0x52]);
  const REFUSED = 'the program writes $3800, below $3C00; a MAME session loads only RAM and video RAM';

  it('recordMameTrace: the refusal, and no work folder left in the temporary folder', async () => {
    // A stand-in that passes for Homebrew's MAME 0.289, so nothing but the program is refused.
    const bin = script('refused/Cellar/mame/0.289/bin/mame', `case "$1" in -version) echo '${MAME_VERSION}'; exit 0;; esac\nexit 1`);
    const tmp = freshTmp();
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = tmp;
    try {
      await expect(recordMameTrace({ instructions: 10, load: { program: low, at: 1000 }, out: join(dir, 'refused.fmt'), bin, romDir: dir, skipRomCheck: true })).rejects.toThrow(REFUSED);
      expect(readdirSync(tmp)).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    }
  });

  it('pnpm diff <program> --model 1 --reference mame: exit 2 with the sentence, and nothing left in the temporary folder', () => {
    const program = join(dir, 'low.cmd');
    writeFileSync(program, low);
    const tmp = freshTmp();
    const run = spawnSync(process.execPath, [DIFF, program, '--model', '1', '--reference', 'mame'], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmp } });
    expect(run.status).toBe(2);
    // With no Model I ROM configured (CI) the command stops at that, before the recorder.
    expect(run.stderr).toBe(configuredRom('model1') === null ? 'no Model I ROM: name one as roms.model1 in fugloy.mcp.json (docs/fugloy-mcp-spec.md §3), or pass --rom\n' : `${REFUSED}\n`);
    expect(readdirSync(tmp)).toEqual([]);
  });
});

describe.skipIf(mameSkip !== null)(`MAME's Model I as a trace${mameSkip === null ? '' : ` (skipped: ${mameSkip})`}`, { timeout: 180_000 }, () => {
  const rom = () => requireRom('model1-mame');
  const newMachine = () => new Machine({ model: 1, roms: { level2: rom() } });

  it('finds the pinned MAME and the ROM set pnpm mame:install assembled', () => {
    expect(checkMame().version).toBe(MAME_VERSION);
    expect(checkRomSet({ rom: rom() })).toEqual({ bios: 'rsl2' });
  });

  it('refuses a ROM set whose CRCs are not the driver\'s, naming pnpm mame:install', () => {
    const copy = join(dir, 'roms');
    cpSync(MAME_ROMS, copy, { recursive: true });
    const piece = join(copy, 'trs80l2', 'rom-b_alt.z2');
    writeFileSync(piece, new Uint8Array(4096));
    expect(() => checkRomSet({ dir: copy, rom: rom() })).toThrow(`${piece} has CRC c71c0011, not the driver's 6c791c2d; run \`pnpm mame:install\` to assemble it again from your Level II ROM`);
  });

  /**
   * Video RAM at the end, compared through the Model I's bit-6 gate (compare.js, Ruling 5): MAME
   * stores the byte the CPU wrote, ours the byte the gate makes (bit 6 = NOR(bit 5, bit 7)), so
   * they compare equal; this pins that the raw bytes do differ, in bit 6 only, so the gate is what
   * makes them equal. Returns how many raw bytes differ.
   * @param {Machine} m @param {import('./reference.js').Reference} ref
   */
  const gateOnly = (m, ref) => {
    const a = m.mem.read(0x3c00, 0x400);
    const b = ref.peek(0x3c00, 0x400);
    let n = 0;
    for (let k = 0; k < 0x400; k++) {
      expect(a[k]).toBe(videoGate(b[k]));
      if (a[k] !== b[k]) n++;
    }
    return n;
  };
  /** @type {string | null} */
  let boot = null;
  const bootTrace = async () => {
    if (boot === null) {
      const out = join(dir, 'boot-100k.fmt');
      const rec = await recordMameTrace({ instructions: 100_000, out });
      expect(rec).toEqual({ path: out, instructions: 100_000 });
      boot = out;
    }
    return boot;
  };

  it('EX (SP),HL at instruction 13,603 writes H to SP+1, then L to SP, in MAME and in ours', async () => {
    const ref = openTrace(await bootTrace());
    const r = compareRun({ machine: newMachine(), reference: ref, instructions: 13_604 });
    expect(r.divergence).toBeNull();
    expect(ref.writes()).toEqual([{ addr: 0x4345, value: 0x01 }, { addr: 0x4344, value: 0x0d }]);
  });

  it('a recorded boot of 100,000 instructions replays against our Model I: the repeating LDIR\'s flags now agree, and video RAM through the gate', async () => {
    const out = await bootTrace();
    const ref = openTrace(out);
    expect(ref.header).toMatchObject({ complete: true, verified: true, bios: 'rsl2', mame: MAME_VERSION, records: 100_001 });
    // MAME's reset state (the spike note): AF 0040, SP 0000, IX and IY FFFF.
    const r0 = ref.regs();
    expect([(r0.a << 8) | r0.f, r0.sp, r0.ix, r0.iy, r0.pc]).toEqual([0x0040, 0, 0xffff, 0xffff, 0]);
    // Task 1's 5,112 flag rows (LDIR at $067F and $007E while it repeats) took bits 3 and 5 from
    // PC in MAME; our core does too now (z80cpu.js _xyRepeat), so nothing is left to count.
    const m = newMachine();
    const r = compareRun({ machine: m, reference: ref, instructions: 100_000 });
    expect(r.instructions).toBe(100_000);
    expect(r.divergence).toBeNull();
    expect(r.ended).toBeUndefined();
    expect(gateOnly(m, ref)).toBeGreaterThan(0);
    // Instruction 8,272, LD D,(HL) at $0486 with HL $3C00 (the spike's D difference): MAME reads
    // its power-on $00, a Model I $40 through the gate; ours takes MAME's byte, and it is counted.
    expect(r.known).toEqual({ 'video read: the reference returns bit 6 as written (no gate)': 1 });
  });

  it('keyboard bytes MAME read reach our matrix at the recorded reads: ENTER at MEM SIZE? gives READY on both', async () => {
    const out = join(dir, 'enter.fmt');
    await recordMameTrace({ instructions: 700_000, keys: [{ at: 400_000, text: '\r' }], out });
    const ref = openTrace(out);
    const m = newMachine();
    const r = compareRun({ machine: m, reference: ref, instructions: 700_000 });
    expect(r.instructions).toBe(700_000);
    expect(r.divergence).toBeNull();
    expect(gateOnly(m, ref)).toBeGreaterThan(0);
    expect(Object.keys(r.known)).toEqual(['video read: the reference returns bit 6 as written (no gate)']);
    expect(m.video.text().slice(0, 3).map((l) => l.trim())).toEqual(['MEM SIZE?', 'R/S L2 BASIC', 'READY']);
    expect([...m.system.keyboard.rows].every((x) => x === 0)).toBe(true);
  });

  it('a recording MAME does not finish is reported with its reason, never as passing', async () => {
    // A MAME killed by SIGALRM after two seconds of wall time, in a Cellar folder of its own.
    const real = checkMame().path;
    const bin = script('alarm/Cellar/mame/0.289/bin/mame', `case "$1" in -version) exec '${real}' -version;; esac\nexec perl -e 'alarm 2; exec @ARGV' '${real}' "$@"`);
    const out = join(dir, 'killed.fmt');
    const rec = await recordMameTrace({ instructions: 5_000_000, out, bin });
    expect(rec.instructions).toBeGreaterThan(0);
    expect(rec.instructions).toBeLessThan(5_000_000);
    const ref = openTrace(out);
    expect(ref.header).toMatchObject({ complete: false, verified: false, reason: 'MAME exited on SIGALRM' });
    const r = compareRun({ machine: newMachine(), reference: ref, instructions: 5_000_000 });
    expect(r.instructions).toBe(rec.instructions);
    expect(r.ended).toBe(`MAME's trace ends after ${rec.instructions} of 5000000 instructions (MAME exited on SIGALRM), so the run proves nothing past that point.`);
    expect(formatReport(r)).toContain(/** @type {string} */ (r.ended));
    ref.close?.();
    // The CLI never reports a killed recording as passing: a divergence (1) or the sentence (3).
    const run = diffTrace(out, ['--instructions', '5000000']);
    expect([1, 3]).toContain(run.status);
    expect(run.stdout).not.toContain('divergence: none');
  });

  it('loads a program at READY and holds a matrix key: ours loads it at the same step and reads the key MAME read', async () => {
    const out = join(dir, 'mame-load.fmt');
    const HZ = MAME_CLOCK_HZ;
    // ENTER at MEM SIZE?, the program at 4 s (READY), then ENTER held 0.2 s from 4.5 s.
    const matrix = keyEvents([{ at: 0.5 * HZ, key: 'ENTER', hold: 0.1 * HZ }, { at: 4.5 * HZ, key: 'ENTER', hold: 0.2 * HZ }]);
    const rec = await recordMameTrace({ instructions: 300_000, matrix, load: { program: PROGRAM, at: 4 * HZ }, out });
    const ref = openTrace(out, { program: PROGRAM });
    expect(ref.header).toMatchObject({ complete: true, verified: true, matrix: 4, load: { at: rec.load?.at, entry: 0x5100, sha256: sha(PROGRAM) } });
    expect(ref.header.requested).toBe(/** @type {number} */ (rec.load?.at) + 300_000);
    const m = newMachine();
    const r = compareRun({ machine: m, reference: ref, instructions: ref.header.requested });
    expect(r.divergence).toBeNull();
    expect(r.ended).toBeUndefined();
    expect(m.video.text().slice(0, 3).map((l) => l.trim())).toEqual(['!EM SIZE?', 'R/S L2 BASIC', 'READY']);
    expect([...m.mem.read(0x5200, 1)]).toEqual([0x42]);
    expect([...m.mem.read(0x5300, 1)]).toEqual([0x01]);
    expect(gateOnly(m, ref)).toBeGreaterThan(0);
  });

  it('records the same trace twice, byte for byte', async () => {
    const a = await recordMameTrace({ instructions: 20_000, out: join(dir, 'det-a.fmt') });
    const b = await recordMameTrace({ instructions: 20_000, out: join(dir, 'det-b.fmt') });
    expect(readFileSync(a.path).equals(readFileSync(b.path))).toBe(true);
  });

  it('pnpm diff <program> --model 1 --reference mame records the program\'s own trace, follows it on MAME\'s 40 Hz schedule, and removes it', () => {
    const tmp = freshTmp();
    const run = diffRecord(['--instructions', '200000'], tmp);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`${SEA_DRAGON} loaded before instruction `);
    expect(run.stdout).toContain('our 40 Hz on MAME\'s clock (1,774,083 Hz): test-only, test/diff/mame-clock.js\n');
    expect(run.stdout).toContain('reference: MAME 0.289 trace, Model I\n');
    expect(run.stdout).toContain('divergence: none');
    // Without keys Sea Dragon is still on its title, so there is no prompt on MAME's screen.
    expect(run.stdout).toContain('MAME\'s screen at the end');
    expect(run.stdout).not.toContain('1 OR 2 PLAYERS?');
    // The trace (about 9 bytes an instruction) and the recorder's work folder are both gone.
    expect(readdirSync(tmp)).toEqual([]);
  }, 300_000);

  it('with --keys the keys arrive: ENTER on Sea Dragon\'s title reaches "1 OR 2 PLAYERS?" on MAME\'s screen', () => {
    // [{ at: T-states after the load, key, hold: T-states }], as a lockstep run takes them: ENTER a
    // second after the load, held half a second (Sea Dragon takes it from its first screen on, and
    // its prompt is up about a tenth of a second later; its credits come at 5.6 s).
    const hz = clockHz(1);
    const keys = join(dir, 'enter.json');
    writeFileSync(keys, JSON.stringify([{ at: hz, key: 'ENTER', hold: hz / 2 }]));
    const tmp = freshTmp();
    const run = diffRecord(['--keys', keys, '--instructions', '300000'], tmp);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('divergence: none');
    expect(run.stdout).toContain('1 OR 2 PLAYERS?');
    expect(readdirSync(tmp)).toEqual([]);
  }, 300_000);

  it('a MAME that stops before the program is loaded is reported as a trace that ends early (exit 3, no screen), and nothing is left behind', () => {
    // A stand-in that passes for Homebrew's 0.289 by its Cellar folder and -version, then exits
    // at once, first on the command's PATH (the real ROM set is still checked: roms.model1 is needed).
    const bin = script('dies/Cellar/mame/0.289/bin/mame', `case "$1" in -version) echo '${MAME_VERSION}'; exit 0;; esac\nexit 1`);
    const tmp = freshTmp();
    const run = diffRecord(['--instructions', '1000'], tmp, { PATH: `${dirname(bin)}${delimiter}${process.env.PATH}` });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(3);
    expect(run.stdout).toContain('instructions compared: 0\n');
    expect(run.stdout).toContain('MAME\'s trace ends after 0 of 1000 instructions (MAME never reached the load at 7096320 T-states), so the run proves nothing past that point.\n');
    expect(run.stdout).not.toContain('divergence: none');
    expect(run.stdout).not.toContain('loaded before instruction');
    expect(run.stdout).not.toContain('screen at the end');
    expect(readdirSync(tmp)).toEqual([]);
  }, 60_000);
});
