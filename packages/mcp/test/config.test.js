import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, loadConfig } from '../src/config.js';

let root;
let cwd;
let home;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fugloy-mcp-config-'));
  cwd = join(root, 'work');
  home = join(root, 'home');
  mkdirSync(cwd);
  mkdirSync(join(home, '.config', 'fugloy'), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Write `value` (an object, or raw text) as JSON at `path`. */
function write(path, value) {
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  return path;
}

describe('loadConfig', () => {
  it('loadConfig follows FUGLOY_CONFIG, then cwd, then ~/.config', () => {
    const inHome = write(join(home, '.config', 'fugloy', 'fugloy.mcp.json'), { roms: { model3: 'home.rom' } });
    expect(loadConfig({ cwd, env: {}, home })).toMatchObject({ source: inHome, roms: { model3: join(home, '.config', 'fugloy', 'home.rom') } });

    const inCwd = write(join(cwd, 'fugloy.mcp.json'), { roms: { model3: './roms/cwd.rom' } });
    expect(loadConfig({ cwd, env: {}, home })).toMatchObject({ source: inCwd, roms: { model3: join(cwd, 'roms', 'cwd.rom') } });

    mkdirSync(join(root, 'elsewhere'));
    const named = write(join(root, 'elsewhere', 'mine.json'), { roms: { model3: '../m3.rom' } });
    expect(loadConfig({ cwd, env: { FUGLOY_CONFIG: named }, home })).toMatchObject({ source: named, roms: { model3: join(root, 'm3.rom') } });

    // A relative FUGLOY_CONFIG is relative to the working directory.
    expect(loadConfig({ cwd: root, env: { FUGLOY_CONFIG: 'elsewhere/mine.json' }, home }).source).toBe(named);
  });

  it('falls back to the defaults when there is no config file', () => {
    expect(loadConfig({ cwd, env: {}, home })).toEqual({ roms: {}, defaultModel: 3, limits: DEFAULT_LIMITS, source: null });
    expect(DEFAULT_LIMITS).toEqual({
      runSecondsEmulated: 10, runSecondsWall: 5, outputBytes: 8192, traceDepth: 2000, stepMax: 100, peekMax: 1024,
    });
  });

  it('merges limits over the defaults and resolves fixtures against the file', () => {
    const path = write(join(cwd, 'fugloy.mcp.json'), { fixtures: './fixtures/real', limits: { outputBytes: 4096, traceDepth: 500 } });
    const config = loadConfig({ cwd, env: {}, home });
    expect(config.source).toBe(path);
    expect(config.fixtures).toBe(join(cwd, 'fixtures', 'real'));
    expect(config.limits).toEqual({ ...DEFAULT_LIMITS, outputBytes: 4096, traceDepth: 500 });
  });

  it('reads the repository example file', () => {
    const example = new URL('../../../fugloy.mcp.example.json', import.meta.url).pathname;
    const config = loadConfig({ cwd, env: { FUGLOY_CONFIG: example }, home });
    expect(config.defaultModel).toBe(3);
    expect(config.roms.model3).toMatch(/fixtures\/real\/model3\.rom$/);
  });
});

describe('config errors', () => {
  /** The message loadConfig throws for a cwd config holding `text`. */
  function failure(text) {
    write(join(cwd, 'fugloy.mcp.json'), text);
    try {
      loadConfig({ cwd, env: {}, home });
    } catch (err) {
      return /** @type {Error} */ (err).message;
    }
    throw new Error('loadConfig accepted a malformed file');
  }

  it('a malformed config is a sentence, not a stack', () => {
    const path = join(cwd, 'fugloy.mcp.json');
    const cases = [
      ['{ "roms": ', /is not valid JSON/],
      ['[1, 2]', /must hold a JSON object/],
      ['{ "roms": { "model3": 7 } }', /roms\.model3 must be a path/],
      ['{ "defaultModel": 1 }', /emu phase 6/],
      ['{ "limits": { "outputByte": 10 } }', /outputByte is not a limit/],
      ['{ "limits": { "stepMax": "100" } }', /limits\.stepMax must be a positive number/],
      ['{ "fixtures": false }', /fixtures must be a path/],
    ];
    for (const [text, pattern] of cases) {
      const message = failure(text);
      expect(message).toMatch(pattern);
      expect(message).toContain(path);
      expect(message).not.toMatch(/\n\s+at /);
      expect(message).toMatch(/\.$/);
    }
  });

  it('a FUGLOY_CONFIG naming no file is an error, not a fallback', () => {
    write(join(cwd, 'fugloy.mcp.json'), {});
    const missing = join(root, 'nope.json');
    expect(() => loadConfig({ cwd, env: { FUGLOY_CONFIG: missing }, home })).toThrow(`FUGLOY_CONFIG names ${missing}, and there is no such file.`);
  });
});
