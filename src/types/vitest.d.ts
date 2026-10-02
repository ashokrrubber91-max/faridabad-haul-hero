declare module "vitest" {
  type TestFn = (name: string, fn: () => unknown | Promise<unknown>, timeout?: number) => unknown;
  export const describe: (name: string, fn: () => unknown) => unknown;
  export const it: TestFn;
  export const test: TestFn;
  export const expect: (value: unknown) => any;
  export const beforeEach: (fn: () => unknown | Promise<unknown>) => unknown;
  export const afterEach: (fn: () => unknown | Promise<unknown>) => unknown;
  export const beforeAll: (fn: () => unknown | Promise<unknown>) => unknown;
  export const afterAll: (fn: () => unknown | Promise<unknown>) => unknown;
  export const vi: any;
  export function defineConfig<T>(config: T): T;
}
