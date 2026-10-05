/** "Today, 18:17", "Yesterday, 09:02" or "28 Sep, 14:00"; the year appears only when it differs from now. */
export function whenLabel(time: number, now = new Date(), locale?: string): string {
  const date = new Date(time);
  const clock = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return `Today, ${clock}`;
  if (days === 1) return `Yesterday, ${clock}`;
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return `${date.toLocaleDateString(locale, options)}, ${clock}`;
}
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? '1 byte' : `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
