// Knit grammar markup, built once when the section first opens. Same look as the portrait editor: numbered sidebar,
// stage with a toolbar and status bar, inspector panels on the right.
import { PAGES } from './learn';

const row = (step: string, num: string, label: string, bind = '') =>
  `<div class="lrow" data-kstep="${step}" tabindex="0"><span class="lnum">${num}</span><span class="left">${label}</span><span class="right" data-kbind="${bind || step}"></span></div>`;

export const SHELL = `
<nav class="snav" id="kgnav" aria-label="knit grammar">
  <div class="navhead">
    <div class="name"><a href="#" class="homelink">Nijat Mahamaliyev</a></div>
    <div class="what">Knit grammar: one pixel, one needle, one pass.</div>
    <div class="lab">Tailored Materiality Research</div>
  </div>
  <div class="seg secseg" aria-label="section"><a href="#portrait">portrait</a><a href="#grammar" class="on" aria-current="page">grammar</a></div>
  <div class="spaced dim navsec">LEARN</div>
  <div class="list">${PAGES.map((p, i) => `<div class="lrow" data-learn="${p.id}" tabindex="0"><span class="lnum">${String(i).padStart(2, '0')}</span><span class="left">${p.nav}</span><span class="right">${p.draft ? 'draft' : ''}</span></div>`).join('')}</div>
  <div class="spaced dim navsec">EDITOR</div>
  <div class="list">
    ${row('experiments', '08', 'experiments')}
    ${row('library', '09', 'library')}
    ${row('pattern', '10', 'pattern')}
    ${row('key', '11', 'key')}
    ${row('grammar', '12', 'grammar')}
    ${row('draw', '13', 'draw')}
    ${row('view', '14', 'view')}
    ${row('check', '15', 'check')}
    ${row('export', '16', 'export')}
  </div>
  <div class="navfoot small faint"><a href="https://nijatmahamaliyev.com">nijatmahamaliyev.com</a></div>
</nav>

<main class="sstage" id="kgstage">
  <div id="kglearn" class="article" tabindex="-1"></div>
  <div id="kgview"><canvas id="kgcv" aria-label="knit grammar pattern"></canvas></div>
  <div id="kg3dview"><div id="kg3dbox"></div>
    <div class="v3dbar small">
      <span class="seg" id="kgm3d" title="the machine making it, pass by pass, or the fabric off the machine"><button data-m3="machine">machine</button><button data-m3="fabric">fabric</button></span>
      <span class="v3fold" id="kgfoldrow" title="fold the needle beds from flat (both facing you) into the real V"><span class="dim">beds flat</span><span class="bar" id="kgfold"></span><span class="dim">V</span></span>
      <span class="seg" id="kglook" title="colour the yarn by the operation that made each loop, or by yarn guide"><button data-look="grammar">grammar</button><button data-look="yarn">yarn</button></span>
      <button class="btn" id="kgrelax" title="relax the fabric again from the machine layout">relax again</button>
      <button class="btn" id="kgflip" title="look at the other side">turn over</button>
    </div>
    <div class="v3dnote small" id="kg3dstatus" aria-live="polite"></div>
  </div>
  <div id="kgsplit" title="drag to share the stage between the chart and 3D" role="separator" aria-orientation="vertical"></div>
  <div class="kgplay small" id="kgplay">
    <div class="stepper" title="previous / next pass (, and .)"><button data-pstep="-1" aria-label="previous pass">‹</button><span id="kgpassn">pass 1</span><button data-pstep="1" aria-label="next pass">›</button></div>
    <div class="bar" id="kgscrub"></div><span class="vh"></span>
    <button class="btn" id="kgplaybtn" title="play the passes">play</button>
    <div class="stepper" title="previous / next action in this pass (&lt; and &gt;)"><button data-astep="-1" aria-label="previous action">‹</button><span id="kgactn">whole pass</span><button data-astep="1" aria-label="next action">›</button></div>
    <span class="fg kgacttext" id="kgacttext"></span>
  </div>
  <div id="kgempty"><div class="drop"><div class="big">no pattern open</div><div><button class="btn" data-knew="1">new pattern</button> <button class="btn" data-knew="2">new two-guide pattern</button></div><div class="small" style="margin-top:12px">or <button class="btn" data-kstepgo="experiments">try an experiment</button></div><div class="small faint" style="margin-top:12px">or drop a BMP / PNG / project file here</div></div></div>

  <div class="stoolbar" id="kgtoolbar">
    <div class="tbline">
      <span class="prompt"><b>root@nijat:~$</b> ./KnitGrammar<span class="cursor"></span></span>
      <div class="tbright">
        <button class="btn" id="kghelp" title="explain controls" aria-pressed="false">?</button>
        <div class="seg" id="kgmode"><button data-mode="learn">learn</button><button data-mode="editor">editor</button></div>
      </div>
    </div>
    <div class="tbline edonly">
      <div class="seg" id="kglayer" title="what you draw on: the design's signs, or the knit program itself (Tab)"><button data-layer="signs">signs</button><button data-layer="ops">knit</button></div>
      <div class="seg" id="kg3dseg" title="the program alone, or next to its yarn in 3D (D)"><button data-v3="0">2D</button><button data-v3="1">3D</button></div>
      <span class="sep hide-narrow"></span>
      <div class="seg tools" id="kgtools">
        <button data-ktool="needle" title="needle: one cell at a time (N)">needle</button><button data-ktool="run" title="run: a straight line of cells (L)">run</button><button data-ktool="flood" title="flood: fill the touching cells of one kind (G)">flood</button><button data-ktool="pass" title="pass: a whole row (P)">pass</button><button data-ktool="wale" title="wale: a whole needle column (W)">wale</button><button data-ktool="motif" title="motif: select, move, flip, repeat (S)">motif</button><button data-ktool="pick" title="pick from the pattern (I, or alt-click)">pick</button>
      </div>
      <button class="opchip" id="kgop" title="what you draw with · [ and ] step through"><span class="sw"></span><span class="t"></span></button>
      <button class="check" id="kgsym"><span class="box">[ ]</span> symbols</button>
      <button class="check" id="kggrid"><span class="box">[ ]</span> grid</button>
      <div class="stepper hide-narrow"><button data-kzoom="-1" aria-label="zoom out">‹</button><span id="kgzoom">fit</span><button data-kzoom="1" aria-label="zoom in">›</button></div>
      <button class="check" id="kgmirror" title="mirror around the centre needle (M)"><span class="box">[ ]</span> mirror</button>
      <div class="seg tb-motif" hidden><button data-ksel="flip-h" title="flip left–right (H)">flip ↔</button><button data-ksel="flip-v" title="flip upside down (V)">flip ↕</button><button data-ksel="repeat" title="repeat the motif (R)">repeat</button></div>
    </div>
  </div>

  <div class="sstatus" id="kgstatus">
    <div class="stline edonly">
      <button class="btn" id="kgundo" title="undo (⌘Z)">‹ undo</button>
      <button class="btn" id="kgredo" title="redo (⇧⌘Z)">redo ›</button>
      <span class="small dim" id="kgsaved"></span>
    </div>
    <div class="stline small edonly"><span class="fg" id="kgread"></span></div>
    <div class="stline small"><span class="dim" id="kglog" aria-live="polite">&gt; ready</span></div>
  </div>
</main>

<aside class="sinsp" id="kginsp">
  <input type="file" accept=".bmp,.png,.json,image/bmp,image/png,application/json" id="kgfile" class="vh" tabindex="-1">

  <section class="panel" data-kpanel="experiments">
    <div class="kicker">08 · EDITOR</div>
    <div class="title">Experiments</div>
    <div class="dash"></div>
    <div class="note">Small tests of how a grammar becomes a shape. Each one opens as a new pattern with its signs drawn, next to its yarn in 3D.</div>
    <div id="kgexps"></div>
    <div class="explain small">An experiment is an ordinary pattern with a grammar: change the signs (layer: signs), what each sign means (12 grammar), or the knit program itself, and the 3D view follows. The fabric view relaxes the yarn the program makes (see 14 view): an uncalibrated estimate, not a prediction. The machine view shows how each pass makes it.</div>
  </section>

  <section class="panel" data-kpanel="library">
    <div class="kicker">09 · EDITOR</div>
    <div class="title">Library</div>
    <div class="dash"></div>
    <div class="note">Your patterns, kept in this browser. Nothing is uploaded.</div>
    <div class="inline"><button class="btn primary" data-knew="1">new pattern</button><button class="btn" data-knew="2">new two-guide</button><button class="btn" data-kopen>open file</button></div>
    <div class="list" id="kglib"></div>
    <div class="inline"><button class="btn" id="kgdup">duplicate</button><button class="btn" id="kgdel">delete</button></div>
    <div class="explain small">Open file reads a BMP or PNG (one pixel per needle, or enlarged by a whole factor) or a project file (.json, which also keeps the grammar). Colours close to the key snap to it and are listed; colours far from it stay as they are and are flagged. The newest pattern is on top; the open one is marked; G marks a pattern with a grammar.</div>
  </section>

  <section class="panel" data-kpanel="pattern">
    <div class="kicker">10 · EDITOR</div>
    <div class="title">Pattern</div>
    <div class="dash"></div>
    <div class="row"><label>name</label><input class="txt" id="kgname" aria-label="pattern name"></div>
    <div class="subhead">SIZE<i></i></div>
    <div class="row"><label>needles</label><div class="val numrow"><input class="txt num" id="kgw" type="number" min="1" max="600" aria-label="needles (width)"><span class="dim">×</span><input class="txt num" id="kgh" type="number" min="1" max="600" aria-label="passes (height)"><span class="dim">passes</span></div></div>
    <div class="inline"><button class="btn" id="kgresize">resize</button><div class="seg" id="kgsizes"><button>25</button><button>50</button><button>100</button></div></div>
    <div class="subhead">PASSES<i></i></div>
    <div class="row"><label>pass 1 goes</label><div class="seg" id="kgdir"><button data-dir="1">left → right</button><button data-dir="-1">right → left</button></div></div>
    <div class="row"><label>yarn guides</label><span class="val" data-kbind="mode"></span></div>
    <div class="subhead">INTENTION<i></i></div>
    <textarea class="txt area" id="kgnote" rows="5" placeholder="What should this sample do, and what do you expect when it's knitted?" aria-label="intention"></textarea>
    <div class="explain small">Resizing keeps pass 1 and needle 1 (the bottom-left corner) where they are; new cells are float (and the first sign). Passes alternate direction from pass 1; the first direction is shown as arrows next to the pass numbers. Yarn guides are fixed per pattern because the same colour means different things with one or two guides; start a two-guide pattern from the library. The intention is written into the exported key.</div>
  </section>

  <section class="panel" data-kpanel="key">
    <div class="kicker">11 · EDITOR</div>
    <div class="title">Key</div>
    <div class="dash"></div>
    <div class="note" id="kgkeynote"></div>
    <div class="subhead">OPERATIONS<i></i></div>
    <div class="oplist" id="kgops"></div>
    <div class="small dim" id="kgcredit"></div>
    <div id="kgcustom"></div>
    <div class="subhead">READ AS<i></i></div>
    <div class="list" id="kgkeys"></div>
    <div class="explain small">Pick an operation to draw with it on the knit layer (or press its number, or [ and ]). The class presets can't be changed; "make a custom copy" gives the pattern its own key, where you can rename operations, change their colours or add new ones built from knit / tuck / float, front / back and a transfer. Read as re-reads the pattern's colours through another key: cells whose colour the other key has keep it, the rest are flagged as unknown.</div>
  </section>

  <section class="panel" data-kpanel="grammar">
    <div class="kicker">12 · EDITOR</div>
    <div class="title">Grammar</div>
    <div class="dash"></div>
    <div id="kggram"></div>
    <div class="explain small">A shape grammar for knitting: you draw with signs on the design layer, each sign stands for a structure (a small tile of operations repeated from needle 1 and pass 1, so neighbouring regions mesh), and an outline structure can replace it where it touches another sign. With live on, the knit program is rewritten whenever the signs or their meanings change; drawing on the knit layer by hand turns live off so your edits stay. Make your own structure: draw it on the knit layer, select it with motif, then "save the selected motif". Keys: Tab switches layer · 1–8 signs on the signs layer.</div>
  </section>

  <section class="panel" data-kpanel="draw">
    <div class="kicker">13 · EDITOR</div>
    <div class="title">Draw</div>
    <div class="dash"></div>
    <div class="row"><label>layer</label><span class="val" data-kbind="layer"></span></div>
    <div class="inline"><div class="seg tools" aria-label="tool"><button data-ktool="needle">needle</button><button data-ktool="run">run</button><button data-ktool="flood">flood</button><button data-ktool="pass">pass</button><button data-ktool="wale">wale</button><button data-ktool="motif">motif</button><button data-ktool="pick">pick</button></div></div>
    <div class="row"><label>drawing with</label><span class="val" data-kbind="opname"></span></div>
    <div class="row"><label>mirror</label><div class="val"><button class="check" id="kgmirror2"><span class="box">[ ]</span></button> <span class="dim">around the centre needle</span></div></div>
    <div class="row"><label>pass / wale</label><div class="seg" id="kgevery"><button data-every="0">once</button><button data-every="2">every 2</button><button data-every="3">3</button><button data-every="4">4</button><button data-every="6">6</button></div></div>
    <div class="subhead">MOTIF<i></i></div>
    <div class="row"><label>selected</label><span class="val dim" data-kbind="sel">none</span></div>
    <div class="inline"><button class="btn" data-ksel="flip-h">flip ↔</button><button class="btn" data-ksel="flip-v">flip ↕</button><button class="btn" data-ksel="fill">fill</button><button class="btn" data-ksel="clear">clear</button><button class="btn" data-ksel="drop">deselect</button></div>
    <div class="row"><label>repeat</label><div class="seg" id="kgrepmode"><button data-rep="across">across</button><button data-rep="up">up</button><button data-rep="all">everywhere</button></div></div>
    <div class="row"><label>shift up</label><div class="val"><div class="stepper"><button data-kshift="-1" aria-label="less shift">‹</button><span id="kgshift">0</span><button data-kshift="1" aria-label="more shift">›</button></div> <span class="dim">needles</span></div></div>
    <div class="inline"><button class="btn primary" data-ksel="repeat">repeat motif</button></div>
    <div class="explain small">The tools work on the layer you're on: signs (the design) or knit (the program). Needle sets one cell (drag to draw); run draws a straight line; flood fills the touching cells of one kind; pass fills a whole row (one carriage pass) and wale a whole needle column, once or every n-th from the one you click. Motif: drag a rectangle, drag inside it to move it, flip it, fill or clear it, or repeat it across its passes, up its needles or over the whole pattern; shift moves each repeat further up by that many needles. Keys: N needle · L run · G flood · P pass · W wale · S motif · I pick (alt-click picks with any tool) · 1–9 · [ ] previous / next · M mirror · ⌘A select all · arrows move the motif · H / V flip · R repeat · Delete clear · Esc deselect · ⌘Z / ⇧⌘Z undo / redo · + / − / 0 zoom · Tab layer · D 2D / 3D.</div>
  </section>

  <section class="panel" data-kpanel="view">
    <div class="kicker">14 · EDITOR</div>
    <div class="title">View</div>
    <div class="dash"></div>
    <div class="list">
      <button class="check" style="display:block" id="kgsym2"><span class="box">[ ]</span> symbols</button>
      <button class="check" style="display:block" id="kgguides"><span class="box">[ ]</span> guides <span class="dim">· one row per yarn guide</span></button>
      <button class="check" style="display:block" id="kggrid2"><span class="box">[ ]</span> grid</button>
      <button class="check" style="display:block" id="kgnums"><span class="box">[ ]</span> pass and needle numbers</button>
    </div>
    <div class="subhead">3D YARN<i></i></div>
    <div class="row"><label>show</label><div class="seg" id="kg3dseg2"><button data-v3="0">2D</button><button data-v3="1">3D</button></div></div>
    <div class="row"><label>view</label><div class="seg" id="kgm3d2"><button data-m3="machine">machine</button><button data-m3="fabric">fabric</button></div></div>
    <div class="row"><label>colour</label><div class="seg" id="kglook2"><button data-look="grammar">operations</button><button data-look="yarn">yarn guides</button></div></div>
    <div class="subhead">YARN (FABRIC VIEW)<i></i></div>
    <div class="row"><label>thickness</label><div class="bar" id="bar-thick"></div><span class="barval"></span></div>
    <div class="row"><label>loop length</label><div class="bar" id="bar-loop"></div><span class="barval"></span></div>
    <div class="row"><label>stiffness</label><div class="bar" id="bar-stiff"></div><span class="barval"></span></div>
    <div class="note small">Uncalibrated: in needle pitches, not measured from a yarn or a machine.</div>
    <div class="subhead">TO CONFIRM WITH THE LAB'S SCRIPT<i></i></div>
    <div class="row"><label>transfers</label><div class="seg" id="kgtiming"><button data-timing="after-row">after the pass</button><button data-timing="per-needle">at each needle</button></div></div>
    <div class="row"><label>two guides</label><div class="seg" id="kgtravel"><button data-travel="same-stroke">one stroke</button><button data-travel="two-strokes">a stroke each</button></div></div>
    <div class="explain small">Symbols appear when cells are at least 10 px. Guides splits every pass of a two-guide pattern into a YG1 row (top) and a YG2 row (bottom).<br><br>3D runs the program on a model V-bed. Each pass, every needle in the carriage's order knits (a new loop through the loops it holds, which it lets go), tucks (a new loop added to them) or misses (the yarn passes; its loops stay); knitting an empty needle makes a loop with nothing through it. Then transfers move a needle's loops to the other bed, or one needle left or right on the same bed; loops moved onto a needle that holds loops stack on top. A yarn guide turns at the last needle it works.<br><br>Machine shows that pass by pass, or action by action: the loops on each needle, the new loop, transfers as arrows, the carrier, and the fabric made so far, pulled down as it was knitted (not relaxed). Beds flat lays both beds facing you, the back bed on top as in the symbols; V folds them as on the machine.<br><br>Fabric shows the same yarn relaxed off the machine, free and without gravity: every stitch keeps its length of yarn, the yarn resists bending, floats can't stretch, and strands lying side by side can't overlap. Which loop goes through which, and in what order, is exact under these rules. The shape is an estimate: no friction, no contact between yarns except where they interlock, nothing calibrated to a real yarn, machine or tension. Nothing about curling, gathering or bulging is written in; what you see comes from the rules above.<br><br>Not yet confirmed by the lab's script: whether a pass's transfers happen after it has knitted or at each needle, and whether two yarn guides share one carriage stroke (YG1 first) or take one each. Switch to compare.<br><br>Keys: D 2D / 3D · , and . pass · &lt; and &gt; action.</div>
  </section>

  <section class="panel" data-kpanel="check">
    <div class="kicker">15 · EDITOR</div>
    <div class="title">Check</div>
    <div class="dash"></div>
    <div class="note">Warnings only. Nothing is blocked.</div>
    <div class="subhead">LIMITS<i></i></div>
    <div class="row"><label>longest float</label><div class="val"><div class="stepper"><button data-klim="float:-1">‹</button><span data-kbind="lim-float"></span><button data-klim="float:1">›</button></div> <span class="dim">needles</span></div></div>
    <div class="row"><label>loop held</label><div class="val"><div class="stepper"><button data-klim="held:-1">‹</button><span data-kbind="lim-held"></span><button data-klim="held:1">›</button></div> <span class="dim">passes</span></div></div>
    <div class="row"><label>tucks stacked</label><div class="val"><div class="stepper"><button data-klim="tucks:-1">‹</button><span data-kbind="lim-tucks"></span><button data-klim="tucks:1">›</button></div> <span class="dim">per needle</span></div></div>
    <div class="subhead">FOUND<i></i></div>
    <div id="kgfind"></div>
    <div class="explain small">The limits are rules of thumb, not machine facts: set them for your yarn, gauge and machine. Show marks the cells in the view. A float is counted per yarn guide between two of its stitches in the same pass; a held loop is a needle that doesn't knit while it holds a loop (tucks and floats); stacked tucks are tucks on one needle before it knits again.</div>
  </section>

  <section class="panel" data-kpanel="export">
    <div class="kicker">16 · EDITOR</div>
    <div class="title">Export</div>
    <div class="dash"></div>
    <div class="note">One pixel per needle, one row per pass, the key's exact colours.</div>
    <div class="subhead">FILE<i></i></div>
    <div class="seg" id="kgfmt"><button data-fmt="bmp">BMP</button><button data-fmt="pdf">key PDF</button><button data-fmt="txt">key TXT</button><button data-fmt="png">chart PNG</button><button data-fmt="svg">chart SVG</button><button data-fmt="json">project</button></div>
    <div class="row" style="margin-top:8px"><label>name</label><input class="txt" id="kgexname" aria-label="file name"></div>
    <div class="inline"><button class="btn primary" id="kgexport">export</button><button class="btn" id="kgbundle" title="BMP + key PDF + key TXT">BMP + key</button></div>
    <div class="explain small">BMP: 24-bit, one pixel per needle, the bottom row is pass 1, every colour exactly the key's RGB (colours an import couldn't read are written back as they were). Key PDF / TXT: the colours this pattern's key uses, with their operations, how many cells use each, the key's credit and notes, and your intention. Chart: the pattern enlarged with symbols, pass and needle numbers and a legend, for documentation (in the guides view the chart shows one row per yarn guide). Project: everything needed to reopen the pattern exactly, including the key, the number of yarn guides and the grammar, which a BMP can't hold.</div>
  </section>
</aside>

<dialog class="dlg" id="kgdlg" aria-labelledby="kgdlgtitle">
  <div class="kicker" id="kgdlgkicker"></div>
  <div class="title" id="kgdlgtitle"></div>
  <div class="dash"></div>
  <div class="note" id="kgdlgbody"></div>
  <form method="dialog" class="inline dlgbtns"><button class="btn" value="cancel" autofocus>cancel</button><button class="btn accent" value="ok" id="kgdlgok">ok</button></form>
</dialog>
`;
