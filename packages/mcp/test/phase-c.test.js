/**
 * MCP phase C tools (docs/fugloy-mcp-spec.md §5, §11) on a synthetic ROM and synthetic
 * programs, so CI runs them: label, unlabel, labels, coverage, suggest, and the exported file
 * the disassembler reads.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProgram, parseLabelFile as disasmParse, renderSession, withLabelFile } from '@fugloy/disasm';
import { decodeRle, encodeRle, parseLabelFile } from '@fugloy/emu';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RAIDERS, buildCmd, connect, syntheticRom, testConfig } from './helpers.js';

const NO_MACHINE = 'No program loaded; call load first.';

/** Whether the temporary folder's volume ignores case: decided at collection, for it.skipIf. */
const CASE_INSENSITIVE = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'fugloy-mcp-case-'));
  try {
    writeFileSync(join(probe, 'probe'), '');
    return existsSync(join(probe, 'PROBE'));
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

/**
 * CHORES: calls three routines five times each from one loop, then halts. KEY (7040h) reads
 * the keyboard, BEEP (7050h) writes port FFh, DELAY (7060h) counts BC down from 1,200.
 */
const CHORES = (() => {
  const code = new Array(0x6b).fill(0);
  const place = (addr, bytes) => code.splice(addr - 0x7000, bytes.length, ...bytes);
  place(0x7000, [0x31, 0x00, 0x7f]); //  7000  LD SP,7F00H
  place(0x7003, [0x06, 0x05]); //        7003  LD B,5
  place(0x7005, [0xcd, 0x40, 0x70]); //  7005  CALL 7040H
  place(0x7008, [0xcd, 0x50, 0x70]); //  7008  CALL 7050H
  place(0x700b, [0xcd, 0x60, 0x70]); //  700B  CALL 7060H
  place(0x700e, [0x10, 0xf5]); //        700E  DJNZ 7005H
  place(0x7010, [0x76]); //              7010  HALT
  place(0x7040, [0x3a, 0x40, 0x38, 0xc9]); //   7040  LD A,(3840H) / RET
  place(0x7050, [0x3e, 0x01, 0xd3, 0xff, 0xc9]); //   7050  LD A,1 / OUT (FFH),A / RET
  place(0x7060, [0xc5, 0x01, 0xb0, 0x04]); //   7060  PUSH BC / LD BC,1200
  place(0x7064, [0x0b, 0x78, 0xb1, 0x20, 0xfb]); //   7064  DEC BC / LD A,B / OR C / JR NZ,7064H
  place(0x7069, [0xc1, 0xc9]); //       7069  POP BC / RET
  return buildCmd([{ name: 'CHORES' }, { addr: 0x7000, data: code }], 0x7000);
})();

let dir;
const at = (name) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-phase-c-'));
  writeFileSync(at('synthetic.rom'), syntheticRom());
  writeFileSync(at('raiders.cmd'), RAIDERS);
  writeFileSync(at('chores.cmd'), CHORES);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  for (const f of ['raiders.fugloy.json', 'chores.fugloy.json', 'elsewhere.json', 'notes.hints', 'RAIDERS.FUGLOY.JSON']) rmSync(at(f), { force: true });
});

const server = () => connect({ config: testConfig({ roms: { model3: at('synthetic.rom') } }) });

async function ok(call, name, args) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

/** RAIDERS loaded, its title printed, ENTER pressed: PRINT has run three times. */
async function raidersPlayed() {
  const s = await server();
  await ok(s.call, 'load', { path: at('raiders.cmd') });
  await ok(s.call, 'run', { until: 'settled' });
  await ok(s.call, 'key', { keys: ['ENTER'] });
  return s;
}

const bitsOf = (field) => {
  const bits = decodeRle(field);
  return [...bits.keys()].filter((a) => bits[a] === 1);
};

describe('phase C tools', () => {
  it('every phase C tool before load explains itself', async () => {
    const { call, close } = await server();
    const calls = [
      ['label', { addr: '7030', name: 'PRINT' }],
      ['unlabel', { addr: '7030' }],
      ['labels', {}],
      ['coverage', {}],
      ['suggest', {}],
    ];
    for (const [name, args] of calls) expect(await call(name, args), name).toEqual({ text: NO_MACHINE, isError: true });
    await close();
  });

  it('label checks the name, kind, size, and note, and labels lists by range and source', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('raiders.cmd') });
    const refused = async (args) => (await call('label', { addr: '7030', ...args })).text;
    expect(await refused({ name: '1ST' })).toBe('The name "1ST" is not an identifier (a name is a letter or _, then letters, digits, or _, up to 32 characters); choose another name.');
    expect(await refused({ name: 'hl' })).toBe('The name "hl" is reserved (a Z80 mnemonic, register, condition, or zmac word); choose another name.');
    expect(await refused({ name: 'SUB_7030' })).toBe('The name "SUB_7030" has the shape of a generated label (L, SUB_, DATA_, or TBL_ and four hex digits means no name was given); choose another name.');
    expect(await refused({ name: 'PRINT', note: 'two\nlines' })).toBe('note must not contain a control character (a new line would break the listing).');
    expect(await refused({ name: 'PRINT', size: 0 })).toBe('size must be between 1 and 65536, not 0.');
    expect(await refused({ name: 'PRINT', kind: 'text' })).toMatch(/^The argument "kind" is not valid/);

    expect(await ok(call, 'label', { addr: '7030', name: 'PRINT' })).toMatch(/^Labelled 7030h PRINT \(code\)\.\nWrote /);
    expect(await ok(call, 'label', { addr: '7040', name: 'BANNER', kind: 'data', size: 14, note: 'SPACE RAIDERS, zero-ended' })).toMatch(/^Labelled 7040h BANNER \(data, 14 bytes\)\./);
    expect(await refused({ addr: '7050', name: 'print' })).toBe('The name PRINT is already the label at 7030h; unlabel it first or choose another name.');
    // The same address replaces, and says so.
    expect(await ok(call, 'label', { addr: 'print', name: 'PUTS' })).toMatch(/^Labelled 7030h PUTS \(code\), replacing PRINT\.\n/);
    expect(await ok(call, 'labels', {})).toBe(
      [
        'Labels (2):',
        'addr   kind  size   source    name',
        '7030h  code         user      PUTS',
        '7040h  data     14  user      BANNER  ; SPACE RAIDERS, zero-ended',
      ].join('\n'),
    );
    expect(await ok(call, 'labels', { range: '7040-70FF' })).toBe(
      ['Labels (1 of 2, in 7040h–70FFh):', 'addr   kind  size   source    name', '7040h  data     14  user      BANNER  ; SPACE RAIDERS, zero-ended'].join('\n'),
    );
    expect(await ok(call, 'labels', { source: 'observed' })).toBe('No labels with source observed (2 labels in all).');
    // disasm names the data label as an operand.
    expect((await ok(call, 'disasm', { addr: '7006', n: 1 })).split('\n')[0]).toBe('? 7006  11 40 70     LD DE,7040H       ; BANNER');

    expect(await call('unlabel', {})).toEqual({ text: 'Give addr or name.', isError: true });
    expect((await call('unlabel', { addr: '7030', name: 'PUTS' })).text).toBe('Give addr or name, not both.');
    expect((await call('unlabel', { addr: '7031' })).text).toBe('No label is at 7031h.');
    expect((await call('unlabel', { name: 'NOPE' })).text).toBe('No label is named NOPE.');
    expect(await ok(call, 'unlabel', { addr: '7040' })).toMatch(/^Removed BANNER at 7040h\.\nWrote /);
    expect(await ok(call, 'status', {})).toContain('Labels: 1');
    await close();
  });

  it('label warns when a name is all hex digits, which address arguments refuse as ambiguous', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('raiders.cmd') });
    const out = await ok(call, 'label', { addr: '7040', name: 'CAFE', kind: 'data' });
    expect(out.split('\n')).toEqual([
      'Labelled 7040h CAFE (data).',
      `Wrote ${at('raiders.fugloy.json')}.`,
      'Note: CAFE is all hex digits, so an address argument "CAFE" is refused as ambiguous (it is also CAFEh); refer to this label as 28736 (decimal), or relabel it with a name that has a letter past F.',
    ]);
    expect((await call('peek', { addr: 'CAFE', len: 1 })).text).toMatch(/^"CAFE" is ambiguous/);
    expect(await ok(call, 'peek', { addr: 28736, len: 1 })).toContain('; CAFE');
    expect(await ok(call, 'label', { addr: '7050', name: 'PLAYER' })).not.toContain('Note:');
    await close();
  });

  it('coverage summarises, tabulates, and gives JSON for the loaded blocks', async () => {
    const { call, close } = await raidersPlayed();
    expect(await ok(call, 'coverage', {})).toBe(
      [
        'Coverage since load (this session):',
        'Loaded: 112 bytes in 1 block (7000h–706Fh)',
        'Executed: 47 bytes (42.0%) in 2 code ranges',
        'Data: 33 bytes read or written and never executed, in 3 data ranges',
        'Never seen: 32 bytes',
        'Outside the loaded blocks: 0 bytes executed, 33 read or written',
        `Sidecar: none yet (coverage mode "export" writes ${at('raiders.fugloy.json')})`,
      ].join('\n'),
    );
    expect(await ok(call, 'coverage', { mode: 'ranges' })).toBe(
      [
        'Ranges in the loaded blocks (10):',
        'start  end    bytes  kind',
        '7000h  7026h     39  code',
        '7027h  702Fh      9  never seen',
        '7030h  7037h      8  code',
        '7038h  703Fh      8  never seen',
        '7040h  704Dh     14  data',
        '704Eh  704Fh      2  never seen',
        '7050h  7058h      9  data',
        '7059h  705Fh      7  never seen',
        '7060h  7069h     10  data',
        '706Ah  706Fh      6  never seen',
      ].join('\n'),
    );
    const json = JSON.parse(await ok(call, 'coverage', { format: 'json' }));
    expect(json).toMatchObject({ loaded: 112, executed: 47, data: 33, unseen: 32, codeRanges: 2, dataRanges: 3, outside: { executed: 0, data: 33 } });
    expect(json.blocks).toEqual([{ addr: 0x7000, len: 112 }]);
    expect(json.ranges[0]).toEqual({ addr: 0x7000, len: 39, kind: 'code' });
    expect((await call('coverage', { mode: 'summary', path: at('x.json') })).text).toBe('path is only for mode "export".');
    expect(existsSync(at('x.json'))).toBe(false);
    await close();
  });

  it('coverage export merges prior coverage and appends a session', async () => {
    const sidecar = at('raiders.fugloy.json');
    // A first session: the title only, so PRINT has been called once.
    const first = await server();
    await ok(first.call, 'load', { path: at('raiders.cmd') });
    await ok(first.call, 'run', { until: 'settled' });
    expect(await ok(first.call, 'coverage', { mode: 'export' })).toMatch(new RegExp(`^Wrote ${sidecar.replace(/[.$]/g, '\\$&')}: 2 labels, 1 session\\n`));
    await first.close();
    // Pretend an earlier session also ran 7038h, which this one never does.
    const prior = JSON.parse(readFileSync(sidecar, 'utf8'));
    expect(prior.callers['28720']).toEqual([{ from: 0x7009, kind: 'call', count: 1 }, { from: 0x7036, kind: 'jr', count: 13 }]);
    const exec = decodeRle(prior.coverage['0:0'].exec);
    exec[0x7038] = 1;
    prior.coverage['0:0'].exec = encodeRle(exec, 1);
    writeFileSync(sidecar, JSON.stringify(prior));

    const { call, close } = await raidersPlayed();
    const out = await ok(call, 'coverage', { mode: 'export' });
    expect(out.split('\n')[0]).toBe(`Wrote ${sidecar}: 2 labels, 2 sessions (1 earlier, merged)`);
    const merged = parseLabelFile(readFileSync(sidecar, 'utf8')).file;
    expect(merged.sessions).toHaveLength(2);
    expect(bitsOf(merged.coverage['0:0'].exec)).toContain(0x7038);
    expect(bitsOf(merged.coverage['0:0'].exec)).toContain(0x7019);
    expect(merged.callers['28720']).toEqual([
      { from: 0x7009, kind: 'call', count: 2 },
      { from: 0x7019, kind: 'call', count: 1 },
      { from: 0x7022, kind: 'call', count: 1 },
      { from: 0x7036, kind: 'jr', count: 13 + 30 },
    ]);
    // Exporting again replaces this session's record instead of adding a third or counting twice.
    await ok(call, 'coverage', { mode: 'export' });
    const again = parseLabelFile(readFileSync(sidecar, 'utf8')).file;
    expect(again.sessions).toHaveLength(2);
    expect(again.callers['28720'][0]).toEqual({ from: 0x7009, kind: 'call', count: 2 });
    // A label written after the export keeps the exported coverage.
    await ok(call, 'label', { addr: '7030', name: 'PRINT' });
    const labelled = parseLabelFile(readFileSync(sidecar, 'utf8')).file;
    expect(labelled.sessions).toHaveLength(2);
    expect(bitsOf(labelled.coverage['0:0'].exec)).toContain(0x7038);
    expect(labelled.labels.map((l) => [l.name, l.source])).toEqual([['ENTRY', 'loader'], ['PRINT', 'user']]);
    // An explicit path gets the same file and leaves the sidecar alone.
    expect((await ok(call, 'coverage', { mode: 'export', path: at('elsewhere.json') })).split('\n')[0]).toBe(`Wrote ${at('elsewhere.json')}: 2 labels, 2 sessions (1 earlier, merged)`);
    expect(parseLabelFile(readFileSync(at('elsewhere.json'), 'utf8')).errors).toEqual([]);
    expect((await call('coverage', { mode: 'export', path: dir })).text).toBe(`${dir} is a folder; give a file path to export to.`);
    expect((await call('coverage', { mode: 'export', path: at('raiders.cmd') })).text).toBe(`${at('raiders.cmd')} is the program itself; give another path to export to.`);
    await close();
  });

  it('coverage export replaces a label file at path, but nothing else unless overwrite is true', async () => {
    const hints = '; my hand-written hints\nblock 0:0 code\n';
    writeFileSync(at('notes.hints'), hints);
    const { call, close } = await raidersPlayed();
    expect(await call('coverage', { mode: 'export', path: at('notes.hints') })).toEqual({
      text: `${at('notes.hints')} exists and it is not JSON, so it is not overwritten; give another path, or pass overwrite: true to replace it.`,
      isError: true,
    });
    expect(readFileSync(at('notes.hints'), 'utf8')).toBe(hints);
    writeFileSync(at('elsewhere.json'), '{"version": 1}');
    expect((await call('coverage', { mode: 'export', path: at('elsewhere.json') })).text).toMatch(new RegExp(`^${at('elsewhere.json').replace(/[.$]/g, '\\$&')} exists and it is not a label file \\(`));
    expect((await call('coverage', { overwrite: true })).text).toBe('overwrite is only for mode "export".');
    // overwrite: true replaces it; a label file there is replaced without it.
    const out = await ok(call, 'coverage', { mode: 'export', path: at('notes.hints'), overwrite: true });
    expect(out).toContain(`(it replaced the file that was at ${at('notes.hints')})`);
    expect(parseLabelFile(readFileSync(at('notes.hints'), 'utf8')).errors).toEqual([]);
    expect(await ok(call, 'coverage', { mode: 'export', path: at('notes.hints') })).toContain('(it replaced the file');
    await close();
  });

  it('suggest finds the synthetic print routine with "writes video RAM"', async () => {
    const { call, close } = await raidersPlayed();
    expect(await ok(call, 'suggest', { minCalls: 3 })).toBe(
      [
        'Unlabelled call targets with at least 3 calls, most calls first:',
        'addr   calls  callers  notes (by address, heuristic)',
        '7030h      3        3  writes video RAM',
      ].join('\n'),
    );
    expect(await ok(call, 'suggest', {})).toBe('No unlabelled call target has 5 or more calls since load (the most is 7030h, with 3); lower minCalls to see more.');
    await ok(call, 'label', { addr: '7030', name: 'PRINT' });
    expect(await ok(call, 'suggest', { minCalls: 1 })).toBe('No unlabelled call target has 1 or more calls since load.');
    expect((await call('suggest', { minCalls: 0 })).text).toBe('minCalls must be at least 1, not 0.');
    await close();
  });

  it('suggest notes keyboard reads, sound, and long loops', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('chores.cmd') });
    await ok(call, 'run', { until: 'halt' });
    expect(await ok(call, 'suggest', {})).toBe(
      [
        'Unlabelled call targets with at least 5 calls, most calls first:',
        'addr   calls  callers  notes (by address, heuristic)',
        '7040h      5        1  reads the keyboard',
        '7050h      5        1  writes port FFh (sound)',
        '7060h      5        1  loops ≥ 1000× a call',
      ].join('\n'),
    );
    await close();
  });

  it('the exported file is read by the disassembler', async () => {
    const { call, close } = await raidersPlayed();
    await ok(call, 'label', { addr: '7030', name: 'PRINT', note: 'copies DE to video RAM at HL' });
    await ok(call, 'label', { addr: '7040', name: 'BANNER', kind: 'data', size: 14 });
    await ok(call, 'coverage', { mode: 'export', path: at('elsewhere.json') });
    await close();
    const { file, errors } = disasmParse(readFileSync(at('elsewhere.json'), 'utf8'));
    expect(errors).toEqual([]);
    const listing = renderSession(withLabelFile(openProgram(RAIDERS, { name: 'raiders.cmd' }), file, 'elsewhere.json'), 'listing');
    expect(listing).toMatch(/^PRINT:/m);
    expect(listing).toContain('; copies DE to video RAM at HL');
    expect(listing).toMatch(/^BANNER:/m);
    expect(listing).toMatch(/CALL +PRINT/);
  });

  it('coverage export compares files by identity: links, the program, the ROM', async () => {
    symlinkSync(at('raiders.cmd'), at('link.cmd'));
    symlinkSync(dir, at('dirlink'));
    try {
      const { call, close } = await raidersPlayed();
      const refused = async (path) => (await call('coverage', { mode: 'export', path })).text;
      expect(await refused(join(at('dirlink'), 'raiders.cmd'))).toBe(`${join(at('dirlink'), 'raiders.cmd')} is the program itself; give another path to export to.`);
      expect(await refused(at('link.cmd'))).toBe(`${at('link.cmd')} is a symbolic link; the server does not write through links (replace it with a file, or remove it).`);
      expect(await refused(at('synthetic.rom'))).toBe(`${at('synthetic.rom')} is the ROM; give another path to export to.`);
      expect(readFileSync(at('raiders.cmd'))).toEqual(Buffer.from(RAIDERS));
      await close();

      // An ignored sidecar is protected through a linked folder too.
      writeFileSync(at('raiders.fugloy.json'), 'broken');
      const again = await server();
      await ok(again.call, 'load', { path: at('raiders.cmd') });
      const path = join(at('dirlink'), 'raiders.fugloy.json');
      expect((await again.call('coverage', { mode: 'export', path })).text).toMatch(/^The sidecar .* was ignored at load/);
      expect(readFileSync(at('raiders.fugloy.json'), 'utf8')).toBe('broken');
      await again.close();
    } finally {
      rmSync(at('link.cmd'));
      rmSync(at('dirlink'));
    }
  });

  // Case variants name the same file only on a case-insensitive volume (macOS and Windows by
  // default); on a case-sensitive one (most Linux, so CI) this test is reported as skipped.
  it.skipIf(!CASE_INSENSITIVE)('coverage export compares files by identity: case variants of the program and the sidecar', async () => {
    const { call, close } = await raidersPlayed();
    expect((await call('coverage', { mode: 'export', path: at('RAIDERS.CMD') })).text).toBe(`${at('RAIDERS.CMD')} is the program itself; give another path to export to.`);
    expect(readFileSync(at('raiders.cmd'))).toEqual(Buffer.from(RAIDERS));
    await close();

    writeFileSync(at('raiders.fugloy.json'), 'broken');
    const again = await server();
    await ok(again.call, 'load', { path: at('raiders.cmd') });
    expect((await again.call('coverage', { mode: 'export', path: at('RAIDERS.FUGLOY.JSON') })).text).toMatch(/^The sidecar .* was ignored at load/);
    expect(readFileSync(at('raiders.fugloy.json'), 'utf8')).toBe('broken');
    await again.close();
  });

  // On a case-insensitive volume a case variant of the sidecar's path is the sidecar even before
  // it exists, so the export is adopted as the sidecar and a later label can rewrite it.
  it.skipIf(!CASE_INSENSITIVE)('coverage export to a case variant of a sidecar that does not exist yet writes the sidecar', async () => {
    const { call, close } = await raidersPlayed();
    const out = await ok(call, 'coverage', { mode: 'export', path: at('RAIDERS.FUGLOY.JSON') });
    expect(out.split('\n')[0]).toBe(`Wrote ${at('raiders.fugloy.json')}: 2 labels, 1 session`);
    expect(out).not.toContain('replaced');
    expect((await ok(call, 'label', { addr: '7030', name: 'PRINT' })).split('\n').at(-1)).toBe(`Wrote ${at('raiders.fugloy.json')}.`);
    expect(parseLabelFile(readFileSync(at('raiders.fugloy.json'), 'utf8')).file.sessions).toHaveLength(1);
    await close();
  });

  it('after load with reset: false of another program, export refuses and suggest says why', async () => {
    const { call, close } = await raidersPlayed();
    await ok(call, 'load', { path: at('chores.cmd'), reset: false });
    await ok(call, 'run', { until: 'halt' });
    expect((await call('coverage', { mode: 'export' })).text).toBe(
      "The coverage on this machine includes RAIDERS, loaded before CHORES with reset: false, so it is not CHORES's to export; load CHORES again with reset (the default), run it, then export.",
    );
    expect(existsSync(at('chores.fugloy.json'))).toBe(false);
    const note = "Note: CHORES was loaded with reset: false after RAIDERS, so the coverage since load includes RAIDERS's.";
    expect((await ok(call, 'suggest', {})).split('\n').at(-1)).toBe(note);
    expect(await ok(call, 'coverage', {})).toContain(note);
    // A fresh load clears it.
    await ok(call, 'load', { path: at('chores.cmd') });
    expect(await ok(call, 'suggest', {})).not.toContain('Note:');
    await close();
  });
});
