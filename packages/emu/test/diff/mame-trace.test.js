/**
 * MAME as the Model I's trace reference (emu phase 7, Model I, Task 3). The refusal, trace-file and
 * follow tests always run: they need no MAME (a fake binary, synthetic ROMs, and traces written
 * from our own machine stand in). The rest run with FUGLOY_MAME=1 and then need MAME 0.289
 * (`brew install mame`, `pnpm mame:install`) and the Model I ROM (fugloy.mcp.json, roms.model1);
 * either missing fails them (gate.js).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { compareRun, formatReport } from './compare.js';
import { mameSkip, requireRom } from './gate.js';
import { STEP_CLASSES } from './known.js';
import { checkMame, checkRomSet, IRQ, MAME_ROMS, MAME_VERSION, openTrace, recordMameTrace, writeTrace } from './mame-trace.js';

const dir = mkdtempSync(join(tmpdir(), 'fugloy-mame-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const CLI = fileURLToPath(new URL('../../scripts/mame-trace.mjs', import.meta.url));

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
 * A 12K ROM: DI, LD SP,$8000, IM 1, EI, then a loop reading keyboard row 0 into $5000; the IM 1
 * handler at $0038 reads $37E0 into $5001.
 */
function syntheticRom() {
  const rom = new Uint8Array(12288);
  rom.set([0xf3, 0x31, 0x00, 0x80, 0xed, 0x56, 0xfb, 0x3a, 0x01, 0x38, 0x32, 0x00, 0x50, 0x00, 0x18, 0xf7], 0);
  rom.set([0xf5, 0x3a, 0xe0, 0x37, 0x32, 0x01, 0x50, 0xf1, 0xfb, 0xed, 0x4d], 0x38);
  return rom;
}
const ROM = syntheticRom();
const romPath = join(dir, 'synthetic.rom');
writeFileSync(romPath, ROM);
const newSynthetic = () => new Machine({ model: 1, roms: { level2: ROM } });

/**
 * Records in the trace format from our machine, as MAME's would be: the state before each
 * instruction after any response, IFF1 set from EI on, the step's writes (the push first) and its
 * keyboard and latch reads.
 * @param {Machine} m @param {number} steps
 * @returns {{ start: Uint8Array, records: import('./mame-trace.js').TraceRecord[] }}
 */
function recordOurs(m, steps) {
  const sys = m.system;
  const cpu = sys.cpu;
  const mem = sys.memory;
  const start = m.mem.read(0, 0x10000);
  /** @type {import('./mame-trace.js').TraceRecord[]} */
  const records = [];
  /** @type {{ addr: number, value: number }[]} */
  let writes = [];
  /** @type {{ addr: number, value: number }[]} */
  let reads = [];
  /** @type {0 | 1} */
  let kind = 0;
  let inExec = false;
  const w = mem.writeByte;
  const r = mem.readByte;
  const intr = cpu.interrupt;
  const exec = cpu.executeInstruction;
  mem.writeByte = (/** @type {number} */ a, /** @type {number} */ v) => { writes.push({ addr: a & 0xffff, value: v & 0xff }); w.call(mem, a, v); };
  mem.readByte = (/** @type {number} */ a) => {
    const v = r.call(mem, a);
    if (inExec && ((a >= 0x3800 && a < 0x3c00) || (a >= 0x37e0 && a < 0x37e4))) reads.push({ addr: a, value: v });
    return v;
  };
  cpu.interrupt = (/** @type {number | undefined} */ b) => {
    const t = intr.call(cpu, b);
    if (t) kind = IRQ;
    return t;
  };
  cpu.executeInstruction = () => {
    const x = m.cpu.regs;
    const ei = cpu.pendingEI > 0;
    const word = (/** @type {number} */ hi, /** @type {number} */ lo) => (hi << 8) | lo;
    records.push({
      w: [x.pc, word(x.a, x.f), word(x.b, x.c), word(x.d, x.e), word(x.h, x.l), word(x.a2, x.f2), word(x.b2, x.c2), word(x.d2, x.e2), word(x.h2, x.l2), x.ix, x.iy, x.sp],
      i: x.i, r: x.r, iff1: x.iff1 || ei, iff2: x.iff2 || ei, im: x.im, total: cpu.cycles, kind, writes, reads,
    });
    inExec = true;
    try {
      return exec.call(cpu);
    } finally {
      inExec = false;
    }
  };
  try {
    for (let k = 0; k <= steps; k++) {
      writes = [];
      reads = [];
      kind = 0;
      m.step(1);
    }
  } finally {
    delete mem.writeByte;
    delete mem.readByte;
    delete cpu.interrupt;
    delete cpu.executeInstruction;
  }
  return { start, records };
}

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

  it('a complete trace shorter than the run', () => {
    const t = keyedTrace(100);
    const path = join(dir, 'short.fmt');
    writeTrace(path, { header: {}, ...t });
    const r = compareRun({ machine: newSynthetic(), reference: openTrace(path), instructions: 500 });
    expect(r.ended).toBe(SENTENCE(100, 500, 'it was recorded for 100 instructions'));
  });

  it('the CLI prints the sentence and exits 3', () => {
    const t = keyedTrace(100);
    const path = join(dir, 'cli-short.fmt');
    writeTrace(path, { header: { complete: false, reason: 'MAME stopped at its time limit of 6 emulated seconds', requested: 1000 }, ...t });
    const run = spawnSync(process.execPath, [CLI, 'compare', path, '--instructions', '1000', '--rom', romPath], { encoding: 'utf8' });
    expect(run.status).toBe(3);
    expect(run.stdout).toContain(SENTENCE(100, 1000, 'MAME stopped at its time limit of 6 emulated seconds'));
    expect(run.stdout).not.toContain('divergence: none');
    // The whole trace compared: 0.
    const full = spawnSync(process.execPath, [CLI, 'compare', path, '--instructions', '100', '--rom', romPath], { encoding: 'utf8' });
    expect(full.stdout).toContain('divergence: none');
    expect(full.status).toBe(0);
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
   * Our machine with EX (SP),HL writing H to SP+1 before L to SP, as MAME's does (ours writes L
   * first, as xtrs's mem_write_word does). Which order the Z80 uses is Task 4's to decide and cite
   * (Ruling 6); until then the MAME sessions run with this test-only patch, and the test below
   * pins the one difference it hides.
   */
  const mameOrder = () => {
    const m = newMachine();
    const cpu = /** @type {any} */ (m.system.cpu);
    cpu.opcodeHandlers[0xe3] = () => {
      const sp = cpu.registers.SP;
      const temp = (cpu.readMemory((sp + 1) & 0xffff) << 8) | cpu.readMemory(sp);
      cpu.writeMemory((sp + 1) & 0xffff, cpu.registers.H);
      cpu.writeMemory(sp, cpu.registers.L);
      cpu.HL = temp;
      cpu.wz = temp;
      return 19;
    };
    return m;
  };
  /**
   * The end-of-run video comparison: MAME stores the byte the CPU wrote, ours applies the Model I's
   * bit-6 gate (bit 6 = NOT bit 5, no lowercase), so the bytes differ in bit 6 only. Task 4 compares
   * video RAM through the gate (the plan's Files list); until then this pins that it is the only
   * difference.
   * @param {import('./compare.js').CompareResult} r @param {Machine} m @param {import('./reference.js').Reference} ref
   */
  const onlyGate = (r, m, ref) => {
    expect(r.divergence?.kind).toBe('video');
    expect(r.divergence?.fields).toEqual(['video']);
    const a = m.mem.read(0x3c00, 0x400);
    const b = ref.peek(0x3c00, 0x400);
    let n = 0;
    for (let k = 0; k < 0x400; k++) {
      if (a[k] === b[k]) continue;
      n++;
      expect([a[k] ^ b[k], b[k] & 0x20, a[k] & 0x40]).toEqual([0x40, 0, 0x40]);
    }
    expect(n).toBe(r.divergence?.video.differing);
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

  it('finds one difference no class explains in the boot: EX (SP),HL writes H first in MAME, L first in ours (for Task 4)', async () => {
    const r = compareRun({ machine: newMachine(), reference: openTrace(await bootTrace()), instructions: 100_000 });
    const d = /** @type {import('./compare.js').Divergence} */ (r.divergence);
    expect([d.index, d.pc, d.fields]).toEqual([13_603, 0x287d, ['writes']]);
    expect(d.context.find((l) => l.index === d.index)?.text).toBe('EX (SP),HL');
    expect(d.writes).toEqual({ ours: [{ addr: 0x4344, value: 0x0d }, { addr: 0x4345, value: 0x01 }], theirs: [{ addr: 0x4345, value: 0x01 }, { addr: 0x4344, value: 0x0d }] });
  });

  it('a recorded boot of 100,000 instructions replays against our Model I with only Task 1\'s classes (EX (SP),HL in MAME\'s order)', async () => {
    const out = await bootTrace();
    const ref = openTrace(out);
    expect(ref.header).toMatchObject({ complete: true, verified: true, bios: 'rsl2', mame: MAME_VERSION, records: 100_001 });
    // MAME's reset state (the spike note): AF 0040, SP 0000, IX and IY FFFF.
    const r0 = ref.regs();
    expect([(r0.a << 8) | r0.f, r0.sp, r0.ix, r0.iy, r0.pc]).toEqual([0x0040, 0, 0xffff, 0xffff, 0]);
    // Every flag 3/5 difference is the MAME-only one Task 1 found: a repeating LDIR (Task 4 decides it).
    const xy = /** @type {import('./known.js').StepClass} */ (STEP_CLASSES.find((c) => c.id === 'xy'));
    const explains = xy.explains;
    /** @type {{ pc: number, xor: number, bc: number }[]} */
    const seen = [];
    xy.explains = (ctx, diff) => {
      const t = explains.call(xy, ctx, diff);
      if (t !== null) {
        expect([ctx.bytes[0], ctx.bytes[1]]).toEqual([0xed, 0xb0]);
        seen.push({ pc: ctx.execPc, xor: ctx.ours.regs.f ^ ctx.theirs.regs.f, bc: (ctx.ours.regs.b << 8) | ctx.ours.regs.c });
      }
      return t;
    };
    let r;
    const m = mameOrder();
    try {
      r = compareRun({ machine: m, reference: ref, instructions: 100_000 });
    } finally {
      xy.explains = explains;
    }
    expect(r.instructions).toBe(100_000);
    onlyGate(r, m, ref);
    expect(r.ended).toBeUndefined();
    expect(Object.keys(r.known)).toEqual([xy.name]);
    expect(seen.length).toBe(r.known[xy.name]);
    for (const s of seen) {
      expect([0x067f, 0x007e]).toContain(s.pc);
      expect(s.xor & ~0x28).toBe(0);
      expect(s.bc).not.toBe(0); // it repeats
    }
  });

  it('keyboard bytes MAME read reach our matrix at the recorded reads: ENTER at MEM SIZE? gives READY on both', async () => {
    const out = join(dir, 'enter.fmt');
    await recordMameTrace({ instructions: 700_000, keys: [{ at: 400_000, text: '\r' }], out });
    const ref = openTrace(out);
    const m = mameOrder();
    const r = compareRun({ machine: m, reference: ref, instructions: 700_000 });
    expect(r.instructions).toBe(700_000);
    onlyGate(r, m, ref);
    expect(Object.keys(r.known)).toEqual(['flags 3 and 5 (X/Y)']);
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
    const r = compareRun({ machine: mameOrder(), reference: ref, instructions: 5_000_000 });
    expect(r.instructions).toBe(rec.instructions);
    expect(r.ended).toBe(`MAME's trace ends after ${rec.instructions} of 5000000 instructions (MAME exited on SIGALRM), so the run proves nothing past that point.`);
    expect(formatReport(r)).toContain(/** @type {string} */ (r.ended));
    ref.close?.();
    // The CLI (our core's own EX (SP),HL order, so it stops at that divergence first) never
    // reports a killed recording as passing: a divergence (1) or the sentence (3).
    const run = spawnSync(process.execPath, [CLI, 'compare', out, '--instructions', '5000000'], { encoding: 'utf8' });
    expect([1, 3]).toContain(run.status);
    expect(run.stdout).not.toContain('divergence: none');
  });

  it('records the same trace twice, byte for byte', async () => {
    const a = await recordMameTrace({ instructions: 20_000, out: join(dir, 'det-a.fmt') });
    const b = await recordMameTrace({ instructions: 20_000, out: join(dir, 'det-b.fmt') });
    expect(readFileSync(a.path).equals(readFileSync(b.path))).toBe(true);
  });
});
