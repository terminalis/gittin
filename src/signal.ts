/** A set of listeners: `on` adds one and returns its removal; `emit` calls them all. */
export function signal<T = void>() {
  const listeners = new Set<(value: T) => void>();
  return {
    on(listener: (value: T) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit(value: T) {
      listeners.forEach((listener) => listener(value));
    },
    clear() {
      listeners.clear();
    },
  };
}
