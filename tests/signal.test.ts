import { signal } from '../src/signal';

it('calls each listener until it is removed or the signal is cleared', () => {
  const changed = signal<number>();
  const seen: number[] = [];
  const off = changed.on((value) => seen.push(value));
  changed.on((value) => seen.push(value * 10));
  changed.emit(1);
  off();
  changed.emit(2);
  changed.clear();
  changed.emit(3);
  expect(seen).toEqual([1, 10, 20]);
});
