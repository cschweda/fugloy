# Inside Fugløy

`inside-fugloy.html` is the source of the interactive explainer of how Fugløy
works and how it was built, written for curious students and retro
enthusiasts. It was first published as a claude.ai artifact; phase 4's web
workbench hosts it as its "technical details" page.

The file is a page fragment: its `<title>`, `<style>`, markup, and `<script>`,
without `<!doctype>`, `<html>`, `<head>`, or `<body>`, which the host wraps
around it. It is self-contained apart from Google Fonts, and its numbers
(tests, samples, coverage) and sample output are as of phase 4 (2,149 tests,
83 real programs); update them when they change. The site's technical details
page hosts it: the `<style>` is scoped to a wrapper (`apps/web/app/utils/scope-css.ts`),
so keep rules to class and element selectors and do not rely on `html` or
`body` being the page.

Smooth anchor scrolling comes from the host page (the explainer's `html`
rule cannot reach the real `html`); `overflow-x: clip` on `body` keeps its
sticky section rail working.
