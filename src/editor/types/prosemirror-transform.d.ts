import 'prosemirror-transform';
declare module 'prosemirror-transform' {
  interface Step {
    from: number;
    to: number;
  }
}
