import { describe, it, expect, vi, beforeEach } from 'vitest';
import { importCredentials } from './credentials';

const bridge = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('./bridgeClient', () => ({ fetchJson: bridge.fetchJson }));

describe('importCredentials', () => {
  // Braces matter: a function RETURNED from beforeEach is run as the test's teardown, and mockReset
  // returns the mock — which would then be called once more after each test, rejecting.
  beforeEach(() => {
    bridge.fetchJson.mockReset();
  });

  it('posts the export text and the complete flag to the proxy, by bare path', async () => {
    bridge.fetchJson.mockResolvedValue({ ok: true, format: 'json', added: 2, updated: 0, total: 2, complete: true, problems: [] });
    const r = await importCredentials('[{"id":"a"}]', true);
    expect(bridge.fetchJson).toHaveBeenCalledWith('/credentials/import', { method: 'POST', body: { content: '[{"id":"a"}]', complete: true } });
    expect(r.added).toBe(2);
  });

  it('resolves a refusal to a result with the reason, rather than throwing', async () => {
    bridge.fetchJson.mockRejectedValue(new Error('HTTP 422: not a recognised export — expected tinytuya devices.json'));
    const r = await importCredentials('hello', false);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/not a recognised export/);
    expect(r.problems[0]).not.toMatch(/^HTTP/);
  });
});
