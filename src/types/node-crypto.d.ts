/**
 * Ambient declaration for the single Node builtin the test suite imports.
 *
 * `@types/node` is deliberately not a dependency of this project (see
 * `tsconfig.json`, which types only the browser bundle), so the one
 * `node:crypto` import in `src/__tests__/tenantWorker.test.ts` needs a
 * declaration. The Workers runtime and Node 18 both provide
 * `crypto.subtle`; this only supplies the type for it.
 */
declare module 'node:crypto' {
  export const webcrypto: Crypto;
}