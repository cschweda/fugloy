import { describe, expect, it } from 'vitest';
import { analysisSpace } from '../../src/analysis/relocate.js';
import { loadCmd } from '../../src/cmd.js';
import { emptyAnnotations } from '../../src/hints/apply.js';
import { renderPass1Listing } from '../../src/listing.js';
import { analyze } from '../../src/pipeline.js';
import { CMD_FIXTURES } from '../fixtures.js';
import { image } from '../images.js';

const PAYLOAD = [0xcd, 0x08, 0x50, 0x18, 0x02, 0x00, 0x00, 0xc9, 0x3e, 0x01, 0xc9];
const STUB = [0x21, 0x00, 0x80, 0x11, 0x00, 0x50, 0x01, 0x0b, 0x00, 0xed, 0xb0, 0xc3, 0x00, 0x50];
const img = () => image({ 0x8000: PAYLOAD, 0x8100: STUB });

describe('analysisSpace', () => {
  it('places each relocated source at its runtime address and maps addresses both ways', () => {
    const { space, errors } = analysisSpace(img(), [{ fileAddr: 0x8000, length: 11, runAddr: 0x5000 }]);
    expect(errors).toEqual([]);
    expect(space.image.runs()).toEqual([{ start: 0x5000, end: 0x500a, length: 11 }, { start: 0x8100, end: 0x810d, length: 14 }]);
    expect(Array.from(space.image.bytes.subarray(0x5000, 0x500b))).toEqual(PAYLOAD);
    expect([0x8000, 0x800a, 0x8100, 0x9000].map((a) => space.toRun(a))).toEqual([0x5000, 0x500a, 0x8100, null]);
    expect([0x5000, 0x8105, 0x8000].map((a) => space.toFile(a))).toEqual([0x8000, 0x8105, null]);
    expect(space.relocations).toEqual([{ fileAddr: 0x8000, length: 11, runAddr: 0x5000 }]);
  });

  it('allows a destination over its own source, as a move down by less than its length is', () => {
    const { space, errors } = analysisSpace(image({ 0x5200: new Array(0x100).fill(0x00), 0x6000: [0xc9] }), [{ fileAddr: 0x5200, length: 0x100, runAddr: 0x5180 }]);
    expect(errors).toEqual([]);
    expect(space.image.runs()).toEqual([{ start: 0x5180, end: 0x527f, length: 0x100 }, { start: 0x6000, end: 0x6000, length: 1 }]);
  });

  it('refuses a source that leaves its block, and a destination over loaded memory or another destination (Review Focus 5)', () => {
    const errorsFor = (r: { fileAddr: number; length: number; runAddr: number }[]) => analysisSpace(img(), r).errors;
    expect(errorsFor([{ fileAddr: 0x8005, length: 0x10, runAddr: 0x5000 }])).toEqual(['relocate at $8005: the source $8005-$8014 runs past the end of its block']);
    expect(errorsFor([{ fileAddr: 0x8000, length: 11, runAddr: 0x8105 }])).toEqual(['relocate at $8000: the destination $8105-$810F overlaps loaded memory at $8105']);
    expect(errorsFor([{ fileAddr: 0x8000, length: 4, runAddr: 0x5000 }, { fileAddr: 0x8004, length: 4, runAddr: 0x5002 }])).toEqual([
      'relocate at $8004: the destination $5002-$5005 overlaps the destination of the relocate at $8000',
    ]);
    expect(errorsFor([{ fileAddr: 0x8000, length: 11, runAddr: 0xfffa }])).toEqual(['relocate at $8000: the destination $FFFA plus 11 bytes runs past $FFFF']);
    const { space } = analysisSpace(img(), [{ fileAddr: 0x8000, length: 11, runAddr: 0x8105 }]);
    expect(space.relocations).toEqual([]);
    expect(space.image.runs()).toEqual(img().runs());
  });
});

describe('analyze with relocations built directly', () => {
  it('reports the relocations it refuses instead of dropping them silently', () => {
    const mod = loadCmd(CMD_FIXTURES['relocated-code']!());
    const relocations = [{ fileAddr: 0x8000, length: 11, runAddr: 0x8100 }]; // over the loader stub, which stays loaded
    const a = analyze(mod, { annotations: { ...emptyAnnotations(), relocations } });
    const { errors } = analysisSpace(mod.image, relocations);
    expect(errors).toHaveLength(1);
    expect(a.relocationErrors).toEqual(errors);
    expect(a.space.relocations).toEqual([]);
    expect(renderPass1Listing(a)).toContain(`; warning: ${errors[0]}`);
    expect(analyze(mod, { annotations: { ...emptyAnnotations(), relocations: [{ fileAddr: 0x8000, length: 11, runAddr: 0x5000 }] } }).relocationErrors).toEqual([]);
  });
});
