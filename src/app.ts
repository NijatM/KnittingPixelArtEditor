// Entry: the chooser and the hash router. "#portrait" opens the portrait editor, "#grammar[/…]" Knit Grammar,
// "#taxonomy[/SMP_0001]" Knitting Taxonomy, anything else the chooser. Each section's code loads the first time it
// opens. The address on the first tag (written 2026-10-31, #grammar/learn/taxonomy/frame-01) now opens SMP_0001.
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './style.css';
import { mountFigure } from './hl';
import { needleBed, stitchPlate } from './grammar/figures';
import { bookShelf } from './taxonomy/figure';

type Section = 'home' | 'portrait' | 'grammar' | 'taxonomy';
const $ = (s: string) => document.querySelector(s) as HTMLElement;

const HOME = `
<div class="homewrap">
  <header class="homehead">
    <div><div class="name">Nijat Mahamaliyev</div><div class="dim">Tailored Materiality Research</div></div>
    <a class="dim small" href="https://nijatmahamaliyev.com">nijatmahamaliyev.com</a>
  </header>
  <div class="prompt"><b>root@nijat:~$</b> ./KnittingPixelArtEditor<span class="cursor"></span></div>
  <div class="choose">
    <a class="choice" href="#portrait">
      <div class="n"><span>01 · PORTRAIT</span><span class="readout" data-read="0">rest</span></div>
      <div class="fig" data-fig="0"></div>
      <span class="t">Knitting Pixel Portrait</span>
      <span class="d">Turns a portrait photo into a two-colour pixel chart for knitting, one cell per stitch.</span>
      <span class="go">open ›</span>
    </a>
    <a class="choice" href="#grammar">
      <div class="n"><span>02 · KNIT GRAMMAR</span><span class="readout" data-read="1">rest</span></div>
      <div class="fig" data-fig="1"></div>
      <span class="t">Knit Grammar</span>
      <span class="d">How a V-bed knitting machine works, and an editor for knit programs as bitmaps: one pixel per needle, one row per pass, colours from a key.</span>
      <span class="go">open ›</span>
    </a>
    <a class="choice" href="#taxonomy">
      <div class="n"><span>03 · KNITTING TAXONOMY</span><span class="readout" data-read="2">rest</span></div>
      <div class="fig" data-fig="2"></div>
      <span class="t">Knitting Taxonomy</span>
      <span class="d">Knitted samples in frames, each with an NFC tag: the whole collection as a shelf, with each sample's yarns, structure, machine settings and performance values. A tag opens its sample.</span>
      <span class="go">open ›</span>
    </a>
  </div>
  <div class="small faint homefoot">Everything runs in your browser; nothing is uploaded.</div>
</div>`;

let homeBuilt = false;
function buildHome() {
  if (homeBuilt) return;
  homeBuilt = true;
  const home = $('#home');
  home.innerHTML = HOME;
  const figs = [
    { m: stitchPlate, label: 'A plate of stitches with a small portrait standing raised; stitches near the pointer rise.' },
    { m: needleBed, label: 'Two needle beds with a carriage above; the needles under the carriage rise into the gap.' },
    { m: bookShelf, label: 'A shelf of sample spines on a board; the spine under the pointer lifts out of the row.' },
  ];
  figs.forEach((f, i) => {
    const el = home.querySelector(`[data-fig="${i}"]`) as HTMLElement, read = home.querySelector(`[data-read="${i}"]`) as HTMLElement;
    mountFigure(el, f.m, { label: f.label, onRead: t => (read.textContent = t) });
  });
}

let portrait: Promise<unknown> | null = null;
let grammar: typeof import('./grammar/main') | null = null;
let taxonomy: Promise<typeof import('./taxonomy/main')> | null = null;

function parse(): { section: Section; sub: string } {
  let h = decodeURIComponent(location.hash.slice(1));
  const old = /^grammar\/learn\/taxonomy(?:\/frame-(\d+))?/.exec(h);
  if (old) { h = `taxonomy/SMP_${(old[1] ?? '1').padStart(4, '0')}`; history.replaceState(null, '', `#${h}`); }
  if (h.startsWith('taxonomy')) return { section: 'taxonomy', sub: h.slice('taxonomy'.length).replace(/^\//, '') };
  if (h.startsWith('portrait')) return { section: 'portrait', sub: '' };
  if (h.startsWith('grammar')) return { section: 'grammar', sub: h.slice('grammar'.length).replace(/^\//, '') };
  return { section: 'home', sub: '' };
}

const TITLES: Record<Section, string> = { home: 'KnittingPixelArtEditor', portrait: 'Knitting Pixel Portrait · KnittingPixelArtEditor', grammar: 'Knit Grammar · KnittingPixelArtEditor', taxonomy: 'Knitting Taxonomy · KnittingPixelArtEditor' };

async function go() {
  const { section, sub } = parse();
  document.body.dataset.section = section;
  document.title = TITLES[section];
  if (section === 'home') buildHome();
  else if (section === 'portrait') {
    portrait ??= import('./main');
    await portrait;
    window.dispatchEvent(new Event('resize')); // lay the portrait out for the space it has now
  } else if (section === 'taxonomy') {
    taxonomy ??= import('./taxonomy/main').then(async m => { await m.init($('#tx')); return m; });
    (await taxonomy).route(sub);
  } else {
    if (!grammar) { grammar = await import('./grammar/main'); grammar.init($('#kg')); }
    grammar.route(sub);
  }
}

window.addEventListener('hashchange', () => void go());
void go();
