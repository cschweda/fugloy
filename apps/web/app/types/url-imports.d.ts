// Vite's `?url` imports: the built asset's address (used for pdf.js's worker).
declare module '*?url' {
  const src: string;
  export default src;
}
