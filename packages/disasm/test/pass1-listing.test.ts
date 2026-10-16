import { describe, expect, it } from 'vitest';
import { loadBas } from '../src/bas.js';
import { loadCmd } from '../src/cmd.js';
import { renderPass1Listing } from '../src/listing.js';
import { analyze } from '../src/pipeline.js';
import { loadRaw } from '../src/raw.js';
import { Kind } from '../src/analysis/map.js';
import { applyHints, emptyAnnotations } from '../src/hints/apply.js';
import { BAS_FIXTURES, CMD_FIXTURES, HINT_FIXTURES } from './fixtures.js';
import { writeBasic } from './writers/basic-tokenizer.js';

const cmd = (name: string, entries?: number[]) =>
  renderPass1Listing(analyze(loadCmd(CMD_FIXTURES[name]!()), entries === undefined ? {} : { entries }), { source: `${name}.cmd` });

describe('analyze', () => {
  it('uses the module entry as the root and adds --entry addresses', () => {
    const a = analyze(loadCmd(CMD_FIXTURES['non-contiguous']!()), { entries: [0x7000] });
    expect(a.entry).toBe(0x6000);
    expect(a.roots).toEqual([0x6000, 0x7000]);
    expect(a.pass1.instructions.has(0x7000)).toBe(true);
  });

  it('diagnoses an unloaded extra entry', () => {
    const a = analyze(loadCmd(CMD_FIXTURES['non-contiguous']!()), { entries: [0x9000] });
    expect(a.pass1.diagnostics).toEqual([{ kind: 'unloaded-root', addr: 0x9000, message: 'entry $9000 is not in loaded memory' }]);
  });

  it('exposes the address END may carry: the transfer address, the raw base, or nothing', () => {
    expect(analyze(loadCmd(CMD_FIXTURES['non-contiguous']!())).transfer).toBe(0x6000);
    const lowest = analyze(loadCmd(CMD_FIXTURES['missing-02']!()));
    expect(lowest.entry).toBe(0x5200); // still the root
    expect(lowest.transfer).toBeNull(); // but the file had no transfer record
    expect(analyze(loadRaw(Uint8Array.from([0xc9]), 0x5200)).transfer).toBe(0x5200);
    expect(analyze(loadBas(BAS_FIXTURES['prog-62c8']!())).transfer).toBeNull();
  });

  it('has no roots for a BASIC program and for a module ended by 03', () => {
    expect(analyze(loadBas(BAS_FIXTURES['prog-62c8']!())).roots).toEqual([]);
    expect(analyze(loadCmd(CMD_FIXTURES['end-03']!())).roots).toEqual([]);
  });

  it('uses the raw base as the root', () => {
    expect(analyze(loadRaw(Uint8Array.from([0xc9]), 0x5200)).roots).toEqual([0x5200]);
  });
});

describe('renderPass1Listing', () => {
  it('prints the module header, a pass 1 line, blocks, and the listing with DB rows for unreached bytes', () => {
    const lines = cmd('non-contiguous').split('\n');
    expect(lines[0]).toBe('; non-contiguous.cmd: load module, 2 blocks, 2 runs, 14 bytes, entry $6000 (transfer address)');
    expect(lines[1]).toBe('; pass 1: roots $6000; 6 of 14 bytes decoded as code (43%); 0 external targets; 0 notes');
    expect(lines).toContain('; block 0: $6000-$6005 (6 bytes)');
    expect(lines).toContain('        ORG 6000H');
    expect(lines).toContain('6000  21 00 3C      LD HL,3C00H             ; entry');
    expect(lines).toContain('6003  36 41         LD (HL),41H');
    expect(lines).toContain('6005  C9            RET');
    expect(lines).toContain('        ORG 7000H');
    expect(lines).toContain('7000  00 01 02 03   DB 00H,01H,02H,03H');
    expect(lines).toContain('7004  04 05 06 07   DB 04H,05H,06H,07H');
  });

  it('decodes the second run when --entry names it', () => {
    const lines = cmd('non-contiguous', [0x7000]).split('\n');
    // The eight pattern bytes at $7000 all decode as instructions, so everything is reached.
    expect(lines[1]).toBe('; pass 1: roots $6000, $7000; 14 of 14 bytes decoded as code (100%); 0 external targets; 0 notes');
    expect(lines).toContain('7000  00            NOP                     ; entry');
    expect(lines).toContain('7001  01 02 03      LD BC,0302H');
  });

  it('counts typed data separately from code', () => {
    const mod = loadRaw(Uint8Array.from([0xcf, 0x2c, 0xc9, 1, 2]), 0x6000);
    const lines = renderPass1Listing(analyze(mod), { source: 'x.bin' }).split('\n');
    expect(lines[1]).toBe('; pass 1: roots $6000; 2 of 5 bytes decoded as code (40%); 1 typed as data; 1 external target; 0 notes');
  });

  it('says what to do when there are no roots', () => {
    const lines = cmd('end-03').split('\n');
    expect(lines[1]).toBe('; pass 1: no roots; use --entry <hex> or --sweep');
    expect(lines).toContain('5200  21 00 3C 36   DB 21H,00H,3CH,36H');
  });

  it('cuts DB rows at an instruction start and at the run end', () => {
    // The raw base is always a root; a RET there ends that path so the middle bytes stay unreached.
    const mod = loadRaw(Uint8Array.from([0xc9, 1, 2, 3, 4, 5, 0xc9]), 0x7000);
    const lines = renderPass1Listing(analyze(mod, { entries: [0x7006] }), { source: 'x.bin' }).split('\n');
    expect(lines[0]).toBe('; x.bin: raw binary, 7 bytes at $7000-$7006');
    expect(lines).toContain('7000  C9            RET                     ; entry');
    expect(lines).toContain('7001  01 02 03 04   DB 01H,02H,03H,04H');
    expect(lines).toContain('7005  05            DB 05H');
    expect(lines).toContain('7006  C9            RET                     ; entry');
  });

  it('lists diagnostics as notes and counts external targets', () => {
    const mod = loadRaw(Uint8Array.from([0xcd, 0x33, 0x00, 0x18, 0xfc]), 0x6000); // CALL 0033 ; JR 6001
    const lines = renderPass1Listing(analyze(mod), { source: 'x.bin' }).split('\n');
    expect(lines[1]).toBe('; pass 1: roots $6000; 5 of 5 bytes decoded as code (100%); 1 external target; 1 note');
    // The jump target inside the instruction gets a synthesized symbol, emitted as EQU in source; the listing says so.
    expect(lines[2]).toBe('; symbol L6001 = $6001 (inside the instruction at $6000)');
    expect(lines[3]).toBe('; note: target $6001 is inside the instruction at $6000');
  });
});

describe('renderPass1Listing with hints and symbols', () => {
  const listing = () => {
    const mod = loadCmd(CMD_FIXTURES['hint-paths']!());
    const applied = applyHints(HINT_FIXTURES['hint-paths']!(), mod.image);
    const a = analyze(mod, {
      annotations: applied.annotations,
      hints: { source: 'hint-paths.hints', matched: applied.matched.length, unmatched: applied.unmatched.length, applied: 11, warnings: applied.warnings },
    });
    return renderPass1Listing(a, { source: 'hint-paths.cmd' }).split('\n');
  };

  it('summarises the hint file and lists symbols that sit inside instructions', () => {
    const lines = listing();
    expect(lines).toContain('; hints: hint-paths.hints: 1 block matched, 0 unmatched, 11 hints applied');
    expect(lines).toContain('; symbol MIDCALL = $6001 (inside the instruction at $6000)');
  });

  it('prints label lines before their rows and symbol names in operands', () => {
    const lines = listing();
    const i = lines.indexOf('PRINT:');
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 1]).toBe('6020  3E 41         LD A,41H');
    expect(lines).toContain('6000  CD 20 60      CALL PRINT              ; entry; call PRINT, then dispatch through the table');
    expect(lines).toContain('6003  21 40 60      LD HL,DATA_6040');
    expect(lines).toContain('6006  3A 50 60      LD A,(FLAGS)');
  });

  it('shows words and tables as DW rows and splits data rows at symbols and kind changes', () => {
    const lines = listing();
    expect(lines).toContain('DISPATCH:');
    expect(lines).toContain('6030  19 60 1B 60   DW L6019,L601B');
    expect(lines).toContain('6040  34 12 78 56   DW 1234H,5678H');
    expect(lines).toContain('6044  BB AA         DW 0AABBH');
    expect(lines).toContain('FLAGS:');
    expect(lines).toContain('6050  01 02 03 04   DB 01H,02H,03H,04H');
    expect(lines).toContain("6054  48 45 4C 4C   DB 'HELL'"); // a string hint lists quoted
    expect(lines).toContain("6058  4F 0D         DB 'O',0DH");
    expect(lines).toContain('605A  FF            DB 0FFH');
  });

  it('repeats apply warnings in the header', () => {
    const mod = loadCmd(CMD_FIXTURES['hint-paths']!());
    const a = analyze(mod, { hints: { source: 'x.hints', matched: 0, unmatched: 1, applied: 0, warnings: ['hint block 0 (length $0001, hash 0000000000000000) has no matching run; 2 hints skipped'] } });
    const lines = renderPass1Listing(a).split('\n');
    expect(lines).toContain('; hints: x.hints: 0 blocks matched, 1 unmatched, 0 hints applied');
    expect(lines).toContain('; warning: hint block 0 (length $0001, hash 0000000000000000) has no matching run; 2 hints skipped');
  });
});

const LINE_250 = 'CLS:Q0=PEEK(16549)*256+PEEK(16548)+14:Q1=INT(Q0/256):Q0=Q0-Q1*256:POKE16422,Q0:POKE16423,Q1:POKE16421,195';
/** Valkyrie in miniature: line 1 jumps past line 2, whose body is LD B,H / LD A,C / RET, and line 250 plants a JP to program start + 14. */
const planted = () =>
  loadBas(writeBasic([{ number: 1, text: 'GOTO250' }, { number: 2, raw: [0x44, 0x79, 0xc9] }, { number: 250, text: LINE_250 }], 0x7000));
/** One listing row, in formatListingLine's columns. */
const row = (addr: string, bytes: string, text: string, comment?: string): string => {
  const body = `${addr}  ${bytes.padEnd(12)}  ${text}`;
  return comment === undefined ? body : `${body.padEnd(44)}; ${comment}`;
};

describe('analyze on a .BAS program', () => {
  it('roots each code line at its body start, decodes it, and keeps BASIC text typed with its line as a comment', () => {
    const a = analyze(loadBas(BAS_FIXTURES['hidden-code']!()));
    expect(a.roots).toEqual([0x700d]);
    expect(a.entries).toEqual([]);
    expect([...a.pass1.instructions.keys()]).toEqual([0x700d]);
    expect(a.pass1.map.kind(0x7004)).toBe(Kind.Byte);
    expect(a.annotations.comments.get(0x7004)).toBe('10 GOTO 30');
    expect(a.annotations.comments.get(0x7009)).toBe('line 20: machine code, 6 bytes at $700D');
  });

  it('roots mined entries before the body starts of code lines', () => {
    const a = analyze(planted());
    expect(a.entries).toEqual([{ addr: 0x700e, evidence: 'line 250: POKE 16421,195 with address program start + 14', line: 250 }]);
    expect(a.roots).toEqual([0x700e, 0x700d]);
    expect([...a.pass1.instructions.keys()].sort((x, y) => x - y)).toEqual([0x700d, 0x700e, 0x700f]);
  });

  it('lets hints win over the structure: bytes over a code line, code over a BASIC line', () => {
    const prog = loadBas(BAS_FIXTURES['hidden-code']!());
    const asData = analyze(prog, { annotations: { ...emptyAnnotations(), overrides: [{ addr: 0x700d, kind: 'bytes', length: 6 }] } });
    expect(asData.pass1.instructions.size).toBe(0);
    const asCode = analyze(prog, { annotations: { ...emptyAnnotations(), overrides: [{ addr: 0x7004, kind: 'code', length: 4 }] } });
    expect(asCode.pass1.instructions.has(0x7004)).toBe(true);
  });
});

describe('renderPass1Listing on a .BAS program', () => {
  it('prints BASIC lines as text and each code line as rows at its true addresses', () => {
    const text = renderPass1Listing(analyze(loadBas(BAS_FIXTURES['hidden-code']!())), { source: 'hidden-code.bas' });
    expect(text).toContain('; code lines: 1; entries mined: 0\n');
    expect(text).toContain(['', '10 GOTO 30', '; line 20: machine code, 6 bytes at $700D', row('700D', 'C3 00 00', 'JP 0000H', 'entry'), row('7010', 'C9 00 3E', 'DB 0C9H,00H,3EH'), '30 END', ''].join('\n'));
  });

  it('names each mined entry with its evidence in the header', () => {
    const text = renderPass1Listing(analyze(planted()));
    expect(text).toContain('; pass 1: roots $700E, $700D;');
    expect(text).toContain('; code lines: 1; entries mined: 1\n; entry $700E (line 250: POKE 16421,195 with address program start + 14)\n');
    expect(text).toContain(['1 GOTO250', '; line 2: machine code, 3 bytes at $700D', row('700D', '44', 'LD B,H', 'entry'), row('700E', '79', 'LD A,C', 'entry'), row('700F', 'C9', 'RET'), `250 ${LINE_250}`].join('\n'));
  });

  it('shortens a long root list', () => {
    const lines = [{ number: 1, text: 'END' }, ...Array.from({ length: 10 }, (_, i) => ({ number: i + 2, raw: [0xc9] }))];
    const text = renderPass1Listing(analyze(loadBas(writeBasic(lines, 0x7000))));
    expect(text).toContain('; pass 1: roots $700A, $7010, $7016, $701C, $7022, $7028, $702E, $7034 and 2 more;');
  });
});

describe('strings and proposals', () => {
  const text = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
  // LD HL,7004H / RET, then the text it points at.
  const greeting = () => loadRaw(Uint8Array.from([0x21, 0x04, 0x70, 0xc9, ...text("IT'S HI"), 0x0d]), 0x7000);

  it('types a terminated printable run as a string and lists it quoted, four bytes a row', () => {
    const a = analyze(greeting());
    expect(a.pass1.map.kind(0x7004)).toBe(Kind.String);
    const lines = renderPass1Listing(a).split('\n');
    const at = lines.indexOf('DATA_7004:');
    expect(lines.slice(at, at + 3)).toEqual(['DATA_7004:', row('7004', "49 54 27 53", "DB 'IT''S'"), row('7008', '20 48 49 0D', "DB ' HI',0DH")]);
  });

  it('lets a string hint win, and never overrides a bytes hint', () => {
    const asString = analyze(greeting(), { annotations: { ...emptyAnnotations(), overrides: [{ addr: 0x7004, kind: 'string', length: 3 }] } });
    expect([0x7004, 0x7006, 0x7007].map((x) => asString.pass1.map.kind(x))).toEqual([Kind.String, Kind.String, Kind.Unknown]);
    const asBytes = analyze(greeting(), { annotations: { ...emptyAnnotations(), overrides: [{ addr: 0x7004, kind: 'bytes', length: 8 }] } });
    expect(asBytes.pass1.map.kind(0x7004)).toBe(Kind.Byte);
  });

  it('names a proposed table in the header with the hint line that declares it, and applies nothing', () => {
    const mod = loadRaw(Uint8Array.from([0xc9, 0xc9, 0xc9, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x70, 0x01, 0x70, 0x02, 0x70, 0x00, 0x00]), 0x7000);
    const a = analyze(mod, { entries: [0x7001, 0x7002] });
    expect(a.proposals).toEqual([{ kind: 'table', addr: 0x700a, count: 3, hint: 'block 0:$000A table 3 2' }]);
    expect(a.pass1.map.kind(0x700a)).toBe(Kind.Unknown);
    expect(renderPass1Listing(a)).toContain('\n; proposed table at $700A, 3 entries, all in code; declare with: block 0:$000A table 3 2\n');
  });
});

describe('a relocated region in the listing', () => {
  it('appears at its runtime addresses under a header naming both ranges', () => {
    const mod = loadCmd(CMD_FIXTURES['relocated-code']!());
    const a = analyze(mod, { annotations: applyHints(HINT_FIXTURES['relocated-code']!(), mod.image).annotations });
    const text = renderPass1Listing(a, { source: 'relocated-code.cmd' });
    expect(text).toContain(['        ORG 8000H', '; relocated: file $8000-$800A executes at $5000-$500A', 'L5000:', row('5000', 'CD 08 50', 'CALL SETONE')].join('\n'));
    expect(text).toContain(row('5003', '18 02', 'JR L5007', 'skip the padding'));
    expect(text).toContain(['', '        ORG 8100H', row('8100', '21 00 80', 'LD HL,8000H', 'entry')].join('\n'));
  });
});
