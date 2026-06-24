import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

// Vitest 4 re-exports expectation types, so jest-dom's vitest augmentation
// needs to cover both public module paths used by TypeScript.
declare module "vitest" {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}

declare module "@vitest/expect" {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
