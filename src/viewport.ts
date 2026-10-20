/** Visible panel space for both overlay keyboards and viewport-resizing keyboards. */
export function panelHeight(input: {
  layoutHeight: number; viewportHeight: number; viewportTop: number;
  keyboardHeight: number; top: number;
}): number {
  const visibleBottom = Math.min(input.viewportTop + input.viewportHeight,
    input.layoutHeight - Math.max(0, input.keyboardHeight));
  return Math.max(0, Math.floor(visibleBottom - Math.max(input.top, input.viewportTop)));
}
