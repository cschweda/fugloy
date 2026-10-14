import { describe, expect, it } from 'vitest';
import { detokenize } from '../src/detokenize.js';

const d = (...bytes: number[]) => detokenize(Uint8Array.from(bytes));

describe('detokenize', () => {
  it('expands tokens and keeps text and spaces as stored', () => {
    expect(d(0xb2, 0x22, 0x48, 0x49, 0x22, 0x00)).toEqual({ text: 'PRINT"HI"', ok: true });
    expect(d(0x81, 0x20, 0x49, 0xd5, 0x31, 0x20, 0xbd, 0x20, 0x31, 0x30, 0x00)).toEqual({ text: 'FOR I=1 TO 10', ok: true });
  });

  it('copies everything after REM literally', () => {
    expect(d(0x93, 0x20, 0x46, 0x4f, 0x52, 0x00).text).toBe('REM FOR');
    expect(d(0x93, 0x20, 0x81, 0x00).text).toBe('REM {81}');
  });

  it('hides the :REM behind a remark apostrophe and accepts a bare apostrophe token', () => {
    expect(d(0x3a, 0x93, 0xfb, 0x20, 0x47, 0x4f, 0x54, 0x4f, 0x00).text).toBe("' GOTO");
    expect(d(0xfb, 0x20, 0x48, 0x49, 0x00).text).toBe("' HI");
  });

  it('hides the colon stored before ELSE', () => {
    expect(d(0x8f, 0x20, 0x41, 0x20, 0xca, 0x20, 0x31, 0x20, 0x3a, 0x95, 0x20, 0x32, 0x00).text).toBe('IF A THEN 1 ELSE 2');
  });

  it('copies DATA items literally up to the next colon, tracking quotes', () => {
    expect(d(0x88, 0x20, 0x46, 0x4f, 0x52, 0x2c, 0x31, 0x3a, 0xb2, 0x00).text).toBe('DATA FOR,1:PRINT');
    expect(d(0x88, 0x20, 0x22, 0x41, 0x3a, 0x42, 0x22, 0x2c, 0x46, 0x4f, 0x52, 0x3a, 0x80, 0x00).text).toBe('DATA "A:B",FOR:END');
  });

  it('escapes non-printable bytes inside strings instead of reading them as tokens', () => {
    expect(d(0xb2, 0x22, 0x46, 0x4f, 0x52, 0x80, 0x0d, 0x22, 0x00)).toEqual({ text: 'PRINT"FOR{80}{0D}"', ok: true });
  });

  it('rejects FC..FF outside literals as invalid tokens', () => {
    expect(d(0xb2, 0xfc, 0x41, 0x00)).toEqual({ text: 'PRINT{FC}A', ok: false, reason: 'invalid token FCH at +1' });
    expect(d(0x22, 0xfc, 0x22, 0x00).ok).toBe(true);
  });

  it('rejects control bytes outside literals', () => {
    expect(d(0x01, 0x41, 0x00)).toEqual({ text: '{01}A', ok: false, reason: 'control byte 01H at +0' });
  });

  it('rejects an embedded 00 before the terminator', () => {
    expect(d(0xc3, 0x00, 0x00, 0xc9, 0x00, 0x3e, 0x00)).toMatchObject({ ok: false, reason: 'embedded 00 at +1' });
  });

  it('rejects a body with no terminator', () => {
    expect(d(0xb2, 0x41)).toEqual({ text: 'PRINTA', ok: false, reason: 'no 00 terminator' });
    expect(d()).toEqual({ text: '', ok: false, reason: 'no 00 terminator' });
  });
});
