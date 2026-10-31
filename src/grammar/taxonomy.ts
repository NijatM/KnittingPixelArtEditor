// Knitting Taxonomy: knitted samples in frames, each with an NFC tag holding the address of its entry here
// (#grammar/learn/taxonomy/<id>; tools/nfc/ reads a tag at the desk and opens the same address on the laptop).
// For now one placeholder frame, drawn: a white frame with a plain jersey sample inside (in 3D by frame3d.ts where
// WebGL works, this flat drawing otherwise).

export interface Frame { id: string; num: string; title: string; text: string; mini?: string }

export const FRAMES: Frame[] = [
  {
    id: 'frame-01', num: '01', title: 'single jersey (placeholder)', mini: 'jersey',
    text: 'A stand-in for the first frame until the real samples are photographed and described.',
  },
];

/** The address a frame's tag holds. */
export const frameUrl = (f: Frame, base = 'https://nijatm.github.io/KnittingPixelArtEditor/') => `${base}#grammar/learn/taxonomy/${f.id}`;

/** A white frame, wider at the bottom, around a jersey sample: rows of V-shaped stitches. */
function frameSvg(): string {
  const W = 200, H = 214, x0 = 18, y0 = 16, x1 = 182, y1 = 166, dx = 8, dy = 7;
  const legs: string[] = [];
  for (let y = y0 - dy; y < y1 + dy; y += dy) {
    for (let x = x0 - dx / 2; x < x1 + dx; x += dx) {
      legs.push(`M${x - 3.3} ${y - 3.6}Q${x - 2.4} ${y + 1.6} ${x} ${y + 3.8}M${x + 3.3} ${y - 3.6}Q${x + 2.4} ${y + 1.6} ${x} ${y + 3.8}`);
    }
  }
  return `<svg class="framesvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="placeholder frame: a white frame around a jersey sample">
  <defs><clipPath id="tx-win"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/></clipPath></defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="3" fill="#e7e6e2" stroke="#c9c7c1"/>
  <g clip-path="url(#tx-win)">
    <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#9c4a37"/>
    <path d="${legs.join('')}" fill="none" stroke="#e48a6e" stroke-width="2.7" stroke-linecap="round"/>
  </g>
  <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="#bdbab3"/>
</svg>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** The Learn page's body. */
export function taxonomyHtml(): string {
  return `<p class="lead">Knitted samples in frames. Each frame carries an NFC tag: touch it with a phone, or lay it on the reader at the desk, and its entry opens here.</p>
${FRAMES.map(f => `<section class="frame" id="${f.id}">
  <h3>${f.num} · ${esc(f.title)}</h3>
  <div class="frameview" data-frame3d>${frameSvg()}</div>
  <p class="dim small frame3dnote" hidden>Drawn, not computed: a stand-in frame and jersey. Drag to turn it.</p>
  <p>${esc(f.text)}</p>
  ${f.mini ? `<div data-mini="${f.mini}"></div>` : ''}
  <p class="dim small">tag address: <code>${esc(frameUrl(f))}</code></p>
</section>`).join('\n')}`;
}
