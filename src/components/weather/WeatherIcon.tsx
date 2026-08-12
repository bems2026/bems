import { Sun, Moon, CloudSun, CloudMoon, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning, type LucideIcon } from 'lucide-react';
import { weatherGlyph, type WeatherGlyph } from '@/lib/weatherClient';

/**
 * One WMO code → one line-art icon, day/night aware. lucide's outline set matches the
 * reference design's line weight, and it's already a dependency — a second icon library for
 * eight glyphs would land in the eagerly-loaded `icons` chunk for no gain.
 */
const DAY: Record<WeatherGlyph, LucideIcon> = {
  clear: Sun,
  partly: CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

/** Only the two clear-sky glyphs differ after dark — a raincloud looks the same at night. */
const NIGHT: Partial<Record<WeatherGlyph, LucideIcon>> = {
  clear: Moon,
  partly: CloudMoon,
};

export function WeatherIcon({ code, isDay, size = 20, className }: { code: number; isDay: boolean; size?: number; className?: string }) {
  const glyph = weatherGlyph(code);
  const Icon = (!isDay && NIGHT[glyph]) || DAY[glyph];
  return <Icon size={size} className={className} strokeWidth={1.5} aria-hidden="true" />;
}
