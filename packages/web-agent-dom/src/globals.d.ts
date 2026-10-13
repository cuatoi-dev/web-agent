// Ambient declarations for globals this package reads.
//
// `__TINY_BUDGETS__` is a test-only switch. When it is set, `walkFromRoot`
// uses tiny depth/subtree/node budgets so a test can force the truncation
// path without building a large DOM. It is never set in production.
declare global {
  interface Window {
    __TINY_BUDGETS__?: boolean;
  }
}

export {};
