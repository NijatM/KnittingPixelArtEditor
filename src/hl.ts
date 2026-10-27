// Mounts a hairline figure (vendored kernel, MIT, github.com/lucasmarkes/hairline) into an element, dark only.
// The read-out goes to a callback, shown beside the figure, never inside it.
import HL from './vendor/hairline/kernel.js';

export { HL };
export interface Readout { textContent: string | null }
export interface FigureCtx { stage: HTMLElement; svg: SVGSVGElement; read: Readout }
export type FigureMount = (ctx: FigureCtx, value: number) => { set(v: number): void; destroy(): void };

export function mountFigure(el: HTMLElement, mount: FigureMount, o: { label: string; value?: number; onRead?: (t: string) => void }) {
  HL.inject(document);
  el.setAttribute('data-hairline', 'kg');
  el.setAttribute('data-hairline-theme', 'dark');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', o.label);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 400 320');
  svg.setAttribute('aria-hidden', 'true');
  el.appendChild(svg);
  let text: string | null = null;
  const read: Readout = {
    get textContent() { return text; },
    set textContent(v) { const t = v ?? ''; if (t !== text) { text = t; o.onRead?.(t); } },
  };
  const f = mount({ stage: el, svg, read }, o.value ?? 0.5);
  return { destroy() { f.destroy(); svg.remove(); } };
}
