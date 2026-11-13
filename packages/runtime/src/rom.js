/**
 * Fugløy's stand-ins for the ROM routines a ported game calls (Part 2, M2). A port has no ROM: where
 * the program CALLs one of these addresses, its port calls `o.standin` (ops.js), which pushes the
 * return address as the CALL does, runs the stand-in here, and pops the address as the routine's RET
 * does. Each stand-in leaves the machine as the routine leaves it on @fugloy/emu: its T-states and R
 * increments, the registers and flags it changes, nothing else. It is Fugløy's own code, written from
 * what the routine is documented to do and the timing measured on emu; no ROM byte of Tandy's is here.
 *
 * `STANDINS_Z` is the same routines as Z80 source for @fugloy/asm, at the ROM's own addresses, laid out
 * as the ROM lays them out, so the emulator running them takes the ROM's time. The referee's game stub
 * ROM (packages/recomp/test/game-rom.ts) is Fugløy's stub ROM followed by it: CI holds a port's
 * stand-ins to the same routines run on emu, with no user ROM.
 *
 * M2 has one, the Model III's $DELAY at $0060 (Sea Dragon calls it from six places); the Model I has none.
 */

/**
 * $DELAY ($0060), the Model III: pause for BC counts, BC 0 counting 65,536 ("pause for a time set by
 * BC", the Model III BASIC manual, p. 12/10, as packages/disasm/data/symbols/rom-model3.json cites it).
 * Measured on emu with the Model III ROM, from the CALL's end to the RET's: 30 T-states a count and 15
 * more, leaving A 0, F $44 (Z and P/V: the OR that found BC zero) and BC 0. As STANDINS_Z below runs it:
 * JP (10 T-states, one opcode fetch), then a count of LD A,A, DEC BC, LD A,B, OR C and JR NZ (4 + 6 + 4
 * + 4 + 12, five fetches), the last count's JR not taken (7, so 5 fewer), and RET (10, one fetch):
 * 10 + 30n - 5 + 10 = 30n + 15 T-states and 5n + 2 R increments.
 *
 * `run` is the routine on the registers, its RET's time included: the stack, and the MEMPTR and Q the
 * RET leaves, are `o.standin`'s. MEMPTR in between (the JP's and JR's target) is overwritten by the RET.
 * @param {import('./z.js').Z} z
 */
function delay(z) {
  const n = z.bc || 0x10000;
  z.tick(30 * n + 15, 5 * n + 2);
  z.a = 0;
  z.f = 0x44;
  z.bc = 0;
}

/**
 * A ROM routine the runtime stands in for: `name` names it (the ROM symbol, without its `$`), and `run`
 * does to the machine what the routine does, from its first instruction to its RET.
 * @typedef {{ readonly name: string, readonly run: (z: import('./z.js').Z) => void }} Standin
 */

/** @type {ReadonlyMap<number, Standin>} */
const MODEL_III = new Map([[0x0060, Object.freeze({ name: 'DELAY', run: delay })]]);
/** @type {ReadonlyMap<number, Standin>} */
const MODEL_I = new Map();

/**
 * The ROM routines the runtime stands in for on a model, by address: for the Model III, $0060 ($DELAY);
 * for the Model I, none (M2). @fugloy/recomp's `port()` takes their names as `standins`.
 * @param {1 | 3} model
 * @returns {ReadonlyMap<number, Standin>}
 */
export function standins(model) {
  if (model === 3) return MODEL_III;
  if (model === 1) return MODEL_I;
  throw new Error(`model must be 1 (the Model I) or 3 (the Model III), not ${String(model)}.`);
}

/**
 * The Model III's stand-ins as Z80 source for @fugloy/asm, at the ROM's addresses, with no END (it is
 * appended to another source, the stub ROM's). Fugløy's own: a delay loop written from the routine's
 * documented behaviour to take the time measured above, the JP at $0060 and the loop at $01FB being
 * where the ROM has them, so a CALL takes the same T-states on this as on the ROM.
 */
export const STANDINS_Z = `; Fugløy's stand-ins for the Model III ROM routines a ported game calls, at the ROM's own
; addresses so that each takes the ROM's time (@fugloy/runtime's rom.js). Fugløy's own code.

        ORG     0060H
DELAY:  JP      DELAYLP         ; $DELAY: pause for BC counts (0 counts 65,536)

        ORG     01FBH
DELAYLP: LD     A,A             ; 4 T-states: pads a count to 30
        DEC     BC              ; 6
        LD      A,B             ; 4
        OR      C               ; 4: Z when BC is 0, which leaves A 0 and F 44H
        JR      NZ,DELAYLP      ; 12 while counting, 7 the last time
        RET                     ; 10: 30 a count, and 15 more with the JP
`;
