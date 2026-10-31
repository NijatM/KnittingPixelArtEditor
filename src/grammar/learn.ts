// Learn: how a V-bed knits and how the grammar describes it. Every page lists its sources; nothing here is
// unsourced. Pages stay marked as drafts until they are reviewed.
//
// Placeholders filled in by the page renderer:
//   <figure data-fig="needleBed|latchNeedle|racking">     a hairline figure
//   <figure data-swatch="knit|purl|tuck|float|transfer|rib">  a 3D yarn swatch
//   <div data-keytable="4s52-basic|4s52-two">              a key table drawn from the preset
//   <div data-mini="id">                                   a small grammar example from MINIS, with "open in editor"

export interface Source { id: string; text: string; url?: string }
export interface Page { id: string; nav: string; kicker: string; title: string; html: string; sources: string[]; draft: boolean }

export const SOURCES: Source[] = [
  { id: 'spencer', text: 'Spencer, D. J. (2001). Knitting Technology: A Comprehensive Handbook and Practical Guide, 3rd ed. Woodhead Publishing. ISBN 978-1-85573-333-6.' },
  { id: 'knitout', text: 'McCann, J. The "Knitout" (.k) File Format, version 0.6. Carnegie Mellon University Textiles Lab.', url: 'https://textiles-lab.github.io/knitout/knitout.html' },
  { id: 'mccann16', text: 'McCann, J., Albaugh, L., Narayanan, V., Grow, A., Matusik, W., Mankoff, J., Hodgins, J. (2016). A Compiler for 3D Machine Knitting. ACM Transactions on Graphics 35(4).', url: 'https://doi.org/10.1145/2897824.2925940' },
  { id: 'lin18', text: 'Lin, J., Narayanan, V., McCann, J. (2018). Efficient Transfer Planning for Flat Knitting. Proceedings of the 2nd ACM Symposium on Computational Fabrication (SCF \'18).', url: 'https://doi.org/10.1145/3213512.3213515' },
  { id: 'popescu18', text: 'Popescu, M., Rippmann, M., Van Mele, T., Block, P. (2018). Automated Generation of Knit Patterns for Non-developable Surfaces. In Humanizing Digital Reality (Design Modelling Symposium Paris 2017), Springer, pp. 271–284.', url: 'https://doi.org/10.1007/978-981-10-6611-5_24' },
  { id: 'knitscape', text: 'Twigg-Smith, H., Whiting, E., Peek, N. (2024). KnitScape: Computational Design and Yarn-Level Simulation of Slip and Tuck Colorwork Knitting Patterns. CHI \'24.', url: 'https://doi.org/10.1145/3613904.3642799' },
  { id: 'steigervega', text: 'Steiger Participations SA. VEGA 3.130, product page (technical data).', url: 'https://steiger-textil.ch/project/vega3130/' },
  { id: 'course', text: 'Colour key convention: Computational Textiles (MIT 4.S52/6.S895, Spring 2026), Mariana Popescu.' },
];

const cite = (...ids: string[]) => `<span class="cite">[${ids.map(id => `<a href="#grammar/learn/sources" data-src="${id}">${SOURCES.findIndex(s => s.id === id) + 1}</a>`).join(', ')}]</span>`;
const go = (page: string, text: string) => `<a href="#grammar/learn/${page}">${text}</a>`;

/** Small grammar examples: rows top (last pass) to bottom (pass 1), op ids of the 4.S52 basic key (or of the
 *  two-guide key when `two`). `guides` shows the guides view; `step` adds a pass-by-pass reader. */
export interface Mini { name: string; rows: string[]; two?: boolean; guides?: boolean; step?: boolean }
const DIAMOND = ['............', '.....##.....', '....####....', '...######...', '...######...', '....####....', '.....##.....', '............'];
export const MINIS: Record<string, Mini> = {
  reading: { name: 'five passes', step: true, rows: ['kf kf kf kf kf kf kf kf', 'kf fl fl kf kf fl fl kf', 'kf tf kf tf kf tf kf tf', 'kf kb kf kb kf kb kf kb', 'kf kf kf kf kf kf kf kf'] },
  doubleknit: { name: 'double knit, colours', two: true, rows: DIAMOND.map(r => [...r].map(c => (c === '#' ? 'k2b' : 'k2f')).join(' ')) },
  doubleknitg: { name: 'double knit, guides view', two: true, guides: true, rows: DIAMOND.map(r => [...r].map(c => (c === '#' ? 'k2b' : 'k2f')).join(' ')) },
  jersey: { name: 'single jersey', rows: Array(8).fill('kf '.repeat(12).trim()) },
  rib: { name: '1x1 rib', rows: Array(8).fill('kf kb '.repeat(6).trim()) },
  rib22: { name: '2x2 rib', rows: Array(8).fill('kf kf kb kb '.repeat(3).trim()) },
  tubular: { name: 'tubular', rows: Array.from({ length: 8 }, (_, i) => (i % 2 ? 'kf ' : 'kb ').repeat(12).trim()) },
  purl: { name: 'purl (garter) by transfers', rows: Array.from({ length: 8 }, (_, i) => (i % 2 ? 'kfxb ' : 'kbxf ').repeat(12).trim()) },
  // tucks two passes deep, the next pair of passes offset by two needles
  tuckcells: { name: 'tuck texture', rows: Array.from({ length: 8 }, (_, i) => Array.from({ length: 12 }, (_, x) => (x % 4 === (i % 4 < 2 ? 1 : 3) ? 'tf' : 'kf')).join(' ')) },
  floats: { name: 'floats behind', rows: Array.from({ length: 8 }, (_, i) => Array.from({ length: 12 }, (_, x) => (i % 2 === 0 && x % 4 !== 0 ? 'fl' : 'kf')).join(' ')) },
  shortrows: { name: 'short rows (wedge)', rows: ['kf '.repeat(12).trim(), ...Array.from({ length: 6 }, (_, i) => Array.from({ length: 12 }, (_, x) => (x < 12 - (i + 1) * 2 + 2 ? 'kf' : 'fl')).join(' ')), 'kf '.repeat(12).trim()] },
  eyelet: { name: 'eyelets by transfer', rows: ['kf '.repeat(12).trim(), 'kf '.repeat(12).trim(), 'kf kf kf kfxr kf kf kf kf kfxr kf kf kf', 'kf '.repeat(12).trim(), 'kf '.repeat(12).trim(), 'kf kf kf kf kf kfxl kf kf kf kf kf kf', 'kf '.repeat(12).trim(), 'kf '.repeat(12).trim()] },
};

export const PAGES: Page[] = [
  {
    id: 'machine', nav: 'machine', kicker: '00 · LEARN', title: 'The V-bed flat knitting machine', draft: true, sources: ['spencer', 'knitout', 'steigervega'],
    html: `
<p class="lead">A V-bed flat knitting machine knits with two straight rows of needles that face each other: the <b>front bed</b> and the <b>back bed</b>. Seen from the side, the two beds lean together like an upside-down V, and their needles meet in the gap at the top ${cite('spencer')}.</p>
<figure data-fig="needleBed" data-label="Two needle beds in an upside-down V with a carriage above; the needles under the carriage are pushed up into the gap."><figcaption>Move across the figure: the carriage follows, and its cams push the needles under it up their beds into the gap. Leave it and the carriage parks.</figcaption></figure>
<figure data-fig="vSection" data-label="The two beds seen from the end: an upside-down V with a needle in each bed, sinkers at the top, fabric hanging to two rollers, and the yarn coming down through a tensioner and the carrier."><figcaption>The same machine seen from the end. Move up and down: both needles slide up their beds to the top of the V, where the sinkers hold the fabric down. The fabric hangs through the gap to the take-down rollers; the yarn comes down from the tensioner through the carrier.</figcaption></figure>
<h3>Parts</h3>
<dl class="parts">
<dt>needle bed</dt><dd>A steel plate with parallel grooves (tricks), one needle in each. Both beds are numbered the same way: needle 1, 2, 3 … from left to right ${cite('spencer', 'knitout')}.</dd>
<dt>latch needle</dt><dd>The needle a V-bed uses: a hook that takes the yarn and a latch that closes the hook so the old loop can slide off. ${go('needle', 'One knitting cycle →')}</dd>
<dt>gauge</dt><dd>How close the needles are, counted as needles per inch of bed: E12 means 12 needles per inch. A finer gauge takes thinner yarn and makes smaller stitches ${cite('spencer')}.</dd>
<dt>carriage &amp; cams</dt><dd>The carriage travels across the beds, left to right and back. Inside it, cams (angled tracks) catch each needle's butt and push the needle up, or let it down, as the carriage passes. One set of cams is one knitting system; a carriage with several systems can form several courses in one stroke ${cite('spencer')}.</dd>
<dt>stitch cam</dt><dd>The cam that draws the needle down at the end of its stroke. How far down it goes sets how much yarn each new loop takes: the <b>stitch length</b>. Longer stitches give a looser, softer fabric, shorter ones a denser, firmer one. Electronic machines set it as a value per system and can change it during knitting ${cite('spencer', 'steigervega')}.</dd>
<dt>sinkers</dt><dd>Thin plates between the needles at the top of each bed. Holding-down sinkers press the fabric down while the needles rise, so the old loops stay low on the needles; that keeps knitting reliable where only a few needles work, as in short rows ${cite('spencer')}.</dd>
<dt>yarn carriers</dt><dd>Run on rails above the beds. The carriage takes a carrier along, and the carrier lays its yarn into the hooks of the raised needles. The grammar calls them yarn guides (YG1, YG2) ${cite('knitout')}.</dd>
<dt>yarn path &amp; tension</dt><dd>From its cone the yarn runs through a tensioner, which brakes it evenly, then down to its carrier and into the hooks. Even tension gives even stitches; uneven tension shows as loops of different sizes ${cite('spencer')}.</dd>
<dt>take-down</dt><dd>Rollers pull the knitted fabric away from the needles, so each old loop stays low on its needle and the new yarn can be drawn through it ${cite('spencer')}.</dd>
<dt>racking</dt><dd>The back bed can shift sideways against the front bed, by whole needles, so a back needle faces a different front needle. That is how loops move sideways. ${go('operations/racking', 'Racking and transfers →')}</dd>
</dl>
<aside class="note-box"><div class="kicker">STEIGER · THE LAB'S MACHINE</div>
<p>The Tailored Materiality Research lab knits on a Steiger Vega (called Vega T 3.31 in the lab). Steiger's current Vega, the Vega 3.130, is a compact machine for technical textiles: three knitting systems, each able to transfer in both directions; 130 cm working width; gauges E5 to E18; 16 motorised yarn carriers; racking up to ±42 mm; stitch length controlled electronically; an upper take-down ${cite('steigervega')}.</p>
<p class="dim">To confirm with the lab: the exact model and its gauge, the needles in work, and how the lab's script maps one BMP row onto the three systems.</p></aside>`,
  },
  {
    id: 'needle', nav: 'needle', kicker: '01 · LEARN', title: 'The latch needle and one knitting cycle', draft: true, sources: ['spencer', 'knitout'],
    html: `
<p class="lead">A latch needle has four parts: the <b>hook</b> that takes the yarn, the <b>latch</b> (a small tongue on a rivet that swings shut over the hook), the <b>stem</b>, and the <b>butt</b>, the heel the cams push ${cite('spencer')}.</p>
<figure data-fig="latchNeedle" data-label="A latch needle in its trick with the old loop at the edge of the bed and the new yarn across the top."><figcaption>Move up and down over the figure to raise and lower the needle. Go all the way up and back below rest: that is one knit. Stop halfway (tuck height) and come back down: the yarn is held as a tuck.</figcaption></figure>
<h3>One knit, step by step</h3>
<ol class="steps">
<li><b>Rest.</b> The needle is down; the loop from the last pass sits in its hook.</li>
<li><b>Clearing.</b> A cam raises the needle. The old loop slides down, opens the latch and drops below it onto the stem.</li>
<li><b>Feeding.</b> The carrier lays the new yarn across. As the needle comes down, the hook takes it.</li>
<li><b>Latch closing.</b> The old loop, held down by the fabric, meets the latch from below and turns it shut over the hook.</li>
<li><b>Knock-over.</b> The needle drops below the edge of the bed. The old loop slides over the closed latch and off the needle, and the new yarn is pulled through it: the new loop ${cite('spencer')}.</li>
</ol>
<h3>the loop</h3>
<p>Every loop has a <b>head</b> (the top, which the next loop is drawn through), two <b>legs</b>, and a <b>sinker loop</b> that joins it to its neighbour in the course. The yarn in one loop and its sinker loop is the stitch length ${cite('spencer')}.</p>
<h3>Tuck and miss</h3>
<p>Raised only to <b>tuck height</b>, the old loop opens the latch but stays on it. The hook takes the new yarn and keeps both: a tuck. Left <b>down</b>, the needle takes no yarn; the yarn passes it and lies as a float: a miss ${cite('spencer', 'knitout')}. ${go('operations', 'All operations →')}</p>
<h3>selection: why a bitmap can program the machine</h3>
<p>An electronic V-bed selects needles one by one: for each pass it decides which needles the cams raise to knit, which only to tuck height, and which stay down ${cite('spencer')}. One row of the grammar says exactly that, for every needle, for one pass. ${go('reading', 'Reading the grammar →')}</p>`,
  },
  {
    id: 'operations', nav: 'operations', kicker: '02 · LEARN', title: 'Operations: what a needle does in one pass', draft: true, sources: ['knitout', 'spencer', 'lin18', 'mccann16'],
    html: `
<p class="lead">Each colour of the grammar names an operation. Knitout, an open format for knitting-machine instructions, defines the same core set; its wording is quoted below ${cite('knitout')}.</p>
<table class="keytable optable"><thead><tr><th>operation</th><th>the needle</th><th>its old loop</th><th>the new yarn</th></tr></thead><tbody>
<tr><td><a href="#grammar/learn/operations/knit">knit</a></td><td>rises to clearing height</td><td>is knocked over</td><td>becomes the new loop</td></tr>
<tr><td><a href="#grammar/learn/operations/tuck">tuck</a></td><td>rises to tuck height</td><td>stays on the needle</td><td>is held in the hook as well</td></tr>
<tr><td><a href="#grammar/learn/operations/float">float</a></td><td>stays down</td><td>stays on the needle</td><td>passes by as a float</td></tr>
<tr><td><a href="#grammar/learn/operations/transfer">transfer</a></td><td>rises to transfer height; the facing needle takes the loop</td><td>moves to the other bed</td><td>none</td></tr>
</tbody></table>
<p class="dim small">${cite('spencer', 'knitout')}</p>
<h3 id="knit">knit</h3>
<p>"Pull a loop formed … by the yarns in carriers CS through the loops on needle N, dropping them in the process" ${cite('knitout')}. The basic stitch. Knitted on the front bed it shows its two legs (a V) on the face of the fabric; the same stitch knitted on the back bed faces the other way and shows its head, the purl side.</p>
<div class="pair"><figure data-swatch="knit"></figure><figure data-swatch="purl"></figure></div>
<h3 id="tuck">tuck</h3>
<p>"Add a loop … to those already on needle N" ${cite('knitout')}. The old loop is not knocked over; the next knit pulls through both. Tucks thicken the fabric and make it wider and textured ${cite('spencer')}.</p>
<figure data-swatch="tuck"></figure>
<h3 id="float">float (miss)</h3>
<p>The carrier passes the needle without forming a loop ${cite('knitout')}. The yarn lies behind it as a float, and the needle keeps its old loop (it is held). Floats pull the fabric in and make it less stretchy across; colour patterns use them to hide a yarn on the back ${cite('spencer')}.</p>
<figure data-swatch="float"></figure>
<h3 id="transfer">transfer</h3>
<p>Moves the loops of a needle to the needle facing it on the other bed ${cite('knitout')}. From then on that needle's stitches are knitted from the other side. The class grammar packs a knit and a transfer into one cell: "knit front, transfer to back".</p>
<figure data-swatch="transfer"></figure>
<h3 id="racking">racking: moving loops sideways</h3>
<p>"At racking R, back needle index B is aligned to front needle index B+R"; positive racking moves the back bed right ${cite('knitout')}. To move a loop one needle left or right, the machine transfers it to the other bed, racks one needle, and transfers it back: two transfer passes with a rack between ${cite('lin18', 'mccann16')}. The grammar's "transfer left / right" cells stand for this; how the lab's script schedules the passes is to be confirmed.</p>
<figure data-fig="racking" data-label="Two needle beds seen from above; the back bed shifts sideways and a dashed guide shows which back needle faces the bright front needle."><figcaption>Move left and right: the back bed racks by whole needles. The dashed guide joins the bright front needle to the back needle it now faces: where its loop would transfer.</figcaption></figure>
<h3>not in the class key</h3>
<p class="dim">Knitout also has <b>split</b> (knit and move the old loops to the other bed in one action) and <b>drop</b> (take the loops off a needle) ${cite('knitout')}. A custom key can't express them yet.</p>`,
  },
  {
    id: 'reading', nav: 'reading', kicker: '03 · LEARN', title: 'Reading the grammar: a bitmap is a knitting program', draft: true, sources: ['course', 'knitout'],
    html: `
<p class="lead">In this grammar a BMP is the program. <b>One pixel is one needle; one row is one carriage pass.</b> The bottom row is knitted first and the carriage goes back and forth, so passes alternate direction. The image's width is the number of needles in work, its height the number of passes ${cite('course')}.</p>
<h3>colour = operation</h3>
<p>Dark shades act on the <b>front bed</b>, light shades on the <b>back bed</b>; white is a float. Each colour is one operation from ${go('operations', 'the operations page')}.</p>
<div data-keytable="4s52-basic"></div>
<h3>symbols</h3>
<p>Every cell can carry a symbol. The line across is the yarn's path; a loop below the line is on the front bed, above it on the back bed; a chevron is a tuck; a small arrow is a transfer (across the line: to the other bed; curved: one needle left or right).</p>
<div data-glyphs="fl:the line: the yarn passes (float),kf:loop below: knit on the front bed,kb:loop above: knit on the back bed,tf:chevron below: tuck on the front bed,tb:chevron above: tuck on the back bed,kfxb:arrow across: then to the other bed,kfxl:curved arrow: then one needle left,kfxr:curved arrow: then one needle right"></div>
<h3>exact colours</h3>
<p>The machine's script reads the RGB values, so a colour that is almost right is wrong. Picking colours from a screenshot gives values like (1, 34, 255) instead of (0, 0, 255): the screen converts colours through its display profile. The editor stores operations, not colours, and writes the key's exact values; when it opens a BMP, it snaps near colours to the key and lists every one it changed.</p>
<h3>an example, pass by pass</h3>
<p>Step through it: the carriage knits pass 1 left to right, pass 2 back again, and so on up the picture.</p>
<div data-mini="reading"></div>`,
  },
  {
    id: 'guides', nav: 'two guides', kicker: '04 · LEARN', title: 'Two yarn guides', draft: true, sources: ['course', 'knitout'],
    html: `
<p class="lead">With two yarn guides, a cell says what <b>both</b> guides do at that needle in the same pass. The rule: <b>the shade says which bed yarn guide 1 works; yarn guide 2 works the other bed</b> ${cite('course')}.</p>
<div data-keytable="4s52-two"></div>
<h3>the merged symbol</h3>
<p>YG1 keeps its full symbol; YG2 leaves a small mark on its side of the line: a diamond for a knit, a chevron for a tuck. Two parallel lines mean both guides float.</p>
<h3>the guides view</h3>
<p>In the editor, switch the view to <b>guides</b> and every pass splits into a YG1 row and a YG2 row, each with its own symbol on the cell's colour.</p>
<h3>an example: a picture in two yarns</h3>
<p>Read literally, a two-guide row gives every needle a stitch of each yarn, one on each bed, and the yarn on the front bed shows on the face. So a picture drawn in dark blue (YG1 on the front) and light blue (YG2 on the front) comes out on the face in two yarns, with the colours swapped on the back: double knitting. How the lab's script schedules the two guides is to be confirmed.</p>
<div class="pair"><div data-mini="doubleknit"></div><div data-mini="doubleknitg"></div></div>
<h3>one file, one mode</h3>
<p>A pattern is one-guide or two-guide as a whole, because the same colour means different things in each: light blue is "knit back" in a one-guide file and "YG1 knit back · YG2 knit front" in a two-guide file. The mode is chosen when a pattern is made and written into the exported key.</p>`,
  },
  {
    id: 'structures', nav: 'structures', kicker: '05 · LEARN', title: 'Structures', draft: true, sources: ['spencer', 'mccann16'],
    html: `
<p class="lead">Four structures are the base of weft knitting: plain (single jersey), rib, interlock and purl ${cite('spencer')}. On a V-bed the grammar writes them as patterns of a few operations.</p>
<h3>single jersey</h3>
<p>Every needle knits on one bed. Smooth Vs on the face, loop heads on the back; the edges curl ${cite('spencer')}.</p>
<div data-mini="jersey"></div>
<h3>rib</h3>
<p>Front and back needles take turns in the same pass: 1 × 1 rib alternates single needles, 2 × 2 rib pairs. Rib stretches across its width and lies flat, because its two faces balance ${cite('spencer')}.</p>
<div class="pair"><div data-mini="rib"></div><div data-mini="rib22"></div></div>
<figure data-swatch="rib"></figure>
<h3>purl</h3>
<p>Courses alternate between face loops and back loops ${cite('spencer')}. On a V-bed the needles' loops change bed every course, which the grammar writes with the transfer operations.</p>
<div data-mini="purl"></div>
<h3>tubular</h3>
<p>Knit the front bed in one pass and the back bed in the next: the two layers only join at the edges, where the yarn turns, and form a tube ${cite('mccann16')}.</p>
<div data-mini="tubular"></div>
<h3>tuck and float textures</h3>
<p>Tucks set in a pattern give raised, cellular textures; floats on the back pull the fabric in ${cite('spencer')}.</p>
<div class="pair"><div data-mini="tuckcells"></div><div data-mini="floats"></div></div>
<h3>two yarns at once</h3>
<p>With two yarn guides, each needle can take a stitch of each yarn on opposite beds, which gives two-layer fabrics such as double knitting. ${go('guides', 'Two yarn guides →')}</p>
<p class="dim">Interlock (two interlocked 1 × 1 ribs) depends on how the machine's needles are set against each other; it will be added once it is checked against the lab's machine.</p>`,
  },
  {
    id: 'shaping', nav: 'shaping', kicker: '06 · LEARN', title: 'Shaping', draft: true, sources: ['popescu18', 'mccann16', 'lin18', 'spencer'],
    html: `
<p class="lead">A flat machine shapes fabric in two ways: by knitting more passes on some needles than on others, and by changing which needles carry the fabric.</p>
<h3>short rows</h3>
<p>Knit on only part of the needles for a few passes while the others hold their loops (in the grammar: float cells, the needle does nothing in that pass; whether the carriage turns early or the yarn floats past is up to the lab's script). The side that knits gets longer and the fabric curves. Popescu et al. generate knit patterns for doubly curved surfaces from course lines and short rows, as a 2D pattern of loops course by course ${cite('popescu18')}.</p>
<div data-mini="shortrows"></div>
<h3>narrowing and widening</h3>
<p>To narrow, transfer an edge loop onto its neighbour so fewer needles carry the fabric; to widen, bring an empty needle next to the edge into work ${cite('mccann16', 'spencer')}. Moving a whole edge sideways is a sequence of transfers and racks ${cite('lin18')}.</p>
<h3>eyelets</h3>
<p>Move a loop onto its neighbour with a transfer left or right and keep knitting the emptied needle: its new loop has no old loop to pass through and leaves a small hole ${cite('spencer')}.</p>
<div data-mini="eyelet"></div>
<p class="dim">Held loops stretch; the editor's check flags needles that hold a loop longer than the limit you set.</p>`,
  },
  {
    id: 'sources', nav: 'sources', kicker: '07 · LEARN', title: 'Sources', draft: false, sources: [],
    html: `<p class="lead">Everything in Learn comes from these. Simulation of slip and tuck patterns at the yarn level: see KnitScape ${cite('knitscape')}.</p><ol class="sources" data-sources></ol>`,
  },
];
