// The test type check runs plain tsc, which cannot read .vue files; Nuxt's
// `nuxt typecheck` (vue-tsc) checks the components themselves.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
