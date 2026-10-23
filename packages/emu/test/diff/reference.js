/**
 * The reference machine's interface for emu phase 7's differential harness, shared by every
 * reference: trsjs (the Model III, trsjs-adapter.js, in process) and xtrs (the Model I,
 * xtrs-adapter.js, a child process). compareRun (compare.js) drives any of them one instruction
 * at a time; nothing in it is branched on which reference it is (plan Ruling 3).
 *
 * An interrupt response counts with the instruction after it, as `Machine.step` counts it; each
 * adapter shifts its reference to that rule.
 *
 * @typedef {import('../../src/machine/machine.js').Regs} Regs
 * @typedef {import('../../src/machine/machine.js').Machine} Machine
 * @typedef {{ addr: number, value: number }} Write
 * @typedef {'auto' | 'hold' | 'force'} IrqMode
 *   auto: take a maskable interrupt at this boundary when one is requested and IFF1 is set (the
 *   reference's own rule);
 *   hold: take none at this boundary (the request stays raised);
 *   force: take an interrupt now (IFF1 must be set), whether or not one is requested.
 * @typedef {{ cycles: number, irq: boolean, raised: boolean }} RefStep
 *   irq: an interrupt response ran; raised: the timer raised its request at this boundary.
 * @typedef {{
 *   reset(): void,
 *   step(opts?: { irq?: IrqMode }): RefStep,
 *   regs(): Regs,
 *   peek(addr: number, len: number): Uint8Array,
 *   poke(addr: number, bytes: ArrayLike<number>): void,
 *   setKeyBit(row: number, bit: number, down: boolean): void,
 *   alignRtc(phaseTStates: number): void,
 *   syncFrom(machine: Machine): void,
 *   syncRegs(machine: Machine): void,
 *   redoDroppedPrefix(pc: number, r: number): number,
 *   writes(): Write[],
 *   latch?(): number,
 *   close?(): void,
 *   readonly name?: string,
 *   readonly haltedPc?: 'halt' | 'next',
 *   readonly classes: ReadonlySet<string>,
 *   readonly prefixedOps: ReadonlySet<number>,
 *   readonly cycles: number,
 *   readonly z?: any,
 * }} Reference
 *   classes: the ids of the known classes (known.js) the reference may need, each found against
 *   it with its evidence (plan Ruling 6); compareRun explains a difference, holds back or forces
 *   an interrupt, or fixes the reference's step only by a class its reference declares, so one
 *   reference's evidence never excuses another's difference (Ruling 3: passed in, never branched
 *   on the reference's name). An empty set declares none.
 *   prefixedOps: the opcodes after DD or FD that the reference runs with the prefix as one step
 *   (trsjs drops the pair for the others; xtrs runs all but DD, FD and ED, the lone prefixes, since
 *   its driver joins an ignored prefix to the instruction after it); redoDroppedPrefix: trsjs only (known.js, REFERENCE_FIXES); latch: the
 *   Model I's $37E0 latch as it stands, read without clearing it (xtrs; compare.js compares it
 *   after every step in which our CPU read it); name: the reference's name in a report; close: ends a reference
 *   that runs in another process; z: trsjs's machine object, for its own tests.
 *   haltedPc: where the reference's PC stands after a HALT stopped its CPU, which compareRun
 *   compares ours with (compare.js, ourRegs): 'halt', on the HALT (the default: trsjs's halted CPU
 *   runs the HALT again each step, as the Z80 sits on it, Young §5.4), or 'next', after it, the
 *   address the response will push (the Model I answers a HALT with an NMI at the next boundary,
 *   trs80-system.js: xtrs's Model I does not halt at all, z80.c case 0x76, and a MAME trace's state
 *   before a response holds the address that response pushes).
 */
export {};
