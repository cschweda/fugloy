// SEO of the generated site: every page has its own title, description, canonical URL on
// app.fugloy.dev, an absolute Open Graph image with alt text, and a Twitter summary card;
// the home page has JSON-LD; sitemap.xml lists the four pages and robots.txt names it.
// Reads .output/public, so it runs after `pnpm --filter @fugloy/web generate` (`pnpm run test:seo`
// does both); it is skipped, loudly, when the site has not been generated.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '.output', 'public');
const built = existsSync(join(out, 'index.html'));
if (!built) console.warn('seo.test: .output/public is missing; run `pnpm --filter @fugloy/web generate` first. Skipping.');

const ORIGIN = 'https://app.fugloy.dev';
const PAGES = [
  { path: '/', file: 'index.html', title: 'Fugløy — TRS-80 disassembler workbench' },
  { path: '/technical-details', file: 'technical-details/index.html', title: 'Technical details · Fugløy' },
  { path: '/manuals', file: 'manuals/index.html', title: 'Manuals · Fugløy' },
  { path: '/about', file: 'about/index.html', title: 'About · Fugløy' },
];

const read = (f: string): string => readFileSync(join(out, f), 'utf8');
/** The content of the first <meta> whose `key` attribute (name or property) is `value`. */
function meta(html: string, key: 'name' | 'property', value: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/g) ?? []) {
    if (!new RegExp(`\\b${key}="${value}"`).test(tag)) continue;
    return /\bcontent="([^"]*)"/.exec(tag)?.[1]?.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  }
  return undefined;
}
const metas = (html: string, key: 'name' | 'property', value: string): number =>
  (html.match(/<meta\b[^>]*>/g) ?? []).filter((t) => new RegExp(`\\b${key}="${value}"`).test(t)).length;

describe.skipIf(!built)('SEO of the generated pages', () => {
  const titles = PAGES.map((p) => /<title>([^<]*)<\/title>/.exec(read(p.file))?.[1]);

  it('gives every page its own title', () => {
    expect(titles).toEqual(PAGES.map((p) => p.title));
    expect(new Set(titles).size).toBe(PAGES.length);
  });

  for (const p of PAGES) {
    describe(p.path, () => {
      const html = (): string => read(p.file);

      it('has exactly one description, and og:title and og:description that match the page', () => {
        expect(metas(html(), 'name', 'description')).toBe(1);
        const d = meta(html(), 'name', 'description');
        expect(d !== undefined && d.length >= 50 && d.length <= 200).toBe(true);
        expect(meta(html(), 'property', 'og:description')).toBe(d);
        expect(meta(html(), 'property', 'og:title')).toBe(p.title);
      });

      it('has a canonical link and og:url on app.fugloy.dev', () => {
        const url = ORIGIN + (p.path === '/' ? '/' : p.path);
        expect(html()).toContain(`<link rel="canonical" href="${url}"`);
        expect(meta(html(), 'property', 'og:url')).toBe(url);
        expect(meta(html(), 'property', 'og:type')).toBe('website');
      });

      it('has an absolute og:image of 1200x630 with alt text, and a summary_large_image Twitter card', () => {
        expect(meta(html(), 'property', 'og:image')).toBe(`${ORIGIN}/og-image.png`);
        expect(meta(html(), 'property', 'og:image:width')).toBe('1200');
        expect(meta(html(), 'property', 'og:image:height')).toBe('630');
        const alt = meta(html(), 'property', 'og:image:alt');
        expect(alt !== undefined && alt.length > 20).toBe(true);
        expect(meta(html(), 'name', 'twitter:card')).toBe('summary_large_image');
        expect(meta(html(), 'name', 'twitter:image')).toBe(`${ORIGIN}/og-image.png`);
        expect(meta(html(), 'name', 'twitter:image:alt')).toBe(alt);
      });

      it('links the favicons', () => {
        expect(html()).toMatch(/<link[^>]*rel="icon"[^>]*href="\/favicon\.svg"/);
        expect(html()).toMatch(/<link[^>]*rel="icon"[^>]*href="\/favicon\.ico"/);
        expect(html()).toMatch(/<link[^>]*rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/);
      });
    });
  }

  it('puts parseable SoftwareApplication JSON-LD on the home page only', () => {
    const blocks = [...read('index.html').matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    expect(blocks).toHaveLength(1);
    const ld = JSON.parse(blocks[0]![1]!) as Record<string, unknown>;
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.name).toBe('Fugløy');
    expect(ld.applicationCategory).toBe('DeveloperApplication');
    expect(ld.operatingSystem).toBe('Any (web browser)');
    expect(ld.url).toBe(`${ORIGIN}/`);
    expect(ld.offers).toMatchObject({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
    expect(String(ld.license)).toMatch(/MIT/);
    for (const p of PAGES.slice(1)) expect(read(p.file)).not.toContain('application/ld+json');
  });

  it('ships the social card and favicons', () => {
    for (const f of ['og-image.png', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) expect(existsSync(join(out, f))).toBe(true);
    const png = readFileSync(join(out, 'og-image.png'));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it('lists the four pages in sitemap.xml, and robots.txt allows all and names it', () => {
    const sitemap = read('sitemap.xml');
    const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${ORIGIN}/`, `${ORIGIN}/technical-details`, `${ORIGIN}/manuals`, `${ORIGIN}/about`]);
    const robots = read('robots.txt');
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).not.toMatch(/^Disallow: ./m);
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });
});
