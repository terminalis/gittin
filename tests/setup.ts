import { vi } from 'vitest';
if (globalThis.Range) {
  Range.prototype.getClientRects = vi.fn().mockReturnValue({ length: 0 });
  Range.prototype.getBoundingClientRect = vi.fn().mockReturnValue({});
}
