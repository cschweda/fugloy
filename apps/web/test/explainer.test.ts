import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseExplainer } from '../app/utils/explainer';
import { scopeCss } from '../app/utils/scope-css';

const source = readFileSync(fileURLToPath(new URL('../../../docs/technical-details/inside-fugloy.html', import.meta.url)), 'utf8');

describe('the Inside Fugløy explainer, as the technical details page hosts it', () => {
  const x = parseExplainer(source);

  it('splits into title, fonts, one stylesheet, markup and one script', () => {
    expect(x.title).toBe('Inside Fugløy');
    expect(x.stylesheets).toHaveLength(1);
    expect(x.stylesheets[0]).toMatch(/^https:\/\/fonts\.googleapis\.com\//);
    expect(x.css).toContain('--night');
    expect(x.markup).toMatch(/^<nav class="rail"/);
    expect(x.markup).not.toMatch(/<(?:script|style|title|link)\b/);
    expect(x.script).toContain("'use strict'");
  });

  it('scopes every rule: nothing it styles reaches outside the wrapper', () => {
    const scoped = scopeCss(x.css, '.fg-inside');
    // The prelude of every block: the text between the last `}`, `;` or `{` and the next `{`.
    const css = scoped.replace(/\/\*[\s\S]*?\*\//g, '');
    const preludes = css.split('{').slice(0, -1).map((seg) => seg.slice(Math.max(seg.lastIndexOf('}'), seg.lastIndexOf(';')) + 1).trim());
    const bare = preludes
      .filter((p) => !p.startsWith('@') && !/^(?:from|to|\d+%)$/.test(p))
      .flatMap((p) => p.split(','))
      .map((p) => p.trim())
      .filter((p) => !p.startsWith('.fg-inside'));
    expect(bare).toEqual([]);
    expect(scoped).not.toMatch(/(^|[},\s])(?:html|body|:root)\s*[,{]/);
  });

  it('shows the figures as of now, not phase 2', () => {
    expect(x.markup).not.toContain('<b>673</b>');
    expect(x.markup).toMatch(/<b>2,149<\/b><span>automated tests/);
  });
});
