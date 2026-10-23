import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, exampleById } from '../app/data/examples';

const repo = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('the examples manifest', () => {
  it('lists the four public-domain games, Sea Dragon first', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual(['sea-dragon', 'rear-guard', 'eliminator', 'armored-patrol']);
    expect(exampleById('armored-patrol').mainBuild).toBe('ARMOUR.III');
  });

  it('opens Sea Dragon as seadrg01.cmd with its committed hints', () => {
    const sea = exampleById('sea-dragon');
    expect(sea.mainBuild).toBe('seadrg01.cmd');
    expect(sea.hints).toBe('seadrg01.hints');
  });

  it("opens Eliminator as elimin8d.cmd, and Programs to try runs elimin8a.cmd, which the site serves under /examples/eliminator/", () => {
    const e = exampleById('eliminator');
    expect(e.mainBuild).toBe('elimin8d.cmd');
    expect(e.tryBuild).toBe('elimin8a.cmd');
    // prepare-assets (run before the tests) copies examples/<id>/ to public/examples/<id>/, served at /examples/<id>/.
    expect(existsSync(fileURLToPath(new URL('../public/examples/eliminator/elimin8a.cmd', import.meta.url)))).toBe(true);
    expect(EXAMPLES.filter((x) => x.tryBuild !== undefined).map((x) => x.id)).toEqual(['eliminator']);
  });

  for (const e of EXAMPLES) {
    describe(e.title, () => {
      it('names builds and a hint file that exist under examples/', () => {
        expect(e.builds).toContain(e.mainBuild);
        expect(e.builds[0]).toBe(e.mainBuild);
        if (e.tryBuild !== undefined) expect(e.builds).toContain(e.tryBuild);
        for (const b of e.builds) expect(existsSync(repo(`examples/${e.id}/${b}`)), b).toBe(true);
        if (e.hints !== undefined) expect(existsSync(repo(`examples/${e.id}/${e.hints}`)), e.hints).toBe(true);
      });

      it('carries its README public-domain quote and source link verbatim', () => {
        const readme = readFileSync(repo(`examples/${e.id}/README.md`), 'utf8');
        const quote = /"(I hereby release[^"]+)"/.exec(readme)?.[1];
        expect(quote, 'README has the quote').toBeDefined();
        expect(squash(e.rightsQuote)).toContain(squash(quote!));
        expect(readme).toContain(`(${e.rightsUrl})`);
      });
    });
  }
});
