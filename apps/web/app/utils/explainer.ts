// Splits the Inside Fugløy explainer (docs/technical-details/inside-fugloy.html) into the parts the
// technical details page hosts. The source is a page fragment: a <title>, some <link>s for fonts, one
// <style>, the markup, and one <script>, with no <html>, <head> or <body>.
export interface Explainer {
  title: string;
  /** href of each stylesheet <link> (Google Fonts). */
  stylesheets: string[];
  /** href of each preconnect <link>. */
  preconnects: string[];
  css: string;
  markup: string;
  script: string;
}

export function parseExplainer(source: string): Explainer {
  const one = (re: RegExp, what: string): string => {
    const m = re.exec(source);
    if (m === null) throw new Error(`the explainer has no ${what}`);
    return m[1]!;
  };
  const links = [...source.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
  const hrefs = (rel: string): string[] => links.filter((l) => l.includes(`rel="${rel}"`)).map((l) => /href="([^"]*)"/.exec(l)![1]!);
  const css = one(/<style>([\s\S]*?)<\/style>/, '<style>');
  const script = one(/<script>([\s\S]*?)<\/script>\s*$/, 'closing <script>');
  const markup = source.slice(source.indexOf('</style>') + '</style>'.length, source.lastIndexOf('<script>')).trim();
  return { title: one(/<title>([^<]*)<\/title>/, '<title>'), stylesheets: hrefs('stylesheet'), preconnects: hrefs('preconnect'), css, markup, script };
}
