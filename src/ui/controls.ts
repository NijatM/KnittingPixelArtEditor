// Small DOM helpers and the reference site's controls: bar slider, segmented buttons, [x] checks.
export const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;
export const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as T[];

export interface BarOptions {
  min: number;
  max: number;
  value: number;
  step?: number;          // keyboard step and value snapping; default: continuous, keys move 1 %
  fmt: (v: number) => string;
  onInput: (v: number) => void;
}

/** Drag-anywhere slider: 22px track, dim fill, 2px mark, value printed in the next sibling. */
export class Bar {
  value: number;
  private fill: HTMLElement;
  private mark: HTMLElement;
  private out: HTMLElement | null;

  constructor(private el: HTMLElement, private o: BarOptions) {
    el.innerHTML = '<div class="fill"></div><div class="mark"></div>';
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-valuemin', String(o.min));
    el.setAttribute('aria-valuemax', String(o.max));
    const label = el.parentElement?.querySelector('label')?.textContent;
    if (label) el.setAttribute('aria-label', label);
    this.fill = el.firstElementChild as HTMLElement;
    this.mark = el.lastElementChild as HTMLElement;
    this.out = el.nextElementSibling as HTMLElement | null;
    this.value = o.value;
    this.set(o.value);

    const at = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      this.set(o.min + (e.clientX - r.left) / r.width * (o.max - o.min), true);
    };
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); el.classList.add('active'); at(e); });
    el.addEventListener('pointermove', e => { if (el.classList.contains('active')) at(e); });
    const end = () => el.classList.remove('active');
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', e => {
      const step = (o.step ?? (o.max - o.min) / 100) * (e.shiftKey ? 10 : 1);
      const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : 0;
      if (d) { e.preventDefault(); this.set(this.value + d, true); }
    });
  }

  set(v: number, emit = false) {
    const { min, max, step } = this.o;
    v = Math.max(min, Math.min(max, step ? Math.round(v / step) * step : v));
    const changed = v !== this.value;
    this.value = v;
    const t = (v - min) / (max - min);
    this.fill.style.width = `${t * 100}%`;
    this.mark.style.left = `calc(${t * 100}% - 1px)`;
    const text = this.o.fmt(v);
    if (this.out) this.out.textContent = text;
    this.el.setAttribute('aria-valuenow', String(v));
    this.el.setAttribute('aria-valuetext', text);
    if (emit && changed) this.o.onInput(v);
  }
}

/** Segmented buttons: one is .on. onPick gets the clicked button. */
export function seg(el: HTMLElement, onPick: (b: HTMLButtonElement) => void) {
  el.addEventListener('click', e => {
    const b = (e.target as Element).closest('button');
    if (!b || b.disabled || !el.contains(b)) return;
    setSeg(el, x => x === b);
    onPick(b);
  });
}

export function setSeg(el: HTMLElement, isOn: (b: HTMLButtonElement) => boolean) {
  $$<HTMLButtonElement>('button', el).forEach(b => { b.classList.toggle('on', isOn(b)); b.setAttribute('aria-pressed', String(isOn(b))); });
}

/** Text check "[x] label". */
export function check(el: HTMLElement, onToggle: (on: boolean) => void) {
  el.addEventListener('click', () => { if ((el as HTMLButtonElement).disabled) return; setCheck(el, !el.classList.contains('on')); onToggle(el.classList.contains('on')); });
}

export function setCheck(el: HTMLElement, on: boolean) {
  el.classList.toggle('on', on);
  el.setAttribute('aria-pressed', String(on));
  const box = el.querySelector('.box');
  if (box) box.textContent = on ? '[x]' : '[ ]';
}
