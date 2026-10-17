// Vite's `?url` imports: the built asset's address (used for pdf.js's worker).
declare module '*?url' {
  const src: string;
  export default src;
}

// Vite's `?raw` imports: the file's text (the Inside Fugløy explainer's source).
declare module '*?raw' {
  const text: string;
  export default text;
}
