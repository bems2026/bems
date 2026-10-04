import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHIVE_REFRESH_MS, LONG_HISTORY_REFRESH_MS } from './supabaseHistory';

/**
 * RM-159 — the browser's share of the project's request budget, pinned.
 *
 * Every browser read of Supabase is a line in the project's log, and a CORS OPTIONS before it is a
 * second. A read on a TIMER multiplies that by every open screen, all day: the kiosk alone sent about
 * 2,300 lines a day from two five-minute polls nobody had counted. Free-plan log ingestion is 1 GB a
 * month. So each fetch below, called on a timer, asks the edge first; this reads the source because a
 * fetcher that quietly stops doing so is not a type error and survives a green suite.
 */

const SRC = join(process.cwd(), 'src');
const source = (file: string) => readFileSync(join(SRC, file), 'utf8');

/** The fetchers a timer calls, and the edge reader each must try first. */
const TIMER_FETCHERS: Array<[file: string, edgeReader: string]> = [
  ['lib/supabaseAnomalies.ts', 'edgeRecentAnomalies'], // the bell, every minute (RM-158)
  ['lib/supabaseCapabilityHistory.ts', 'edgeTroubleRows'], // trouble episodes, every five minutes
  ['lib/deviceConnectivity.ts', 'edgeConnectivity'], // the flapping badge, every five minutes
  ['lib/supabaseHistory.ts', 'edgeBuckets'], // the Analytics week, every five minutes while open
];

describe('timer-driven reads ask the edge first', () => {
  for (const [file, edgeReader] of TIMER_FETCHERS) {
    it(`${file} calls ${edgeReader}`, () => {
      expect(source(file)).toMatch(new RegExp(`await ${edgeReader}\\(`));
    });
  }

  it('the reads that still go to the cloud on a timer (30 days, a year) refresh at most hourly', () => {
    expect(ARCHIVE_REFRESH_MS).toBeGreaterThanOrEqual(60 * 60_000);
    // The week reads the edge, so its five minutes cost the project nothing while the edge answers.
    expect(LONG_HISTORY_REFRESH_MS).toBe(5 * 60_000);
  });
});
