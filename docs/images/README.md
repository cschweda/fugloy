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
The tagline, wordmark and footer are not regenerated; edit the SVG by hand for those.

The card's text is outlined from JetBrains Mono (copyright The JetBrains Mono Project Authors), used under the SIL Open Font License 1.1: https://github.com/JetBrains/JetBrainsMono
