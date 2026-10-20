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
 *   readonly prefixedOps: ReadonlySet<number>,
 *   readonly cycles: number,
 *   readonly z?: any,
 * }} Reference
 *   prefixedOps: the opcodes after DD or FD that the reference runs with the prefix as one step
 *   (trsjs drops the pair for the others; xtrs runs all but DD, FD and ED, the lone prefixes, since
 *   its driver joins an ignored prefix to the instruction after it); redoDroppedPrefix: trsjs only (known.js, REFERENCE_FIXES); latch: the
 *   Model I's $37E0 latch as it stands, read without clearing it (xtrs; compare.js compares it
 *   after every step in which our CPU read it); name: the reference's name in a report; close: ends a reference
 *   that runs in another process; z: trsjs's machine object, for its own tests.
 */
export {};
