export class ControlsResize {
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private observer: ResizeObserver | undefined;
  constructor(
    element: HTMLElement,
    private layout: () => void
  ) {
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.schedule);
      this.observer.observe(element);
    }
  }
  schedule = () => {
    if (!this.disposed && !this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (!this.disposed) this.layout();
      }, 200);
  };
  dispose() {
    this.disposed = true;
    this.observer?.disconnect();
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
