/**
 * The xtrs adapter (emu phase 7, Model I, Task 2). The refusal and timeout tests always run (they
 * need no xtrs: a fake child stands in); the rest run with FUGLOY_XTRS=1 and then need xtrs
 * (`pnpm xtrs:install`) and the Model I ROM (fugloy.mcp.json, roms.model1); either missing fails
 * them (gate.js).
 */
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { TIMER_BIT } from '../../src/devices/interrupt-latch.js';
import { ROM_TEST_TIMEOUT } from '../rom.js';
import { compareRun, ourRegs } from './compare.js';
import { requireRom, xtrsSkip } from './gate.js';
import { loadXtrs, openXtrs, XTRS_PATH, XTRS_SRC, XTRS_STEP_TIMEOUT_MS, XTRS_TREE_SHA256 } from './xtrs-adapter.js';

const dir = mkdtempSync(join(tmpdir(), 'fugloy-xtrs-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A shell script standing in for the xtrs binary. @param {string} name @param {string} body */
function fakeChild(name, body) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** An R record of the protocol: PC 0, AF FFFF, SP FFFF, T `t`. */
const R0 = (t = 0) => `R 0000 FFFF 0000 0000 0000 0000 0000 0000 0000 0000 0000 FFFF 00 00 0 0 0 ${t}`;

describe('loadXtrs refuses a build it cannot trust', () => {
  const rom = new Uint8Array(12288);

  it('names pnpm xtrs:install when the binary is missing', () => {
    const path = join(dir, 'missing-fugloy-xtrs');
    expect(() => loadXtrs({ path, rom })).toThrow(`no xtrs at ${path}; run \`pnpm xtrs:install\` to build it (xtrs at its pinned commit, with Fugløy's patch and driver)`);
  });

  it('refuses a source tree whose SHA-256 is not the pinned one, before running anything', () => {
    const marker = join(dir, 'ran');
    const path = fakeChild('tampered-bin', `touch '${marker}'\necho ready fugloy-xtrs 1`);
    const src = join(dir, 'src-tampered');
    mkdirSync(src);
    writeFileSync(join(src, 'z80.c'), '/* not xtrs */\n');
    expect(() => loadXtrs({ path, src, rom })).toThrow(new RegExp(`^${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} has SHA-256 [0-9a-f]{64}, not the pinned ${XTRS_TREE_SHA256}; delete it and run \`pnpm xtrs:install\`$`));
    expect(existsSync(marker)).toBe(false);
  });

  it('names pnpm xtrs:install when the source tree is missing', () => {
    const path = fakeChild('no-src-bin', 'echo ready fugloy-xtrs 1');
    const src = join(dir, 'no-such-src');
    expect(() => loadXtrs({ path, src, rom })).toThrow(`no xtrs source at ${src}; run \`pnpm xtrs:install\``);
  });
});

/**
 * A Node script standing in for the xtrs binary, run with this Node: it answers `regs` and its
 * first `steps` steps, then either stalls or exits with `exit`.
 * @param {string} name @param {{ steps: number, then: 'stall' | number }} how
 */
function fakeNodeChild(name, { steps, then }) {
  const path = join(dir, `${name}.mjs`);
  writeFileSync(path, `import { readSync, writeSync } from 'node:fs';
const say = (t) => writeSync(1, t + '\\n');
say('ready fugloy-xtrs 1');
let n = 0, pending = '';
const buf = Buffer.alloc(4096);
for (;;) {
  const got = readSync(0, buf, 0, buf.length, null);
  if (got === 0) process.exit(0);
  pending += buf.toString('latin1', 0, got);
  let nl;
  while ((nl = pending.indexOf('\\n')) >= 0) {
    const cmd = pending.slice(0, nl).split(' ')[0];
    pending = pending.slice(nl + 1);
    if (cmd === 'regs') say(${JSON.stringify(R0())});
    else if (cmd === 'step' && n < ${steps}) { n++; say(${JSON.stringify(`S 4 0 0 0 ${R0(4)}`)}); }
    else if (cmd === 'step') { ${then === 'stall' ? 'setInterval(() => {}, 1000); await new Promise(() => {});' : `process.exit(${then});`} }
    else say('ok');
  }
}
`);
  return path;
}

// The wrapper is POSIX sh: run it under the system's sh and, where it is installed, dash (CI's
// ubuntu /bin/sh).
const shells = ['/bin/sh', '/bin/dash'].filter((s) => existsSync(s));

describe.each(shells)('the xtrs pipe fails clearly instead of hanging (wrapper %s)', (shell) => {
  // The real timeout under /bin/sh; a short one under dash, to keep the suite quick.
  const timeoutMs = shell === '/bin/sh' ? XTRS_STEP_TIMEOUT_MS : 500;
  it(`throws the sentence within ${timeoutMs} ms when the reference stops answering`, () => {
    const script = fakeNodeChild('stalls', { steps: 3, then: 'stall' });
    const ref = openXtrs({ command: process.execPath, args: [script], shell, timeoutMs });
    try {
      for (let k = 0; k < 3; k++) expect(ref.step().cycles).toBe(4);
      const t0 = performance.now();
      expect(() => ref.step()).toThrow('xtrs stopped answering after 3 instructions. Run it again; if it repeats, rebuild with pnpm xtrs:install.');
      const waited = performance.now() - t0;
      expect(waited).toBeGreaterThanOrEqual(timeoutMs - 50);
      expect(waited).toBeLessThan(timeoutMs + 2000);
    } finally {
      ref.close?.();
    }
  }, XTRS_STEP_TIMEOUT_MS + 10_000);

  it('says so at once when the reference exits', () => {
    const script = fakeNodeChild('exits', { steps: 0, then: 3 });
    const ref = openXtrs({ command: process.execPath, args: [script], shell });
    const t0 = performance.now();
    expect(() => ref.step()).toThrow('xtrs exited after 0 instructions (exit code 3). Run it again; if it repeats, rebuild with pnpm xtrs:install.');
    expect(performance.now() - t0).toBeLessThan(XTRS_STEP_TIMEOUT_MS);
  });
});

describe.skipIf(xtrsSkip !== null)(`xtrs adapter against @fugloy/emu's Model I${xtrsSkip === null ? '' : ` (skipped: ${xtrsSkip})`}`, { timeout: ROM_TEST_TIMEOUT * 2 }, () => {
  const rom = () => requireRom('model1');
  const newMachine = () => new Machine({ model: 1, roms: { level2: rom() } });
  /** @type {import('./reference.js').Reference[]} */
  const open = [];
  const newRef = () => {
    const ref = loadXtrs({ rom: rom() });
    open.push(ref);
    return ref;
  };
  afterAll(() => {
    for (const r of open) r.close?.();
  });

  it('refuses a binary built from another driver or tree (its stamp), naming pnpm xtrs:install', () => {
    const path = join(dir, 'stale-fugloy-xtrs');
    cpSync(XTRS_PATH, path);
    writeFileSync(`${path}.stamp`, `tree ${XTRS_TREE_SHA256}\ndriver ${'0'.repeat(64)}\n`);
    expect(() => loadXtrs({ path, src: XTRS_SRC, rom: rom() })).toThrow(`${path} was built from another driver or patch than this checkout's; run \`pnpm xtrs:install\` to rebuild it`);
  });

  it('starts in xtrs\'s power-on state: the reset registers and video RAM the spike note lists', () => {
    const ref = newRef();
    const r = ref.regs();
    expect([r.pc, (r.a << 8) | r.f, r.sp, r.ix, r.iy, r.iff1, r.im]).toEqual([0, 0xffff, 0xffff, 0, 0, false, 0]);
    expect(ref.cycles).toBe(0);
    expect(ref.writes()).toEqual([]);
    expect(ref.peek(0x3c00, 0x400).every((b) => b === 0)).toBe(true);
    expect(ref.peek(0x0000, 0x3000)).toEqual(rom().subarray(0, 0x3000));
  });

  it('boots the ROM 100,000 instructions in step with our Model I, once synced, with only xtrs\'s EX (SP),HL write order differing', () => {
    const m = newMachine();
    const ref = newRef();
    // compareRun syncs the power-on state first (our AF 0000 and video RAM of spaces: Ruling 4
    // revised), then compares PC, every register, the T-states, and the writes at every step.
    const r = compareRun({ machine: m, reference: ref, instructions: 100_000 });
    expect(r.divergence).toBeNull();
    // The one EX (SP),HL of the boot (instruction 13,603, $287D): xtrs writes (SP) first (known.js).
    expect(r.known).toEqual({ 'EX (SP),rr: the reference writes (SP) before (SP+1)': 1 });
    expect(ref.cycles).toBe(m.cycles);
    expect(ref.peek(0x3c00, 0xc400)).toEqual(m.mem.read(0x3c00, 0xc400));
    // The boot reached MEM SIZE? on both.
    expect(m.video.text()[0]).toContain('MEM SIZE?');
  });

  it('after syncFrom, one step equals our step: registers, T-states, writes and memory', () => {
    const m = newMachine();
    m.step(50_000);
    const ref = newRef();
    ref.syncFrom(m);
    expect(ref.regs()).toEqual(ourRegs(m));
    expect(ref.cycles).toBe(m.cycles);
    expect(ref.peek(0x3c00, 0xc400)).toEqual(m.mem.read(0x3c00, 0xc400));
    const before = m.cycles;
    m.step(1);
    const t = ref.step();
    expect(t.cycles).toBe(m.cycles - before);
    expect(ref.regs()).toEqual(ourRegs(m));
    const r = compareRun({ machine: m, reference: ref, instructions: 20_000 });
    expect(r.divergence).toBeNull();
    expect(r.known).toEqual({});
  });

  it('syncFrom carries the $37E0 latch, and its read clears the clock bit on both', () => {
    const m = newMachine();
    m.step(50_000);
    m.system.io.latch.raise(TIMER_BIT);
    const ref = newRef();
    ref.syncFrom(m);
    expect(ref.peek(0x37e0, 1)[0]).toBe(TIMER_BIT);
    // LD A,($37E0) at $5000.
    m.mem.write(0x5000, [0x3a, 0xe0, 0x37]);
    m.system.cpu.registers.PC = 0x5000;
    ref.syncFrom(m);
    m.step(1);
    ref.step();
    expect([ref.regs().a, ref.regs().pc]).toEqual([TIMER_BIT, 0x5003]);
    expect(ourRegs(m).a).toBe(TIMER_BIT);
    expect(ref.peek(0x37e0, 1)[0]).toBe(0);
    expect(m.system.io.latch.peek()).toBe(0);
  });

  it('syncFrom carries the timer phase: the 40 Hz request is raised at the boundary ours raises it', () => {
    const m = newMachine();
    m.step(50_000);
    const ref = newRef();
    ref.syncFrom(m);
    const latch = m.system.io.latch;
    latch.clear(TIMER_BIT);
    ref.syncFrom(m);
    let oursAt = -1;
    let refAt = -1;
    for (let k = 0; k < 40_000 && (oursAt < 0 || refAt < 0); k++) {
      m.step(1);
      if (oursAt < 0 && (latch.peek() & TIMER_BIT) !== 0) oursAt = k;
      if (ref.step().raised && refAt < 0) refAt = k;
    }
    expect(oursAt).toBeGreaterThanOrEqual(0);
    expect(refAt).toBe(oursAt);
  });

  it('counts an interrupt response with the instruction after it, as our step does', () => {
    const m = newMachine();
    m.step(50_000);
    // IM 1, interrupts on, the clock bit raised, NOPs at $5000: the response, then the ROM's
    // JP $4012 at $0038, in one step on both.
    m.mem.write(0x5000, [0x00, 0x00]);
    const cpu = m.system.cpu;
    cpu.registers.PC = 0x5000;
    cpu.registers.SP = 0x6000;
    cpu.IFF1 = cpu.IFF2 = true;
    cpu.interruptMode = 1;
    m.system.io.latch.raise(TIMER_BIT);
    const ref = newRef();
    ref.syncFrom(m);
    const before = m.cycles;
    m.step(1);
    const t = ref.step();
    expect(t.irq).toBe(true);
    expect(t.cycles).toBe(m.cycles - before);
    expect(ref.regs()).toEqual(ourRegs(m));
    expect(ref.writes()).toEqual([{ addr: 0x5fff, value: 0x50 }, { addr: 0x5ffe, value: 0x00 }]);
  });

  it('holds a requested interrupt back when asked, and takes it when forced', () => {
    const m = newMachine();
    m.step(50_000);
    m.mem.write(0x5000, [0x00, 0x00]);
    const cpu = m.system.cpu;
    cpu.registers.PC = 0x5000;
    cpu.registers.SP = 0x6000;
    cpu.IFF1 = cpu.IFF2 = true;
    cpu.interruptMode = 1;
    m.system.io.latch.raise(TIMER_BIT);
    const ref = newRef();
    ref.syncFrom(m);
    expect(ref.step({ irq: 'hold' })).toEqual({ cycles: 4, irq: false, raised: false });
    expect(ref.regs().pc).toBe(0x5001);
    expect([...rom().subarray(0x38, 0x3b)]).toEqual([0xc3, 0x12, 0x40]); // JP $4012
    expect(ref.step({ irq: 'force' })).toEqual({ cycles: 13 + 10, irq: true, raised: false });
    expect(ref.regs().pc).toBe(0x4012);
    expect(ref.writes()).toEqual([{ addr: 0x5fff, value: 0x50 }, { addr: 0x5ffe, value: 0x01 }]);
  });

  it('logs the step\'s memory writes, the value as the CPU wrote it (before the video gate)', () => {
    const m = newMachine();
    m.step(50_000);
    // LD A,$61 / LD ($3C00),A: bit 5 set, so the gate stores $21.
    m.mem.write(0x5000, [0x3e, 0x61, 0x32, 0x00, 0x3c]);
    m.system.cpu.registers.PC = 0x5000;
    const ref = newRef();
    ref.syncFrom(m);
    ref.step();
    ref.step();
    expect(ref.writes()).toEqual([{ addr: 0x3c00, value: 0x61 }]);
    expect(ref.peek(0x3c00, 1)[0]).toBe(0x21);
  });

  it('logs a push high byte first and LD (nn),HL low byte first, as the Z80 and ours write them', () => {
    const m = newMachine();
    m.step(50_000);
    // PUSH BC / CALL $5010 / LD ($6100),HL, with RET at $5010.
    m.mem.write(0x5000, [0xc5, 0xcd, 0x10, 0x50]);
    m.mem.write(0x5010, [0x22, 0x00, 0x61]);
    const cpu = m.system.cpu;
    cpu.registers.PC = 0x5000;
    cpu.registers.SP = 0x6000;
    cpu.registers.B = 0x12; cpu.registers.C = 0x34;
    cpu.registers.H = 0xab; cpu.registers.L = 0xcd;
    const ref = newRef();
    ref.syncFrom(m);
    ref.step();
    expect(ref.writes()).toEqual([{ addr: 0x5fff, value: 0x12 }, { addr: 0x5ffe, value: 0x34 }]);
    ref.step();
    expect(ref.writes()).toEqual([{ addr: 0x5ffd, value: 0x50 }, { addr: 0x5ffc, value: 0x04 }]);
    ref.step();
    expect(ref.writes()).toEqual([{ addr: 0x6100, value: 0xcd }, { addr: 0x6101, value: 0xab }]);
    // Ours writes each in the same order.
    const r = compareRun({ machine: m, reference: ref, instructions: 3 });
    expect(r.divergence).toBeNull();
  });

  it('presses a matrix key: the keyboard row reads it, and syncFrom copies our matrix', () => {
    const ref = newRef();
    ref.setKeyBit(0, 1, true); // row 0 bit 1 is A
    expect(ref.peek(0x3801, 1)[0]).toBe(0x02);
    ref.setKeyBit(0, 1, false);
    expect(ref.peek(0x3801, 1)[0]).toBe(0x00);
    const m = newMachine();
    m.system.keyboard.pressKey(6, 0); // ENTER
    ref.syncFrom(m);
    expect(ref.peek(0x3840, 1)).toEqual(m.mem.read(0x3840, 1));
    expect(ref.peek(0x3840, 1)[0]).toBe(0x01);
  });

  it('pokes RAM and video RAM, and leaves the ROM alone', () => {
    const ref = newRef();
    ref.poke(0x4000, [1, 2, 3]);
    ref.poke(0x3c10, [0x41]);
    ref.poke(0x0000, [0x99]);
    expect(ref.peek(0x4000, 3)).toEqual(new Uint8Array([1, 2, 3]));
    expect(ref.peek(0x3c10, 1)[0]).toBe(0x41);
    expect(ref.peek(0x0000, 1)[0]).toBe(rom()[0]);
  });

  it('runs a DD/FD prefix it ignores and the instruction after it as one step, as ours does', () => {
    const m = newMachine();
    m.step(50_000);
    // DD C5 (PUSH BC, the prefix ignored: 15 T-states), FD 3E 42 (LD A,$42: 11), DD DD 00 (a lone
    // DD, 4, then DD NOP, 8), and DD 21 34 12 (LD IX,$1234: 14, a pair xtrs implements).
    m.mem.write(0x5000, [0xdd, 0xc5, 0xfd, 0x3e, 0x42, 0xdd, 0xdd, 0x00, 0xdd, 0x21, 0x34, 0x12]);
    const cpu = m.system.cpu;
    cpu.registers.PC = 0x5000;
    cpu.registers.SP = 0x6000;
    cpu.registers.B = 0x12; cpu.registers.C = 0x34;
    const ref = newRef();
    ref.syncFrom(m);
    const want = [[15, 0x5002], [11, 0x5005], [4, 0x5006], [8, 0x5008], [14, 0x500c]];
    const got = want.map(() => [ref.step().cycles, ref.regs().pc]);
    expect(got).toEqual(want);
    ref.syncFrom(m);
    const r = compareRun({ machine: m, reference: ref, instructions: want.length });
    expect(r.divergence).toBeNull();
    expect(r.known).toEqual({});
    expect([ourRegs(m).a, ourRegs(m).ix]).toEqual([0x42, 0x1234]);
  });

  it('lists every opcode but DD, FD and ED as run with its prefix in one step', () => {
    const ops = newRef().prefixedOps;
    for (const op of [0x00, 0x21, 0x41, 0xc5, 0xe5, 0xcb]) expect(ops.has(op)).toBe(true);
    for (const op of [0xdd, 0xfd, 0xed]) expect(ops.has(op)).toBe(false);
  });
});
