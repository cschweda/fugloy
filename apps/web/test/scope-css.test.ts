import { describe, expect, it } from 'vitest';
import { scopeCss } from '../app/utils/scope-css';

const S = '.inside';

describe('scopeCss', () => {
  it('prefixes ordinary selectors, one by one in a list', () => {
    expect(scopeCss('a { color: red } h1, .x > p { margin: 0 }', S)).toBe('.inside a { color: red } .inside h1, .inside .x > p { margin: 0 }');
  });

  it('maps :root, html and body onto the wrapper itself, pseudo-elements included', () => {
    expect(scopeCss(':root { --a: 1 } html { x: y } body { z: w } body::before { content: "" }', S)).toBe('.inside { --a: 1 } .inside { x: y } .inside { z: w } .inside::before { content: "" }');
  });

  it('scopes the universal selector to the wrapper subtree', () => {
    expect(scopeCss('* { box-sizing: border-box } *::before { a: b }', S)).toBe('.inside * { box-sizing: border-box } .inside *::before { a: b }');
  });

  it('scopes inside @media and @supports, and leaves @keyframes and @font-face alone', () => {
    const css = '@media (max-width: 560px) { .a { b: c } } @keyframes k { from { opacity: 0 } to { opacity: 1 } } @font-face { font-family: X; src: url(x.woff2) }';
    expect(scopeCss(css, S)).toBe('@media (max-width: 560px) { .inside .a { b: c } } @keyframes k { from { opacity: 0 } to { opacity: 1 } } @font-face { font-family: X; src: url(x.woff2) }');
  });

  it('is not fooled by commas in :is() or :not(), comments, or braces in strings', () => {
    expect(scopeCss('/* a, b { } */ .x:not(.a, .b) { content: "}{" } :is(h2, h3) { c: d }', S)).toBe('/* a, b { } */ .inside .x:not(.a, .b) { content: "}{" } .inside :is(h2, h3) { c: d }');
  });
});
