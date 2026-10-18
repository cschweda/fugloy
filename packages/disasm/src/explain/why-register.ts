/**
 * Why a line uses the register it does: facts about the Z80 that are true of
 * the instruction form wherever it stands (only A can be compared, DJNZ counts
 * in B, LDIR fixes HL, DE and BC), and, for a line that loads a register, the
 * ROM or DOS routine called next in straight-line code whose table entry says
 * it takes its input there. Lines with no forced choice get nothing.
 */
import type { Instruction, Operand } from '@fugloy/z80';
import type { Reg8Name } from '../analysis/regs.js';
import { addrPiece, routineKind, say, tableName } from './machine.js';
import type { LineCtx } from './phrase.js';
import { opcodeRewritten, sourceRewritten, straightFrom, written } from './track.js';
import type { Sentence } from './types.js';

const ACC = 'A, the accumulator,';
/** `A, the accumulator` at the end of a sentence, without the trailing comma. */
const ACC_END = 'A, the accumulator';

const ROTATE_A: Readonly<Record<string, string>> = { RLCA: 'RLC', RRCA: 'RRC', RLA: 'RL', RRA: 'RR' };

const isReg = (o: Operand | undefined, r: string): boolean => o?.kind === 'reg' && o.reg === r;
const isInd = (o: Operand | undefined, ...rs: string[]): boolean => o?.kind === 'ind' && rs.includes(o.reg);

/** Sentences and the one register they are about (undefined when they speak of several). */
interface Facts {
  about: string | undefined;
  s: Sentence[];
}
const NONE: Facts = { about: undefined, s: [] };
const on = (about: string | undefined, ...s: Sentence[]): Facts => ({ about, s });
/** The register `JP (HL)`, `JP (IX)` or `JP (IY)` jumps through. */
const jumpReg = (ins: Instruction): string | undefined => {
  const o = ins.operands[0];
  return o?.kind === 'ind' || o?.kind === 'reg16' ? o.reg : undefined;
};

const addSub = (): Facts => on('A', say(`Every 8-bit add and subtract works on ${ACC_END}: to add to or subtract from a byte, the program must have it in A.`));

/** The Design §1 facts about the instruction form: why the Z80 makes the line use this register. */
function formFacts(ins: Instruction): Facts {
  const m = ins.mnemonic;
  const [o0, o1] = ins.operands;
  switch (m) {
    case 'ADD':
    case 'ADC':
    case 'SBC':
      if (isReg(o0, 'A')) return addSub();
      if (o0?.kind === 'reg16' && m === 'ADD') return on(o0.reg, say('A 16-bit add can land only in HL, IX or IY, so a 16-bit total is kept in one of them.'));
      if (o0?.kind === 'reg16') return on('HL', say('A 16-bit add with carry or subtract can land only in HL.'));
      return NONE;
    case 'SUB':
      return addSub();
    case 'AND':
    case 'OR':
    case 'XOR':
      return on('A', say(`Every 8-bit AND, OR and XOR works on ${ACC_END}: a byte must be in A to be masked or combined this way.`));
    case 'CP':
      return on('A', say(`CP always compares with ${ACC_END}: the Z80 compares a byte only against A, so the value to test must be in A.`));
    case 'LD':
      return loadFacts(o0, o1);
    case 'OUT':
      if (o0?.kind === 'port') return on('A', say(`Only ${ACC} can be sent to a port whose number is written in the instruction; any other register needs the port number in C (OUT (C),r).`));
      if (isInd(o0, 'C')) return on('C', say('When a register picks the port, it is always C: the Z80 takes the port number from C and from no other register.'));
      return NONE;
    case 'IN':
      if (o1?.kind === 'port') return on('A', say(`Only ${ACC} can be read from a port whose number is written in the instruction; any other register needs the port number in C (IN r,(C)).`));
      if (isInd(o1, 'C')) return on('C', say('When a register picks the port, it is always C: the Z80 takes the port number from C and from no other register.'));
      return NONE;
    case 'DJNZ':
      return on('B', say('DJNZ always counts down in B: it takes 1 from B and jumps unless B has reached zero, so a loop that uses it keeps its count in B.'));
    case 'LDIR':
    case 'LDDR':
    case 'LDI':
    case 'LDD':
      return on(undefined, say('The block copy instructions fix their registers: HL is always the source, DE the destination and BC the count, so the program sets those three first.'));
    case 'CPIR':
    case 'CPDR':
    case 'CPI':
    case 'CPD':
      return on(undefined, say(`The block search instructions fix their registers: ${ACC} holds the byte to look for, HL the address and BC the count.`));
    case 'INI':
    case 'IND':
    case 'INIR':
    case 'INDR':
    case 'OUTI':
    case 'OUTD':
    case 'OTIR':
    case 'OTDR':
      return on(undefined, say('The block input and output instructions fix their registers: HL is the address in memory, B the count and C the port number.'));
    case 'RLCA':
    case 'RRCA':
    case 'RLA':
    case 'RRA':
      return on('A', say(`${m} works only on ${ACC_END}; to rotate another register the Z80 has a separate instruction, ${ROTATE_A[m]}.`));
    case 'CPL':
      return on('A', say(`CPL works only on ${ACC_END}: no other register has an instruction that flips all its bits.`));
    case 'NEG':
      return on('A', say(`NEG works only on ${ACC_END}: the Z80 can negate no other register.`));
    case 'DAA':
      return on('A', say(`DAA works only on ${ACC_END}: it corrects A after an add or subtract of decimal digits.`));
    case 'JP':
      if (ins.flow.indirect) return on(jumpReg(ins), say('The Z80 can jump to an address held in a register only through HL, IX or IY, so the address to jump to is put in one of them first.'));
      return NONE;
    case 'EX':
      if (o0?.kind === 'reg16' && o0.reg === 'DE' && o1?.kind === 'reg16' && o1.reg === 'HL') {
        return on('HL', say('HL is the register most memory and 16-bit arithmetic instructions use; EX DE,HL swaps a value kept in DE into HL, in one step, so those instructions can use it.'));
      }
      if (isInd(o0, 'SP')) return on(o1?.kind === 'reg16' ? o1.reg : undefined, say('Only HL, IX or IY can be swapped with the top of the stack.'));
      return NONE;
    default:
      return NONE;
  }
}

function loadFacts(dst: Operand | undefined, src: Operand | undefined): Facts {
  if (isReg(dst, 'A') && src?.kind === 'mem') {
    return on('A', say(`Of the one-byte registers, only ${ACC} can be loaded straight from an address written in the instruction; B, C, D, E, H and L can be loaded from one only as half of a pair, two bytes at a time (LD BC,(nn), LD DE,(nn), LD HL,(nn)).`));
  }
  if (dst?.kind === 'mem' && isReg(src, 'A')) {
    return on('A', say(`Of the one-byte registers, only ${ACC} can be stored straight to an address written in the instruction; B, C, D, E, H and L can be stored to one only as half of a pair, two bytes at a time (LD (nn),BC, LD (nn),DE, LD (nn),HL).`));
  }
  if (isReg(dst, 'A') && src?.kind === 'ind' && (src.reg === 'BC' || src.reg === 'DE')) {
    return on('A', say(`Only ${ACC} can be loaded through the address in ${src.reg}; the other registers can be loaded through an address only when it is in HL, IX or IY.`));
  }
  if (dst?.kind === 'ind' && (dst.reg === 'BC' || dst.reg === 'DE') && isReg(src, 'A')) {
    return on('A', say(`Only ${ACC} can be stored through the address in ${dst.reg}; the other registers can be stored through an address only when it is in HL, IX or IY.`));
  }
  if (dst?.kind === 'reg16' && dst.reg === 'SP' && src?.kind === 'reg16') return on(src.reg, say('The stack pointer can be loaded from a register only from HL, IX or IY.'));
  if (isReg(dst, 'A') && (isReg(src, 'I') || isReg(src, 'R'))) return on('A', say(`Only ${ACC} can be loaded from I or R.`));
  if ((isReg(dst, 'I') || isReg(dst, 'R')) && isReg(src, 'A')) return on('A', say(`I and R can be loaded only from ${ACC_END}.`));
  return NONE;
}

const REG = '(A|B|C|D|E|H|L|BC|DE|HL|IX|IY)';
const PAIR = '(BC|DE|HL|IX|IY)';
/** Phrases in a table `purpose` that name a register the routine takes. `out` marks the "the … in A" form, which a "return" or "into" before it turns into a result. */
const INPUT: readonly { re: RegExp; out?: true }[] = [
  { re: new RegExp(`\\b(?:the|a) (?:[\\w-]+ ){0,2}?in ${REG}\\b`, 'g'), out: true },
  { re: new RegExp(`\\b(?:the|a) (?:[\\w-]+ ){0,2}?at ${PAIR}\\b`, 'g') },
  { re: new RegExp(`\\b(?:set|named) by ${REG}\\b`, 'g') },
  { re: new RegExp(`\\b(?:send|sends|display|displays|write|writes) ${REG}\\b`, 'g') },
  { re: new RegExp(`\\b(?:divide|multiply) ${REG} by ${REG}\\b`, 'g') },
  { re: new RegExp(`\\bcompares? ${REG} with ${REG}\\b`, 'g') },
  { re: new RegExp(`\\b(?:advance|step) ${REG}\\b`, 'g') },
  { re: new RegExp(`\\bcontrol block ${PAIR} (?:addresses|points to)\\b`, 'g') },
  { re: new RegExp(`\\b(?:numbered|line number) ${PAIR}\\b`, 'g') },
];

/**
 * The registers a table entry's `purpose` says the routine takes, in the order
 * the purpose names them. Read conservatively: a register it hands back
 * ("return it in A", "into A") is not one, and a phrasing the patterns do not
 * know gives nothing rather than a guess.
 */
export function inputRegisters(purpose: string): string[] {
  const found: { at: number; reg: string }[] = [];
  let offset = 0;
  for (const clause of purpose.split(/([;:,()])/)) {
    for (const { re, out } of INPUT) {
      re.lastIndex = 0;
      for (let m = re.exec(clause); m !== null; m = re.exec(clause)) {
        if (out && /\b(?:returns?|into)\b/.test(clause.slice(0, m.index))) continue;
        const at = offset + m.index;
        m.slice(1).forEach((reg, i) => {
          if (reg !== undefined) found.push({ at: at + i, reg });
        });
      }
    }
    offset += clause.length;
  }
  const regs: string[] = [];
  for (const f of found.sort((p, q) => p.at - q.at)) if (!regs.includes(f.reg)) regs.push(f.reg);
  return regs;
}

/** The one-byte halves a register name stands for. */
function halves(r: string): Reg8Name[] {
  if (r === 'IX') return ['IXH', 'IXL'];
  if (r === 'IY') return ['IYH', 'IYL'];
  if (r.length === 2) return [r[0] as Reg8Name, r[1] as Reg8Name];
  return [r as Reg8Name];
}

/** The register an LD writes, when it writes one the tracker follows (not SP, I or R). */
function loadedRegister(ins: Instruction): string | undefined {
  if (ins.mnemonic !== 'LD') return undefined;
  const d = ins.operands[0];
  if (d?.kind === 'reg' && d.reg !== 'I' && d.reg !== 'R') return d.reg;
  if (d?.kind === 'reg16' && d.reg !== 'SP' && d.reg !== 'AF' && d.reg !== "AF'") return d.reg;
  return undefined;
}

/** How a register is named in this sentence: A with what it is, the rest by name. */
const named = (r: string): string => (r === 'A' ? ACC : r);

/** The longest straight-line run the scan follows before giving up. */
const SCAN = 32;

/**
 * For a line that loads a register: the routine called next in straight-line
 * code, when its table entry says it takes its input in that register (or the
 * pair it belongs to, or one of its halves). The scan follows only
 * instructions that one instruction alone falls into (`straightFrom`), and
 * stops at a branch, a join, a label, unknown code, an instruction the program
 * rewrites, another call, and any write to the bytes the line loaded.
 */
function callInput(c: LineCtx): Facts {
  const dest = loadedRegister(c.ins);
  if (dest === undefined) return NONE;
  const a = c.a;
  let cur = c.addr;
  let ins = c.ins;
  for (let n = 0; n < SCAN; n++) {
    const next = (cur + ins.length) & 0xffff;
    const nextIns = a.pass1.instructions.get(next);
    if (nextIns === undefined || straightFrom(a, next) !== cur || opcodeRewritten(a, next)) return NONE;
    if (nextIns.flow.kind === 'call') return consumer(c, dest, next, nextIns);
    if (nextIns.flow.kind !== 'next') return NONE;
    const mine = halves(dest);
    if (written(nextIns).some((r) => mine.includes(r))) return NONE;
    cur = next;
    ins = nextIns;
  }
  return NONE;
}

/** The sentence for the call at `at`, when it is an unconditional call to a table routine that takes `dest` (or a register sharing its bytes). */
function consumer(c: LineCtx, dest: string, at: number, ins: Instruction): Facts {
  if (ins.flow.conditional || sourceRewritten(c.a, at)) return NONE;
  const op = ins.operands[0];
  const target = ins.mnemonic === 'RST' && op?.kind === 'rst' ? op.addr : ins.mnemonic === 'CALL' && op?.kind === 'imm16' ? op.value : undefined;
  if (target === undefined || c.a.symbols.has(target)) return NONE;
  const table = tableName(c, target, 'code');
  if (table === undefined) return NONE;
  const mine = halves(dest);
  const reg = inputRegisters(table.entry.purpose).find((r) => halves(r).some((h) => mine.includes(h)));
  if (reg === undefined) return NONE;
  return on(
    dest,
    say(
      `${named(dest)} is loaded here because ${routineKind(table.entry)} `,
      { text: table.text, entry: table.entry },
      ' (',
      addrPiece(c, target),
      '), called at ',
      addrPiece(c, at),
      `, takes its input in ${reg}: ${table.entry.purpose}.`,
    ),
  );
}

/**
 * The "why this register" sentences for a code line: the instruction form's
 * facts, then a later call's input register; and the one register they all
 * speak of (the workbench's "Why A"), undefined when they speak of several or
 * there are none.
 */
export function registerWhy(c: LineCtx): { sentences: Sentence[]; about: string | undefined } {
  // An instruction the program may turn into another one is not proven to be this form.
  if (opcodeRewritten(c.a, c.addr)) return { sentences: [], about: undefined };
  const parts = [formFacts(c.ins), callInput(c)].filter((f) => f.s.length > 0);
  const abouts = new Set(parts.map((f) => f.about));
  return { sentences: parts.flatMap((f) => f.s), about: abouts.size === 1 ? [...abouts][0] : undefined };
}
