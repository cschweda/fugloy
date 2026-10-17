/** The Explain tab's value tracker: what is proven about registers before a line, and DJNZ loop counts. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pair } from '../../src/analysis/regs.js';
import { djnzLoop, knownBefore } from '../../src/explain/track.js';
import { emptyAnnotations } from '../../src/hints/apply.js';
import { analyze } from '../../src/pipeline.js';
import { loadRaw } from '../../src/raw.js';
import { openProgram, withHintText } from '../../src/session.js';

const BASE = 0x7000;
/** A raw program at $7000, analysed from its first byte. */
const prog = (bytes: number[]) => analyze(loadRaw(new Uint8Array(bytes), BASE));
const allUnknown = (r: Record<string, number | null>) => Object.values(r).every((v) => v === null);

describe('knownBefore on synthetic code', () => {
  it('straight: values set on the only path are known', () => {
    // 7000 LD HL,3C00H; 7003 LD A,20H; 7005 LD (HL),A; 7006 RET
    const a = prog([0x21, 0x00, 0x3c, 0x3e, 0x20, 0x77, 0xc9]);
    const k = knownBefore(a, 0x7005);
    expect(pair(k.regs, 'HL')).toBe(0x3c00);
    expect(k.regs.A).toBe(0x20);
    expect(k.from).toBeUndefined();
  });

  it('merge-point: a jump target knows nothing and says where control comes from', () => {
    // 7000 JR Z,7005; 7002 LD HL,1; 7005 LD A,(HL); 7006 RET
    const a = prog([0x28, 0x03, 0x21, 0x01, 0x00, 0x7e, 0xc9]);
    const k = knownBefore(a, 0x7005);
    expect(pair(k.regs, 'HL')).toBeNull();
    expect(allUnknown(k.regs)).toBe(true);
    expect(k.from).toEqual({ addr: 0x7005, callers: [], jumpers: [0x7000] });
  });

  it('after-call: everything is unknown after a CALL', () => {
    // 7000 LD HL,1; 7003 CALL 7008; 7006 LD A,(HL); 7007 RET; 7008 RET
    const a = prog([0x21, 0x01, 0x00, 0xcd, 0x08, 0x70, 0x7e, 0xc9, 0xc9]);
    const k = knownBefore(a, 0x7006);
    expect(allUnknown(k.regs)).toBe(true);
    expect(k.from).toBeUndefined();
  });

  it('a call target is a stop, with its callers', () => {
    const a = prog([0x21, 0x01, 0x00, 0xcd, 0x08, 0x70, 0x7e, 0xc9, 0xc9]);
    expect(knownBefore(a, 0x7008).from).toEqual({ addr: 0x7008, callers: [0x7003], jumpers: [] });
  });

  it('a line after an unconditional jump starts a run and knows nothing', () => {
    // 7000 LD A,1; 7002 JP 7006; 7005 NOP (unreached); 7006 RET
    const a = prog([0x3e, 0x01, 0xc3, 0x06, 0x70, 0x00, 0xc9]);
    const k = knownBefore(a, 0x7006);
    expect(k.regs.A).toBeNull(); // 7006 is a jump target
    expect(knownBefore(a, 0x7002).regs.A).toBe(1);
  });

  it('a target of JP (HL) knows nothing, though only fall-through reaches it statically', () => {
    // 7000 LD A,5; 7002 LD HL,700BH; 7005 JR Z,7008; 7007 JP (HL); 7008 LD A,7; 700A NOP; 700B LD (HL),A; 700C RET
    const a = prog([0x3e, 0x05, 0x21, 0x0b, 0x70, 0x28, 0x01, 0xe9, 0x3e, 0x07, 0x00, 0x77, 0xc9]);
    expect(knownBefore(a, 0x700b).regs.A).toBeNull();
  });

  it('a target of PUSH HL; RET knows nothing', () => {
    // 7000 LD A,5; 7002 LD HL,700CH; 7005 PUSH HL; 7006 JR Z,7009; 7008 RET; 7009 LD A,7; 700B NOP; 700C LD (HL),A; 700D RET
    const a = prog([0x3e, 0x05, 0x21, 0x0c, 0x70, 0xe5, 0x28, 0x01, 0xc9, 0x3e, 0x07, 0x00, 0x77, 0xc9]);
    expect(knownBefore(a, 0x700c).regs.A).toBeNull();
  });

  it('a user-named label in straight code stops the walk', () => {
    // 7000 LD A,5; 7002 NOP (named HERE); 7003 LD (HL),A; 7004 RET
    const mod = loadRaw(new Uint8Array([0x3e, 0x05, 0x00, 0x77, 0xc9]), BASE);
    const annotations = emptyAnnotations();
    annotations.names.set(0x7002, 'HERE');
    const a = analyze(mod, { annotations });
    expect(knownBefore(a, 0x7003).regs.A).toBeNull();
    expect(knownBefore(prog([0x3e, 0x05, 0x00, 0x77, 0xc9]), 0x7003).regs.A).toBe(5);
  });

  it('an immediate the program rewrites is not proven', () => {
    // 7000 LD (7004H),A; 7003 LD C,9 (7004 is its operand); 7005 LD (HL),C; 7006 RET
    const a = prog([0x32, 0x04, 0x70, 0x0e, 0x09, 0x71, 0xc9]);
    expect(knownBefore(a, 0x7005).regs.C).toBeNull();
    // Unpatched, the same LD C,9 is proven.
    expect(knownBefore(prog([0x00, 0x00, 0x00, 0x0e, 0x09, 0x71, 0xc9]), 0x7005).regs.C).toBe(9);
  });

  it('cap: a value set more than 32 instructions back is not reached', () => {
    // LD A,5; 40 NOPs; LD (HL),A; RET
    const far = prog([0x3e, 0x05, ...Array(40).fill(0), 0x77, 0xc9]);
    expect(knownBefore(far, 0x7002 + 40).regs.A).toBeNull();
    // LD A,5; 31 NOPs; LD (HL),A: the LD A is the 32nd instruction back
    const near = prog([0x3e, 0x05, ...Array(31).fill(0), 0x77, 0xc9]);
    expect(knownBefore(near, 0x7002 + 31).regs.A).toBe(5);
    // 32 NOPs: the LD A is the 33rd
    const over = prog([0x3e, 0x05, ...Array(32).fill(0), 0x77, 0xc9]);
    expect(knownBefore(over, 0x7002 + 32).regs.A).toBeNull();
  });
});

describe('djnzLoop on synthetic code', () => {
  it('loop-count: B on entry, with a forward branch inside the body', () => {
    // 7000 LD B,40H; 7002 l: INC A; 7003 JR Z,7006; 7005 INC C; 7006 skip: NOP; 7007 DJNZ 7002; 7009 RET
    const a = prog([0x06, 0x40, 0x3c, 0x28, 0x01, 0x0c, 0x00, 0x10, 0xf9, 0xc9]);
    expect(djnzLoop(a, 0x7007)).toEqual({ head: 0x7002, end: 0x7007, count: 0x40 });
  });

  it('loop-body-writes: the body knows nothing, the count is still proven', () => {
    // 7000 LD HL,3FD0H; 7003 LD B,5; 7005 l: LD (HL),8CH; 7007 INC HL; 7008 DJNZ 7005; 700A RET
    const a = prog([0x21, 0xd0, 0x3f, 0x06, 0x05, 0x36, 0x8c, 0x23, 0x10, 0xfb, 0xc9]);
    expect(pair(knownBefore(a, 0x7005).regs, 'HL')).toBeNull();
    expect(knownBefore(a, 0x7005).from).toEqual({ addr: 0x7005, callers: [], jumpers: [0x7008] });
    expect(djnzLoop(a, 0x7008)).toEqual({ head: 0x7005, end: 0x7008, count: 5 });
  });

  it('second-entry: a jump from outside into the body gives no count', () => {
    // 7000 LD B,5; 7002 JR Z,7005; 7004 l: INC C; 7005 m: INC A; 7006 DJNZ 7004; 7008 RET
    const a = prog([0x06, 0x05, 0x28, 0x01, 0x0c, 0x3c, 0x10, 0xfc, 0xc9]);
    expect(djnzLoop(a, 0x7006)).toEqual({ head: 0x7004, end: 0x7006, count: null });
  });

  it('a second jump into the head gives no count', () => {
    // 7000 LD B,5; 7002 JR Z,7004; 7004 l: INC C; 7005 DJNZ 7004; 7007 RET
    const a = prog([0x06, 0x05, 0x28, 0x00, 0x0c, 0x10, 0xfd, 0xc9]);
    expect(djnzLoop(a, 0x7005)?.count).toBeNull();
  });

  it('body-writes-b: LD B,A in the body gives no count', () => {
    // 7000 LD B,5; 7002 l: LD B,A; 7003 DJNZ 7002; 7005 RET
    const a = prog([0x06, 0x05, 0x47, 0x10, 0xfd, 0xc9]);
    expect(djnzLoop(a, 0x7003)).toEqual({ head: 0x7002, end: 0x7003, count: null });
  });

  it('a body that sets B to a constant gives no count', () => {
    // 7000 LD B,5; 7002 l: LD B,5; 7004 DJNZ 7002; 7006 RET
    const a = prog([0x06, 0x05, 0x06, 0x05, 0x10, 0xfc, 0xc9]);
    expect(djnzLoop(a, 0x7004)?.count).toBeNull();
  });

  it('a body with a CALL or EXX gives no count', () => {
    // 7000 LD B,5; 7002 l: CALL 7008; 7005 DJNZ 7002; 7007 RET; 7008 RET
    const call = prog([0x06, 0x05, 0xcd, 0x08, 0x70, 0x10, 0xfb, 0xc9, 0xc9]);
    expect(djnzLoop(call, 0x7005)?.count).toBeNull();
    // 7000 LD B,5; 7002 l: EXX; 7003 DJNZ 7002; 7005 RET
    const exx = prog([0x06, 0x05, 0xd9, 0x10, 0xfd, 0xc9]);
    expect(djnzLoop(exx, 0x7003)?.count).toBeNull();
  });

  it('B unproven on entry gives no count', () => {
    // 7000 l: INC A; 7001 DJNZ 7000; 7003 RET (the head is the entry point)
    const a = prog([0x3c, 0x10, 0xfd, 0xc9]);
    expect(djnzLoop(a, 0x7001)?.count).toBeNull();
  });

  it('an indirect re-entry into the loop gives no count', () => {
    // 7000 LD B,4; 7002 LD HL,7005H; 7005 head: NOP; 7006 DJNZ 7005; 7008 JP (HL)
    const a = prog([0x06, 0x04, 0x21, 0x05, 0x70, 0x00, 0x10, 0xfd, 0xe9]);
    expect(djnzLoop(a, 0x7006)).toEqual({ head: 0x7005, end: 0x7006, count: null });
  });

  it('a data reference into the body gives no count', () => {
    // 7000 LD B,4; 7002 LD HL,7006H; 7005 head: NOP; 7006 INC A; 7007 DJNZ 7005; 7009 JP (HL)
    const a = prog([0x06, 0x04, 0x21, 0x06, 0x70, 0x00, 0x3c, 0x10, 0xfc, 0xe9]);
    expect(djnzLoop(a, 0x7007)?.count).toBeNull();
  });

  it('a data reference to an operand byte inside the body (self-modifying code) keeps the count', () => {
    // 7000 LD B,4; 7002 head: LD (7006H),A; 7005 LD C,0 (7006 is its operand); 7007 DJNZ 7002; 7009 RET
    const a = prog([0x06, 0x04, 0x32, 0x06, 0x70, 0x0e, 0x00, 0x10, 0xf9, 0xc9]);
    expect(djnzLoop(a, 0x7007)).toEqual({ head: 0x7002, end: 0x7007, count: 4 });
    // ...but the rewritten LD C,0 proves nothing about C.
    expect(knownBefore(a, 0x7007).regs.C).toBeNull();
  });

  it('a rewritten LD B,n before the head gives no count', () => {
    // 7000 LD (7004H),A; 7003 LD B,4 (7004 is its operand); 7005 head: NOP; 7006 DJNZ 7005; 7008 RET
    const a = prog([0x32, 0x04, 0x70, 0x06, 0x04, 0x00, 0x10, 0xfd, 0xc9]);
    expect(djnzLoop(a, 0x7006)).toEqual({ head: 0x7005, end: 0x7006, count: null });
  });

  it('is null for a forward DJNZ, which is not a loop', () => {
    // 7000 DJNZ 7003; 7002 NOP; 7003 RET
    expect(djnzLoop(prog([0x10, 0x01, 0x00, 0xc9]), 0x7000)).toBeNull();
  });

  it('is null for a line that is not a DJNZ', () => {
    const a = prog([0x06, 0x05, 0xc9]);
    expect(djnzLoop(a, 0x7000)).toBeNull();
  });
});

describe('Sea Dragon, with hints', () => {
  const dir = fileURLToPath(new URL('../../../../examples/sea-dragon/', import.meta.url));
  const sea = withHintText(
    openProgram(new Uint8Array(readFileSync(`${dir}seadrg01.cmd`)), { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } }),
    readFileSync(`${dir}seadrg01.hints`, 'utf8'),
    'seadrg01.hints',
  ).analysis;

  it('proves the loader setup before its LDIR', () => {
    const k = knownBefore(sea, 0x888b);
    expect(pair(k.regs, 'HL')).toBe(0x5200);
    expect(pair(k.regs, 'DE')).toBe(0x497f);
    expect(pair(k.regs, 'BC')).toBe(0x3681);
  });

  it('counts the DJNZ loop at $49B1', () => {
    expect(djnzLoop(sea, 0x49ca)).toEqual({ head: 0x49b1, end: 0x49ca, count: 0x40 });
  });

  it('knows nothing at L5FC4, and names its two jumpers', () => {
    const k = knownBefore(sea, 0x5fc4);
    expect(pair(k.regs, 'HL')).toBeNull();
    expect(k.from?.jumpers).toEqual(expect.arrayContaining([0x5fd6, 0x5fde]));
  });
});
