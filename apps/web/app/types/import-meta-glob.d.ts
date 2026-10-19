// Vite's `import.meta.glob`, in the lazy form the Learn page's lessons use (utils/learn/lessons.ts:
// one chunk per lesson or chapter, loaded on its page). Nuxt's generated tsconfig does not load
// vite/client's types, so the form used is declared here.
interface ImportMeta {
  glob<T = unknown>(pattern: string | string[], options: { eager?: false; query?: string; import?: string }): Record<string, () => Promise<T>>;
}
