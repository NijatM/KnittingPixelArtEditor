// What main.ts needs from each of the section's views (Samples, Lineage, Performance): they all share the hover,
// dwell, pin, search, keys and the 3D flight, so each one answers the same questions about its marks. Also the
// canvas the Lineage and Performance views draw on (1000 samples redrawn within a frame) and their shared drawing.
import type { DB, Rec } from './data';

export type Dir = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';
export interface ViewEvents { hover(r: Rec | null): void; click(r: Rec): void }
export interface View {
  /** The view's box became visible (true) or was hidden. */
  show(on: boolean): void;
  resize(): void;
  setLifted(id: string | null): void;
  setCurrent(id: string | null): void;
  setPinned(id: string | null): void;
  setMatches(ids: Set<string> | null): void;
  neighbour(id: string | null, d: Dir): Rec | null;
  /** The view's order, first to last (search takes its first match from it). */
  order(): Rec[];
  /** Brings the sample's mark into view. */
  reveal(id: string): void;
  /** The sample's mark on screen: where its 3D frame (stage.ts) leaves from and lands. */
  face(id: string): DOMRect | null;
  /** Hides a sample's mark while its frame is out. */
  setAway(id: string, away: boolean): void;
  destroy(): void;
}

/** The hairline palette (vendored kernel, dark) and the page's colours, read from CSS. */
export function palette(el: HTMLElement) {
  const cs = getComputedStyle(el), v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    hi: v('--hl-hi', '#d0d6e0'), edge: v('--hl-edge', '#5b5d64'), mid: v('--hl-mid', '#3e3e44'), lo: v('--hl-lo', '#29292d'),
    text: v('--dim', '#8a8a8a'), bright: v('--hi', '#f4f4f4'), bg: v('--bg', '#0b0b0b'), font: cs.fontFamily,
  };
}
export type Palette = ReturnType<typeof palette>;

/** A canvas filling `box`, in CSS pixels (drawn at the screen's pixel ratio). */
export function surface(box: HTMLElement) {
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d')!;
  box.appendChild(cv);
  const s = {
    cv, ctx, W: 0, H: 0,
    /** Matches the box's size; false while the box is hidden. */
    fit() {
      const W = box.clientWidth, H = box.clientHeight, dpr = Math.min(2, devicePixelRatio);
      if (!W || !H) return false;
      if (W !== s.W || H !== s.H || cv.width !== Math.round(W * dpr)) {
        s.W = W; s.H = H;
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        cv.style.width = `${W}px`; cv.style.height = `${H}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    },
    /** A rectangle in the box as a screen rectangle. */
    screen(x: number, y: number, w: number, h: number) { const b = cv.getBoundingClientRect(); return new DOMRect(b.x + x, b.y + y, w, h); },
  };
  return s;
}

/** Diagonal grey hatching for fibres of unknown origin (as on the spines). */
export function hatch(ctx: CanvasRenderingContext2D, grey: string): CanvasPattern {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const g = c.getContext('2d')!;
  g.globalAlpha = 0.35; g.fillStyle = grey; g.fillRect(0, 0, 4, 4);
  g.globalAlpha = 1; g.strokeStyle = grey; g.lineWidth = 1.3;
  g.beginPath(); g.moveTo(-1, 5); g.lineTo(5, -1); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(3, 5); g.lineTo(5, 3); g.stroke();
  return ctx.createPattern(c, 'repeat')!;
}

/** A sample's yarn bands in the box (x, y top left, w × h): one band per yarn, the first at the bottom, each split
 *  across by its origin shares, as on the spines. */
export function bands(ctx: CanvasRenderingContext2D, db: DB, unknown: CanvasPattern, r: Rec, x: number, y: number, w: number, h: number) {
  const n = r.yarns.length || 1, gap = h / n > 3 ? 1 : 0, bh = (h - gap * (n - 1)) / n;
  r.yarns.forEach((u, j) => {
    const by = y + h - (j + 1) * bh - j * gap, total = u.shares.reduce((s, q) => s + q.pct, 0) || 1;
    let at = x;
    for (const q of u.shares) {
      const ww = (w * q.pct) / total;
      ctx.fillStyle = q.origin === 'unknown' ? unknown : db.colours.get(q.origin) ?? '#6e6e6e';
      ctx.fillRect(at, by, ww, bh);
      at += ww;
    }
  });
}
