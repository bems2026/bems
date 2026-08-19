import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement ResizeObserver (used by TopNav's useNavHeight, via AppShell in
// every component test that renders it) — every real browser this app targets does, so
// this is a test-environment gap, not a production guard. A no-op stub is enough: nothing
// under test asserts on the live-measured --nav-h-live value itself.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom's global has no ResizeObserver type to match against
(globalThis as any).ResizeObserver ??= ResizeObserverStub;
