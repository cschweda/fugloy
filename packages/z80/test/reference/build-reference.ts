/**
 * Builds test/reference/z80.txt from flat per-opcode tables typed from the
 * Zilog Z80 CPU User Manual plus the usual undocumented-opcode references.
 * It deliberately imports nothing from src/: an error here and an error in
 * the x/y/z/p/q generator would have to coincide to go unnoticed.
 *
 *   pnpm exec tsx packages/z80/test/reference/build-reference.ts > packages/z80/test/reference/z80.txt
 *
 * Table conventions: placeholders n, nn, d, e are lowercase. '-' is an
 * undocumented encoding rendered as DB of the bytes the CPU consumes. A
 * leading '*' marks an undocumented instruction that is still decoded (SLL,
 * IXH/IXL). 'CB', 'DD', 'ED', 'FD' as the whole text mark a prefix byte.
 * Operand filler is the byte stream 12 34 consumed in operand order, decoded
 * at address 0000 (so JR e with e=12H targets 0014H).
 */

const UNPREFIXED: string[] = [
  /* 00 */ 'NOP', 'LD BC,nn', 'LD (BC),A', 'INC BC', 'INC B', 'DEC B', 'LD B,n', 'RLCA', "EX AF,AF'", 'ADD HL,BC', 'LD A,(BC)', 'DEC BC', 'INC C', 'DEC C', 'LD C,n', 'RRCA',
  /* 10 */ 'DJNZ e', 'LD DE,nn', 'LD (DE),A', 'INC DE', 'INC D', 'DEC D', 'LD D,n', 'RLA', 'JR e', 'ADD HL,DE', 'LD A,(DE)', 'DEC DE', 'INC E', 'DEC E', 'LD E,n', 'RRA',
  /* 20 */ 'JR NZ,e', 'LD HL,nn', 'LD (nn),HL', 'INC HL', 'INC H', 'DEC H', 'LD H,n', 'DAA', 'JR Z,e', 'ADD HL,HL', 'LD HL,(nn)', 'DEC HL', 'INC L', 'DEC L', 'LD L,n', 'CPL',
  /* 30 */ 'JR NC,e', 'LD SP,nn', 'LD (nn),A', 'INC SP', 'INC (HL)', 'DEC (HL)', 'LD (HL),n', 'SCF', 'JR C,e', 'ADD HL,SP', 'LD A,(nn)', 'DEC SP', 'INC A', 'DEC A', 'LD A,n', 'CCF',
  /* 40 */ 'LD B,B', 'LD B,C', 'LD B,D', 'LD B,E', 'LD B,H', 'LD B,L', 'LD B,(HL)', 'LD B,A', 'LD C,B', 'LD C,C', 'LD C,D', 'LD C,E', 'LD C,H', 'LD C,L', 'LD C,(HL)', 'LD C,A',
  /* 50 */ 'LD D,B', 'LD D,C', 'LD D,D', 'LD D,E', 'LD D,H', 'LD D,L', 'LD D,(HL)', 'LD D,A', 'LD E,B', 'LD E,C', 'LD E,D', 'LD E,E', 'LD E,H', 'LD E,L', 'LD E,(HL)', 'LD E,A',
  /* 60 */ 'LD H,B', 'LD H,C', 'LD H,D', 'LD H,E', 'LD H,H', 'LD H,L', 'LD H,(HL)', 'LD H,A', 'LD L,B', 'LD L,C', 'LD L,D', 'LD L,E', 'LD L,H', 'LD L,L', 'LD L,(HL)', 'LD L,A',
  /* 70 */ 'LD (HL),B', 'LD (HL),C', 'LD (HL),D', 'LD (HL),E', 'LD (HL),H', 'LD (HL),L', 'HALT', 'LD (HL),A', 'LD A,B', 'LD A,C', 'LD A,D', 'LD A,E', 'LD A,H', 'LD A,L', 'LD A,(HL)', 'LD A,A',
  /* 80 */ 'ADD A,B', 'ADD A,C', 'ADD A,D', 'ADD A,E', 'ADD A,H', 'ADD A,L', 'ADD A,(HL)', 'ADD A,A', 'ADC A,B', 'ADC A,C', 'ADC A,D', 'ADC A,E', 'ADC A,H', 'ADC A,L', 'ADC A,(HL)', 'ADC A,A',
  /* 90 */ 'SUB B', 'SUB C', 'SUB D', 'SUB E', 'SUB H', 'SUB L', 'SUB (HL)', 'SUB A', 'SBC A,B', 'SBC A,C', 'SBC A,D', 'SBC A,E', 'SBC A,H', 'SBC A,L', 'SBC A,(HL)', 'SBC A,A',
  /* A0 */ 'AND B', 'AND C', 'AND D', 'AND E', 'AND H', 'AND L', 'AND (HL)', 'AND A', 'XOR B', 'XOR C', 'XOR D', 'XOR E', 'XOR H', 'XOR L', 'XOR (HL)', 'XOR A',
  /* B0 */ 'OR B', 'OR C', 'OR D', 'OR E', 'OR H', 'OR L', 'OR (HL)', 'OR A', 'CP B', 'CP C', 'CP D', 'CP E', 'CP H', 'CP L', 'CP (HL)', 'CP A',
  /* C0 */ 'RET NZ', 'POP BC', 'JP NZ,nn', 'JP nn', 'CALL NZ,nn', 'PUSH BC', 'ADD A,n', 'RST 00H', 'RET Z', 'RET', 'JP Z,nn', 'CB', 'CALL Z,nn', 'CALL nn', 'ADC A,n', 'RST 08H',
  /* D0 */ 'RET NC', 'POP DE', 'JP NC,nn', 'OUT (n),A', 'CALL NC,nn', 'PUSH DE', 'SUB n', 'RST 10H', 'RET C', 'EXX', 'JP C,nn', 'IN A,(n)', 'CALL C,nn', 'DD', 'SBC A,n', 'RST 18H',
  /* E0 */ 'RET PO', 'POP HL', 'JP PO,nn', 'EX (SP),HL', 'CALL PO,nn', 'PUSH HL', 'AND n', 'RST 20H', 'RET PE', 'JP (HL)', 'JP PE,nn', 'EX DE,HL', 'CALL PE,nn', 'ED', 'XOR n', 'RST 28H',
  /* F0 */ 'RET P', 'POP AF', 'JP P,nn', 'DI', 'CALL P,nn', 'PUSH AF', 'OR n', 'RST 30H', 'RET M', 'LD SP,HL', 'JP M,nn', 'EI', 'CALL M,nn', 'FD', 'CP n', 'RST 38H',
];

const UNPREFIXED_CYCLES: string[] = [
  /* 00 */ '4', '10', '7', '6', '4', '4', '7', '4', '4', '11', '7', '6', '4', '4', '7', '4',
  /* 10 */ '13/8', '10', '7', '6', '4', '4', '7', '4', '12', '11', '7', '6', '4', '4', '7', '4',
  /* 20 */ '12/7', '10', '16', '6', '4', '4', '7', '4', '12/7', '11', '16', '6', '4', '4', '7', '4',
  /* 30 */ '12/7', '10', '13', '6', '11', '11', '10', '4', '12/7', '11', '13', '6', '4', '4', '7', '4',
  /* 40 */ '4', '4', '4', '4', '4', '4', '7', '4', '4', '4', '4', '4', '4', '4', '7', '4',
  /* 50 */ '4', '4', '4', '4', '4', '4', '7', '4', '4', '4', '4', '4', '4', '4', '7', '4',
  /* 60 */ '4', '4', '4', '4', '4', '4', '7', '4', '4', '4', '4', '4', '4', '4', '7', '4',
  /* 70 */ '7', '7', '7', '7', '7', '7', '4', '7', '4', '4', '4', '4', '4', '4', '7', '4',
  /* 80 */ '4', '4', '4', '4', '4', '4', '7', '4', '4', '4', '4', '4', '4', '4', '7', '4',
  /* 90 */ '4', '4', '4', '4', '4', '4', '7', '4', '4', '4', '4', '4', '4', '4', '7', '4',
  /* A0 */ '4', '4', '4', '4', '4', '4', '7', '4', '4', '4', '4', '4', '4', '4', '7', '4',
  /* B0 */ '4', '4', '4', '4', '4', '4', '7', '4', '4', '4', '4', '4', '4', '4', '7', '4',
  /* C0 */ '11/5', '10', '10', '10', '17/10', '11', '7', '11', '11/5', '10', '10', '0', '17/10', '17', '7', '11',
  /* D0 */ '11/5', '10', '10', '11', '17/10', '11', '7', '11', '11/5', '4', '10', '11', '17/10', '0', '7', '11',
  /* E0 */ '11/5', '10', '10', '19', '17/10', '11', '7', '11', '11/5', '4', '10', '4', '17/10', '0', '7', '11',
  /* F0 */ '11/5', '10', '10', '4', '17/10', '11', '7', '11', '11/5', '6', '10', '4', '17/10', '0', '7', '11',
];

const CB: string[] = [
  /* 00 */ 'RLC B', 'RLC C', 'RLC D', 'RLC E', 'RLC H', 'RLC L', 'RLC (HL)', 'RLC A', 'RRC B', 'RRC C', 'RRC D', 'RRC E', 'RRC H', 'RRC L', 'RRC (HL)', 'RRC A',
  /* 10 */ 'RL B', 'RL C', 'RL D', 'RL E', 'RL H', 'RL L', 'RL (HL)', 'RL A', 'RR B', 'RR C', 'RR D', 'RR E', 'RR H', 'RR L', 'RR (HL)', 'RR A',
  /* 20 */ 'SLA B', 'SLA C', 'SLA D', 'SLA E', 'SLA H', 'SLA L', 'SLA (HL)', 'SLA A', 'SRA B', 'SRA C', 'SRA D', 'SRA E', 'SRA H', 'SRA L', 'SRA (HL)', 'SRA A',
  /* 30 */ '*SLL B', '*SLL C', '*SLL D', '*SLL E', '*SLL H', '*SLL L', '*SLL (HL)', '*SLL A', 'SRL B', 'SRL C', 'SRL D', 'SRL E', 'SRL H', 'SRL L', 'SRL (HL)', 'SRL A',
  /* 40 */ 'BIT 0,B', 'BIT 0,C', 'BIT 0,D', 'BIT 0,E', 'BIT 0,H', 'BIT 0,L', 'BIT 0,(HL)', 'BIT 0,A', 'BIT 1,B', 'BIT 1,C', 'BIT 1,D', 'BIT 1,E', 'BIT 1,H', 'BIT 1,L', 'BIT 1,(HL)', 'BIT 1,A',
  /* 50 */ 'BIT 2,B', 'BIT 2,C', 'BIT 2,D', 'BIT 2,E', 'BIT 2,H', 'BIT 2,L', 'BIT 2,(HL)', 'BIT 2,A', 'BIT 3,B', 'BIT 3,C', 'BIT 3,D', 'BIT 3,E', 'BIT 3,H', 'BIT 3,L', 'BIT 3,(HL)', 'BIT 3,A',
  /* 60 */ 'BIT 4,B', 'BIT 4,C', 'BIT 4,D', 'BIT 4,E', 'BIT 4,H', 'BIT 4,L', 'BIT 4,(HL)', 'BIT 4,A', 'BIT 5,B', 'BIT 5,C', 'BIT 5,D', 'BIT 5,E', 'BIT 5,H', 'BIT 5,L', 'BIT 5,(HL)', 'BIT 5,A',
  /* 70 */ 'BIT 6,B', 'BIT 6,C', 'BIT 6,D', 'BIT 6,E', 'BIT 6,H', 'BIT 6,L', 'BIT 6,(HL)', 'BIT 6,A', 'BIT 7,B', 'BIT 7,C', 'BIT 7,D', 'BIT 7,E', 'BIT 7,H', 'BIT 7,L', 'BIT 7,(HL)', 'BIT 7,A',
  /* 80 */ 'RES 0,B', 'RES 0,C', 'RES 0,D', 'RES 0,E', 'RES 0,H', 'RES 0,L', 'RES 0,(HL)', 'RES 0,A', 'RES 1,B', 'RES 1,C', 'RES 1,D', 'RES 1,E', 'RES 1,H', 'RES 1,L', 'RES 1,(HL)', 'RES 1,A',
  /* 90 */ 'RES 2,B', 'RES 2,C', 'RES 2,D', 'RES 2,E', 'RES 2,H', 'RES 2,L', 'RES 2,(HL)', 'RES 2,A', 'RES 3,B', 'RES 3,C', 'RES 3,D', 'RES 3,E', 'RES 3,H', 'RES 3,L', 'RES 3,(HL)', 'RES 3,A',
  /* A0 */ 'RES 4,B', 'RES 4,C', 'RES 4,D', 'RES 4,E', 'RES 4,H', 'RES 4,L', 'RES 4,(HL)', 'RES 4,A', 'RES 5,B', 'RES 5,C', 'RES 5,D', 'RES 5,E', 'RES 5,H', 'RES 5,L', 'RES 5,(HL)', 'RES 5,A',
  /* B0 */ 'RES 6,B', 'RES 6,C', 'RES 6,D', 'RES 6,E', 'RES 6,H', 'RES 6,L', 'RES 6,(HL)', 'RES 6,A', 'RES 7,B', 'RES 7,C', 'RES 7,D', 'RES 7,E', 'RES 7,H', 'RES 7,L', 'RES 7,(HL)', 'RES 7,A',
  /* C0 */ 'SET 0,B', 'SET 0,C', 'SET 0,D', 'SET 0,E', 'SET 0,H', 'SET 0,L', 'SET 0,(HL)', 'SET 0,A', 'SET 1,B', 'SET 1,C', 'SET 1,D', 'SET 1,E', 'SET 1,H', 'SET 1,L', 'SET 1,(HL)', 'SET 1,A',
  /* D0 */ 'SET 2,B', 'SET 2,C', 'SET 2,D', 'SET 2,E', 'SET 2,H', 'SET 2,L', 'SET 2,(HL)', 'SET 2,A', 'SET 3,B', 'SET 3,C', 'SET 3,D', 'SET 3,E', 'SET 3,H', 'SET 3,L', 'SET 3,(HL)', 'SET 3,A',
  /* E0 */ 'SET 4,B', 'SET 4,C', 'SET 4,D', 'SET 4,E', 'SET 4,H', 'SET 4,L', 'SET 4,(HL)', 'SET 4,A', 'SET 5,B', 'SET 5,C', 'SET 5,D', 'SET 5,E', 'SET 5,H', 'SET 5,L', 'SET 5,(HL)', 'SET 5,A',
  /* F0 */ 'SET 6,B', 'SET 6,C', 'SET 6,D', 'SET 6,E', 'SET 6,H', 'SET 6,L', 'SET 6,(HL)', 'SET 6,A', 'SET 7,B', 'SET 7,C', 'SET 7,D', 'SET 7,E', 'SET 7,H', 'SET 7,L', 'SET 7,(HL)', 'SET 7,A',
];
// Zilog: 8 on a register; (HL): 15 for shifts/rotates and RES/SET, 12 for BIT.
const cbCycles = (op: number): string => ((op & 7) !== 6 ? '8' : op >= 0x40 && op < 0x80 ? '12' : '15');

const ED: string[] = [
  /* 00 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
  /* 10 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
  /* 20 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
  /* 30 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
  /* 40 */ 'IN B,(C)', 'OUT (C),B', 'SBC HL,BC', 'LD (nn),BC', 'NEG', 'RETN', 'IM 0', 'LD I,A', 'IN C,(C)', 'OUT (C),C', 'ADC HL,BC', 'LD BC,(nn)', '-', 'RETI', '-', 'LD R,A',
  /* 50 */ 'IN D,(C)', 'OUT (C),D', 'SBC HL,DE', 'LD (nn),DE', '-', '-', 'IM 1', 'LD A,I', 'IN E,(C)', 'OUT (C),E', 'ADC HL,DE', 'LD DE,(nn)', '-', '-', 'IM 2', 'LD A,R',
  /* 60 */ 'IN H,(C)', 'OUT (C),H', 'SBC HL,HL', 'LD (nn),HL', '-', '-', '-', 'RRD', 'IN L,(C)', 'OUT (C),L', 'ADC HL,HL', 'LD HL,(nn)', '-', '-', '-', 'RLD',
  /* 70 */ '-', '-', 'SBC HL,SP', 'LD (nn),SP', '-', '-', '-', '-', 'IN A,(C)', 'OUT (C),A', 'ADC HL,SP', 'LD SP,(nn)', '-', '-', '-', '-',
  /* 80 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
  /* 90 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
  /* A0 */ 'LDI', 'CPI', 'INI', 'OUTI', '-', '-', '-', '-', 'LDD', 'CPD', 'IND', 'OUTD', '-', '-', '-', '-',
  /* B0 */ 'LDIR', 'CPIR', 'INIR', 'OTIR', '-', '-', '-', '-', 'LDDR', 'CPDR', 'INDR', 'OTDR', '-', '-', '-', '-',
  /* C0 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
  /* D0 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
  /* E0 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
  /* F0 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
];
// Undocumented ED forms take the cycles of the instruction they duplicate (NEG 8, RETN 14, IM 8,
// IN (C) / OUT (C),0 12); every other invalid ED pair is NONI+NOP at 8.
const ED_CYCLES: string[] = [
  /* 00 */ '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8',
  /* 10 */ '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8',
  /* 20 */ '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8',
  /* 30 */ '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8',
  /* 40 */ '12', '12', '15', '20', '8', '14', '8', '9', '12', '12', '15', '20', '8', '14', '8', '9',
  /* 50 */ '12', '12', '15', '20', '8', '14', '8', '9', '12', '12', '15', '20', '8', '14', '8', '9',
  /* 60 */ '12', '12', '15', '20', '8', '14', '8', '18', '12', '12', '15', '20', '8', '14', '8', '18',
  /* 70 */ '12', '12', '15', '20', '8', '14', '8', '8', '12', '12', '15', '20', '8', '14', '8', '8',
  /* 80 */ '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8',
  /* 90 */ '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8',
  /* A0 */ '16', '16', '16', '16', '8', '8', '8', '8', '16', '16', '16', '16', '8', '8', '8', '8',
  /* B0 */ '21/16', '21/16', '21/16', '21/16', '8', '8', '8', '8', '21/16', '21/16', '21/16', '21/16', '8', '8', '8', '8',
  /* C0 */ '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8',
  /* D0 */ '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8',
  /* E0 */ '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8',
  /* F0 */ '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8', '8',
];

// DD-prefixed. '-' is an opcode the prefix does not affect: the DD byte alone decodes as DB 0DDH (4 T).
const DD: string[] = [
  /* 00 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', 'ADD IX,BC', '-', '-', '-', '-', '-', '-',
  /* 10 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', 'ADD IX,DE', '-', '-', '-', '-', '-', '-',
  /* 20 */ '-', 'LD IX,nn', 'LD (nn),IX', 'INC IX', '*INC IXH', '*DEC IXH', '*LD IXH,n', '-', '-', 'ADD IX,IX', 'LD IX,(nn)', 'DEC IX', '*INC IXL', '*DEC IXL', '*LD IXL,n', '-',
  /* 30 */ '-', '-', '-', '-', 'INC (IX+d)', 'DEC (IX+d)', 'LD (IX+d),n', '-', '-', 'ADD IX,SP', '-', '-', '-', '-', '-', '-',
  /* 40 */ '-', '-', '-', '-', '*LD B,IXH', '*LD B,IXL', 'LD B,(IX+d)', '-', '-', '-', '-', '-', '*LD C,IXH', '*LD C,IXL', 'LD C,(IX+d)', '-',
  /* 50 */ '-', '-', '-', '-', '*LD D,IXH', '*LD D,IXL', 'LD D,(IX+d)', '-', '-', '-', '-', '-', '*LD E,IXH', '*LD E,IXL', 'LD E,(IX+d)', '-',
  /* 60 */ '*LD IXH,B', '*LD IXH,C', '*LD IXH,D', '*LD IXH,E', '*LD IXH,IXH', '*LD IXH,IXL', 'LD H,(IX+d)', '*LD IXH,A', '*LD IXL,B', '*LD IXL,C', '*LD IXL,D', '*LD IXL,E', '*LD IXL,IXH', '*LD IXL,IXL', 'LD L,(IX+d)', '*LD IXL,A',
  /* 70 */ 'LD (IX+d),B', 'LD (IX+d),C', 'LD (IX+d),D', 'LD (IX+d),E', 'LD (IX+d),H', 'LD (IX+d),L', '-', 'LD (IX+d),A', '-', '-', '-', '-', '*LD A,IXH', '*LD A,IXL', 'LD A,(IX+d)', '-',
  /* 80 */ '-', '-', '-', '-', '*ADD A,IXH', '*ADD A,IXL', 'ADD A,(IX+d)', '-', '-', '-', '-', '-', '*ADC A,IXH', '*ADC A,IXL', 'ADC A,(IX+d)', '-',
  /* 90 */ '-', '-', '-', '-', '*SUB IXH', '*SUB IXL', 'SUB (IX+d)', '-', '-', '-', '-', '-', '*SBC A,IXH', '*SBC A,IXL', 'SBC A,(IX+d)', '-',
  /* A0 */ '-', '-', '-', '-', '*AND IXH', '*AND IXL', 'AND (IX+d)', '-', '-', '-', '-', '-', '*XOR IXH', '*XOR IXL', 'XOR (IX+d)', '-',
  /* B0 */ '-', '-', '-', '-', '*OR IXH', '*OR IXL', 'OR (IX+d)', '-', '-', '-', '-', '-', '*CP IXH', '*CP IXL', 'CP (IX+d)', '-',
  /* C0 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', 'CB', '-', '-', '-', '-',
  /* D0 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
  /* E0 */ '-', 'POP IX', '-', 'EX (SP),IX', '-', 'PUSH IX', '-', '-', '-', 'JP (IX)', '-', '-', '-', '-', '-', '-',
  /* F0 */ '-', '-', '-', '-', '-', '-', '-', '-', '-', 'LD SP,IX', '-', '-', '-', '-', '-', '-',
];
const DD_CYCLES: string[] = [
  /* 00 */ '4', '4', '4', '4', '4', '4', '4', '4', '4', '15', '4', '4', '4', '4', '4', '4',
  /* 10 */ '4', '4', '4', '4', '4', '4', '4', '4', '4', '15', '4', '4', '4', '4', '4', '4',
  /* 20 */ '4', '14', '20', '10', '8', '8', '11', '4', '4', '15', '20', '10', '8', '8', '11', '4',
  /* 30 */ '4', '4', '4', '4', '23', '23', '19', '4', '4', '15', '4', '4', '4', '4', '4', '4',
  /* 40 */ '4', '4', '4', '4', '8', '8', '19', '4', '4', '4', '4', '4', '8', '8', '19', '4',
  /* 50 */ '4', '4', '4', '4', '8', '8', '19', '4', '4', '4', '4', '4', '8', '8', '19', '4',
  /* 60 */ '8', '8', '8', '8', '8', '8', '19', '8', '8', '8', '8', '8', '8', '8', '19', '8',
  /* 70 */ '19', '19', '19', '19', '19', '19', '4', '19', '4', '4', '4', '4', '8', '8', '19', '4',
  /* 80 */ '4', '4', '4', '4', '8', '8', '19', '4', '4', '4', '4', '4', '8', '8', '19', '4',
  /* 90 */ '4', '4', '4', '4', '8', '8', '19', '4', '4', '4', '4', '4', '8', '8', '19', '4',
  /* A0 */ '4', '4', '4', '4', '8', '8', '19', '4', '4', '4', '4', '4', '8', '8', '19', '4',
  /* B0 */ '4', '4', '4', '4', '8', '8', '19', '4', '4', '4', '4', '4', '8', '8', '19', '4',
  /* C0 */ '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '0', '4', '4', '4', '4',
  /* D0 */ '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4', '4',
  /* E0 */ '4', '14', '4', '23', '4', '15', '4', '4', '4', '8', '4', '4', '4', '4', '4', '4',
  /* F0 */ '4', '4', '4', '4', '4', '4', '4', '4', '4', '10', '4', '4', '4', '4', '4', '4',
];

// DD CB d op. Only the (HL) column of the CB table is documented; the rest are DB of all four bytes.
const DDCB: string[] = [
  /* 00 */ '-', '-', '-', '-', '-', '-', 'RLC (IX+d)', '-', '-', '-', '-', '-', '-', '-', 'RRC (IX+d)', '-',
  /* 10 */ '-', '-', '-', '-', '-', '-', 'RL (IX+d)', '-', '-', '-', '-', '-', '-', '-', 'RR (IX+d)', '-',
  /* 20 */ '-', '-', '-', '-', '-', '-', 'SLA (IX+d)', '-', '-', '-', '-', '-', '-', '-', 'SRA (IX+d)', '-',
  /* 30 */ '-', '-', '-', '-', '-', '-', '*SLL (IX+d)', '-', '-', '-', '-', '-', '-', '-', 'SRL (IX+d)', '-',
  /* 40 */ '-', '-', '-', '-', '-', '-', 'BIT 0,(IX+d)', '-', '-', '-', '-', '-', '-', '-', 'BIT 1,(IX+d)', '-',
  /* 50 */ '-', '-', '-', '-', '-', '-', 'BIT 2,(IX+d)', '-', '-', '-', '-', '-', '-', '-', 'BIT 3,(IX+d)', '-',
  /* 60 */ '-', '-', '-', '-', '-', '-', 'BIT 4,(IX+d)', '-', '-', '-', '-', '-', '-', '-', 'BIT 5,(IX+d)', '-',
  /* 70 */ '-', '-', '-', '-', '-', '-', 'BIT 6,(IX+d)', '-', '-', '-', '-', '-', '-', '-', 'BIT 7,(IX+d)', '-',
  /* 80 */ '-', '-', '-', '-', '-', '-', 'RES 0,(IX+d)', '-', '-', '-', '-', '-', '-', '-', 'RES 1,(IX+d)', '-',
  /* 90 */ '-', '-', '-', '-', '-', '-', 'RES 2,(IX+d)', '-', '-', '-', '-', '-', '-', '-', 'RES 3,(IX+d)', '-',
  /* A0 */ '-', '-', '-', '-', '-', '-', 'RES 4,(IX+d)', '-', '-', '-', '-', '-', '-', '-', 'RES 5,(IX+d)', '-',
  /* B0 */ '-', '-', '-', '-', '-', '-', 'RES 6,(IX+d)', '-', '-', '-', '-', '-', '-', '-', 'RES 7,(IX+d)', '-',
  /* C0 */ '-', '-', '-', '-', '-', '-', 'SET 0,(IX+d)', '-', '-', '-', '-', '-', '-', '-', 'SET 1,(IX+d)', '-',
  /* D0 */ '-', '-', '-', '-', '-', '-', 'SET 2,(IX+d)', '-', '-', '-', '-', '-', '-', '-', 'SET 3,(IX+d)', '-',
  /* E0 */ '-', '-', '-', '-', '-', '-', 'SET 4,(IX+d)', '-', '-', '-', '-', '-', '-', '-', 'SET 5,(IX+d)', '-',
  /* F0 */ '-', '-', '-', '-', '-', '-', 'SET 6,(IX+d)', '-', '-', '-', '-', '-', '-', '-', 'SET 7,(IX+d)', '-',
];
// Zilog: 23 for shifts/rotates and RES/SET on (IX+d), 20 for BIT; undocumented forms match their column.
const ddcbCycles = (op: number): string => (op >= 0x40 && op < 0x80 ? '20' : '23');

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');
const asm = (digits: string): string => (/^[A-F]/.test(digits) ? `0${digits}H` : `${digits}H`);
const asmByte = (n: number): string => asm(hex2(n));
const asmWord = (n: number): string => asm(n.toString(16).toUpperCase().padStart(4, '0'));

function flowOf(text: string): string {
  const space = text.indexOf(' ');
  const mnemonic = space < 0 ? text : text.slice(0, space);
  const ops = space < 0 ? '' : text.slice(space + 1);
  switch (mnemonic) {
    case 'JP': return ops.startsWith('(') ? 'jump*' : ops.includes(',') ? 'jump?' : 'jump';
    case 'JR': return ops.includes(',') ? 'jump?' : 'jump';
    case 'DJNZ': return 'jump?';
    case 'CALL': return ops.includes(',') ? 'call?' : 'call';
    case 'RST': return 'call';
    case 'RET': return ops === '' ? 'ret' : 'ret?';
    case 'RETI': case 'RETN': return 'ret';
    case 'HALT': return 'halt';
    default: return 'next';
  }
}

interface Section { prefix: number[]; table: string[]; cycles: (op: number) => string; cb: boolean }

function line(section: Section, op: number): string {
  const { prefix, cb } = section;
  let text = section.table[op]!;
  const cycles = section.cycles(op);
  const head = cb ? [...prefix, 0x12, op] : [...prefix, op];
  if (text === 'CB' || text === 'DD' || text === 'ED' || text === 'FD') return `${head.map(hex2).join(' ')} | prefix`;
  if (text === '-') {
    // Bytes the CPU consumes: a lone DD/FD prefix, ED+op, or the whole DD CB d op.
    const bytes = cb ? head : prefix[0] === 0xed ? head : prefix;
    return `${bytes.map(hex2).join(' ')} | DB ${bytes.map(asmByte).join(',')} | ${bytes.length} | ${cycles} | next | undoc`;
  }
  let doc = 'doc';
  if (text.startsWith('*')) { doc = 'undoc'; text = text.slice(1); }
  const bytes = [...head];
  const stream = [0x12, 0x34];
  if (cb) {
    text = text.replace('+d)', '+12H)');
  } else {
    text = text.replace(/\b(nn|n|d|e)\b/g, (m) => {
      if (m === 'nn') {
        const lo = stream.shift()!, hi = stream.shift()!;
        bytes.push(lo, hi);
        return asmWord(lo | (hi << 8));
      }
      const b = stream.shift()!;
      bytes.push(b);
      if (m === 'e') return asmWord((bytes.length + (b >= 0x80 ? b - 256 : b)) & 0xffff);
      return asmByte(b);
    });
  }
  return `${bytes.map(hex2).join(' ')} | ${text} | ${bytes.length} | ${cycles} | ${flowOf(text)} | ${doc}`;
}

const iy = (t: string[]): string[] => t.map((s) => s.replaceAll('IX', 'IY'));
const at = (t: string[]) => (op: number): string => t[op]!;

const SECTIONS: [string, Section][] = [
  ['unprefixed', { prefix: [], table: UNPREFIXED, cycles: at(UNPREFIXED_CYCLES), cb: false }],
  ['CB', { prefix: [0xcb], table: CB, cycles: cbCycles, cb: false }],
  ['ED', { prefix: [0xed], table: ED, cycles: at(ED_CYCLES), cb: false }],
  ['DD', { prefix: [0xdd], table: DD, cycles: at(DD_CYCLES), cb: false }],
  ['FD', { prefix: [0xfd], table: iy(DD), cycles: at(DD_CYCLES), cb: false }],
  ['DDCB', { prefix: [0xdd, 0xcb], table: DDCB, cycles: ddcbCycles, cb: true }],
  ['FDCB', { prefix: [0xfd, 0xcb], table: iy(DDCB), cycles: ddcbCycles, cb: true }],
];

const out: string[] = ['# Z80 reference: bytes | text | length | cycles[/not-taken] | flow | doc. Built by build-reference.ts; do not edit.'];
for (const [name, section] of SECTIONS) {
  if (section.table.length !== 256) throw new Error(`${name} table has ${section.table.length} entries`);
  out.push(`# ${name}`);
  for (let op = 0; op < 256; op++) out.push(line(section, op));
}
process.stdout.write(`${out.join('\n')}\n`);
