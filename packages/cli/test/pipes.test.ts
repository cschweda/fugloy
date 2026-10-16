import { expect, it } from 'vitest';
import { readerGone } from '../src/pipes.js';

const error = (code?: string): NodeJS.ErrnoException => Object.assign(new Error('write failed'), code === undefined ? {} : { code });

it('counts every way a pipe reports its reader gone, macOS socket-pair stdio included', () => {
  for (const code of ['EPIPE', 'ENOTCONN', 'ECONNRESET', 'ERR_STREAM_DESTROYED']) expect(readerGone(error(code)), code).toBe(true);
});

it('leaves other write errors alone, so they still surface', () => {
  for (const code of ['EACCES', 'ENOSPC', undefined]) expect(readerGone(error(code)), String(code)).toBe(false);
});
