import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/index.js';
import type { Io } from '../src/index.js';
import { programHash } from '@fugloy/disasm';
import { SAMPLE_LABELS_PATH, sampleCmd, sampleLabelText } from '../../disasm/test/label-sample.js';

function capture(): { io: Io; out: string[]; err: string[]; files: Map<string, string> } {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>();
  const io: Io = {
    stdout: (s) => { out.push(s); },
    stderr: (s) => { err.push(s); },
    readFile: async (path) => (files.has(path) ? new TextEncoder().encode(files.get(path)!) : new Uint8Array(await readFile(path))),
    writeFile: async (path, text) => { files.set(path, text); },
    fileExists: async (path) => files.has(path),
  };
  return { io, out, err, files };
}

describe('--labels', () => {
  let cmd = '';
  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fugloy-labels-'));
    cmd = join(dir, 'sample.cmd');
    await writeFile(cmd, sampleCmd());
  });

  it('--labels applies and prints the header line', async () => {
    const { io, out, err } = capture();
    expect(await run([cmd, '--labels', SAMPLE_LABELS_PATH], io)).toBe(0);
    expect(err).toEqual([]);
    const text = out.join('');
    expect(text).toContain('; labels: sample.labels.json: 3 names, 16 roots, 1 data run applied\n');
    expect(text).toMatch(/^BUMP:/m);
    expect(text).toContain('; observed: called 3× from 1 site');
    // The IR carries the summary.
    const ir = capture();
    expect(await run([cmd, '--labels', SAMPLE_LABELS_PATH, '--format', 'ir'], ir.io)).toBe(0);
    expect((JSON.parse(ir.out.join('')) as { labels: unknown }).labels).toEqual({ source: 'sample.labels.json', names: 3, roots: 16, dataRuns: 1, warnings: [] });
  });

  it('--labels with --sweep is refused', async () => {
    const { io, out, err } = capture();
    expect(await run([cmd, '--labels', SAMPLE_LABELS_PATH, '--sweep'], io)).toBe(2);
    expect(out).toEqual([]);
    expect(err.join('')).toBe('fugloy: --labels has no effect with --sweep; drop one of them\n');
  });

  it('a refused file exits 2', async () => {
    const { io, out, err, files } = capture();
    files.set('/virtual/other.labels.json', sampleLabelText().replace(programHash(sampleCmd()), 'f'.repeat(64)));
    expect(await run([cmd, '--labels', '/virtual/other.labels.json'], io)).toBe(2);
    expect(out).toEqual([]);
    expect(err.join('')).toBe(
      `fugloy: /virtual/other.labels.json: the label file was written for another program (its sha256 is ${'f'.repeat(64)}, this program's is ${programHash(sampleCmd())}); nothing applied\n`,
    );
    // A file that does not parse exits 2 the same way, one line per problem.
    const broken = capture();
    broken.files.set('/virtual/bad.labels.json', '{"fugloy": 2}');
    expect(await run([cmd, '--labels', '/virtual/bad.labels.json'], broken.io)).toBe(2);
    expect(broken.err.join('')).toBe('fugloy: /virtual/bad.labels.json: fugloy is format version 2; this reader knows version 1\n');
  });
});
