import { tenantTimezone } from '../config/appConfig';
import { hours24 } from '../data/calendarData';
import type { SelectedTile } from '../types';

export function tenantNowSlot(): SelectedTile {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    month: '2-digit',
    timeZone: tenantTimezone,
    year: 'numeric',
  }).formatToParts(new Date());

  const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const date = `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
  const rawHour = valueFor('hour');
  const hour = (rawHour === '24' ? '00' : rawHour).padStart(2, '0');

  return { date, hour: hours24.includes(hour) ? hour : '00' };
}

export function formatDate(date: string, style: 'short' | 'long' = 'short') {
  const value = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', {
    weekday: style === 'long' ? 'long' : 'short',
    month: 'short',
    day: 'numeric',
    year: style === 'long' ? 'numeric' : undefined,
    timeZone: tenantTimezone,
  }).format(value);
}

export function formatDateTime(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tenantTimezone,
  }).format(new Date(value));
}

export function tenantDateHour(value: string | null) {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    month: '2-digit',
    timeZone: tenantTimezone,
    year: 'numeric',
  }).formatToParts(new Date(value));

  const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const rawHour = valueFor('hour');
  return {
    date: `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`,
    hour: (rawHour === '24' ? '00' : rawHour).padStart(2, '0'),
  };
}

export function weekdayShortForDate(date: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: tenantTimezone,
  }).format(new Date(`${date}T00:00:00`));
}
