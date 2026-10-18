# Images

- `og-image.svg`: the social card (1200x630). Its text is outlined glyphs, so it renders the same
  everywhere. `og-image.png` is rendered from it; the site serves that PNG, and the README shows the SVG.
- Favicons (`apps/web/public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png`) are cut from the card's
  o-slash tile.

## Regenerating the card's listing from real output

The listing on the right of the card is real `fugloy` output for a tiny Model III program (a screen clear and
a key wait), not hand-typed. After the disassembler's output changes (new names, new formatting):

```
pnpm --filter @fugloy/web outline-card-text   # runs the CLI, rewrites the listing block and glyphs in og-image.svg
pnpm --filter @fugloy/web render-brand        # re-renders og-image.png and the favicons (Playwright, Chromium)
```

Then look at `og-image.png`: a listing row wider than the panel throws no error, it just runs off the edge.
The script needs the dev dependencies `opentype.js` and `@fontsource/jetbrains-mono` (the card's font).

## Changing the card's words

The formats line under the TRS-80 line, the tagline, the green line of verbs, the footer's list of parts, and
the SVG's `<title>` and `<desc>` come from `WORDS`, `TITLE` and `DESC` at the top of
`apps/web/scripts/outline-card-words.ts`. Edit them, then:

```
pnpm --filter @fugloy/web outline-card-words  # outlines each line into its <g id="card-..."> group in og-image.svg
pnpm --filter @fugloy/web render-brand        # re-renders og-image.png and the favicons
```

The script stops if a line would run into the listing panel or `fugloy.dev`; still look at the PNG. It needs
`@fontsource/inter` (the tagline) and `@fontsource/jetbrains-mono`. The wordmark, the o-slash tile, the
TRS-80 line and `fugloy.dev` are not regenerated; edit the SVG by hand for those, and leave the tile alone
unless the favicons should change too. When the words change, update the card's alt text to match: the
README's `<img alt>` and `CARD_ALT` in `apps/web/app/composables/usePageSeo.ts`.

The card's text is outlined from Inter (copyright The Inter Project Authors), used under the SIL Open Font License 1.1: https://github.com/rsms/inter, and JetBrains Mono (copyright The JetBrains Mono Project Authors), used under the SIL Open Font License 1.1: https://github.com/JetBrains/JetBrainsMono
