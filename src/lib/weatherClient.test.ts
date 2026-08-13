import { describe, it, expect, vi, afterEach } from 'vitest';
import { getWeather, weatherLabel, weatherGlyph } from './weatherClient';

const RESPONSE = {
  current: {
    temperature_2m: 25.6,
    relative_humidity_2m: 93,
    apparent_temperature: 29.3,
    is_day: 0,
    weather_code: 3,
    surface_pressure: 1004.3,
    wind_speed_10m: 4.9,
  },
  hourly: {
    time: ['2026-08-12T22:00', '2026-08-12T23:00', '2026-08-13T00:00'],
    temperature_2m: [26, 25.8, 25.5],
    weather_code: [3, 3, 61],
    is_day: [0, 0, 0],
  },
  daily: {
    time: ['2026-08-12', '2026-08-13'],
    weather_code: [3, 61],
    temperature_2m_max: [29.6, 30.1],
    temperature_2m_min: [25.5, 25.9],
    sunrise: ['2026-08-12T05:39'],
    sunset: ['2026-08-12T18:14'],
  },
};

const mockFetch = (body: unknown, ok = true) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: async () => body }));
};

afterEach(() => vi.unstubAllGlobals());

describe('getWeather', () => {
  it('normalises the current block', async () => {
    vi.setSystemTime(new Date('2026-08-12T22:10:00'));
    mockFetch(RESPONSE);
    const w = await getWeather();
    expect(w.tempC).toBe(25.6);
    expect(w.humidityPct).toBe(93);
    expect(w.windMs).toBe(4.9);
    expect(w.isDay).toBe(false);
  });

  /*
   * The reason `parseSiteTime` exists: `Date.parse('2026-08-12')` is UTC per spec while
   * `Date.parse('2026-08-12T00:00')` is local, so a bare date would land on the wrong
   * calendar day for any browser behind UTC and mislabel the whole daily strip.
   */
  it('parses bare daily dates as local midnight, not UTC', async () => {
    vi.setSystemTime(new Date('2026-08-12T22:10:00'));
    mockFetch(RESPONSE);
    const w = await getWeather();
    const first = new Date(w.daily[0].t);
    expect(first.getHours()).toBe(0);
    expect(first.getDate()).toBe(12);
  });

  it('drops hours already in the past so the strip starts at now', async () => {
    vi.setSystemTime(new Date('2026-08-12T23:30:00'));
    mockFetch(RESPONSE);
    const w = await getWeather();
    // 22:00 is more than an hour old at 23:30; 23:00 and 00:00 survive.
    expect(w.hourly).toHaveLength(2);
    expect(new Date(w.hourly[0].t).getHours()).toBe(23);
  });

  it('rejects a response with no current conditions rather than returning zeroes', async () => {
    mockFetch({ current: {} });
    await expect(getWeather()).rejects.toThrow(/missing current conditions/);
  });

  it('rejects a non-ok response', async () => {
    mockFetch({}, false);
    await expect(getWeather()).rejects.toThrow(/weather 503/);
  });

  it('rejects instead of hanging forever when the request never settles', async () => {
    // A dropped connection (captive portal, silent firewall) neither resolves nor rejects on
    // its own — `fetch` here mimics that by returning a promise nothing ever settles, and
    // only the internal timeout can end it. Without the timeout in `getWeather`, this test
    // would hang until vitest's own test timeout fails it, rather than getWeather's promise
    // rejecting on a schedule `useWeather` can rely on.
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }),
    );

    const pending = getWeather();
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    vi.useRealTimers();
  });

  it('leaves an absent optional field as NaN so the UI can show a dash', async () => {
    vi.setSystemTime(new Date('2026-08-12T22:10:00'));
    mockFetch({ ...RESPONSE, current: { temperature_2m: 25.6 } });
    const w = await getWeather();
    expect(Number.isNaN(w.humidityPct)).toBe(true);
    expect(Number.isNaN(w.windMs)).toBe(true);
  });
});

describe('WMO code mapping', () => {
  it('labels the codes this site actually sees', () => {
    expect(weatherLabel(0)).toBe('Clear');
    expect(weatherLabel(3)).toBe('Overcast');
    expect(weatherLabel(61)).toBe('Rain');
    expect(weatherLabel(95)).toBe('Thunderstorm');
  });

  it('never leaves a code unmapped', () => {
    for (let code = 0; code <= 99; code++) {
      expect(weatherGlyph(code)).toBeTruthy();
      expect(typeof weatherLabel(code)).toBe('string');
    }
  });

  it('keeps label and glyph consistent for the rain family', () => {
    expect(weatherGlyph(61)).toBe('rain');
    expect(weatherGlyph(80)).toBe('rain');
    expect(weatherGlyph(2)).toBe('partly');
  });
});
