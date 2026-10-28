import { describe, expect, it } from 'vitest';
import { linkNotice, parseEdgeStatus, CATCHING_UP_ABOVE } from './edgeLink';

const body = {
  state: 'offline', waiting: 566184, last_upload_ok_at: '2026-10-15T01:00:00.000Z', last_upload_fail_at: '2026-10-28T02:30:00.000Z',
  frozen: [{ device_id: 'mtr_arec_acu', frozen_since: '2026-10-14T13:22:01+08:00' }, { device_id: 7 }],
};

describe('parseEdgeStatus', () => {
  it('reads the edge status, dropping malformed freezes', () => {
    expect(parseEdgeStatus(body)).toEqual({
      state: 'offline', waiting: 566184, lastUploadOkAt: '2026-10-15T01:00:00.000Z', lastUploadFailAt: '2026-10-28T02:30:00.000Z',
      frozen: [{ deviceId: 'mtr_arec_acu', frozenSince: '2026-10-14T13:22:01+08:00' }],
    });
  });

  it('refuses a body that is not a status', () => {
    expect(parseEdgeStatus(null)).toBeNull();
    expect(parseEdgeStatus({ state: 'fine' })).toBeNull();
  });
});

describe('linkNotice', () => {
  it('says the site has no internet, what waits, and that the meters hold until it returns', () => {
    const n = linkNotice(parseEdgeStatus(body));
    expect(n?.kind).toBe('offline');
    expect(n?.severity).toBe('warning');
    expect(n?.chip).toBe('Offline logging');
    expect(n?.body).toContain('566,184 readings wait to upload');
    expect(n?.body).toMatch(/hold their last reading until the internet returns/);
    expect(n?.stamp).toBe('2026-10-15T01:00:00.000Z');
  });

  it('says it is catching up while far behind after the internet returns, and nothing once caught up', () => {
    const back = parseEdgeStatus({ ...body, state: 'online', waiting: 205_799 });
    expect(linkNotice(back)?.kind).toBe('catching-up');
    expect(linkNotice(back)?.chip).toBe('Syncing 205,799');
    expect(linkNotice(parseEdgeStatus({ ...body, state: 'online', waiting: CATCHING_UP_ABOVE }))).toBeNull();
  });

  it('says nothing when the status is unknown or absent, and notes a pause', () => {
    expect(linkNotice(parseEdgeStatus({ state: 'unknown' }))).toBeNull();
    expect(linkNotice(null)).toBeNull();
    expect(linkNotice(parseEdgeStatus({ ...body, state: 'paused' }))?.kind).toBe('paused');
  });
});
