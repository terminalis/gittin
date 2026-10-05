// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ControlsResize } from '@/controls/resize';

describe('ControlsResize', () => {
  it('ignores a delayed resize once it is disposed', () => {
    vi.useFakeTimers();
    try {
      const layout = vi.fn();
      const control = new ControlsResize(document.createElement('div'), layout);
      control.schedule();
      control.dispose();
      vi.runAllTimers();
      expect(layout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
