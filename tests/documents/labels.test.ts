import { it, expect } from 'vitest';
import { sizeLabel, whenLabel } from '../../src/documents/labels';

const now = new Date(2026, 8, 30, 20, 0);
it('names today and yesterday, then the date, adding the year only when it differs', () => {
  expect(whenLabel(new Date(2026, 8, 30, 18, 17).getTime(), now, 'en-GB')).toBe('Today, 18:17');
  expect(whenLabel(new Date(2026, 8, 29, 9, 2).getTime(), now, 'en-GB')).toBe('Yesterday, 09:02');
  expect(whenLabel(new Date(2026, 8, 28, 14, 0).getTime(), now, 'en-GB')).toMatch(/^28 Sept?, 14:00$/);
  expect(whenLabel(new Date(2025, 0, 5, 8, 30).getTime(), now, 'en-GB')).toBe('5 Jan 2025, 08:30');
});
it('reads sizes in bytes, KB or MB', () => {
  expect(sizeLabel(1)).toBe('1 byte');
  expect(sizeLabel(665)).toBe('665 bytes');
  expect(sizeLabel(1536)).toBe('1.5 KB');
  expect(sizeLabel(3 * 1024 * 1024)).toBe('3.0 MB');
});
