#!/usr/bin/env python3
"""Knitting Taxonomy, desk reader: a PN532 NFC module on a USB-serial adapter (HSU mode, 115200 baud).

Lay a framed sample on the reader and the laptop opens the address on its tag (the same page a phone opens).
No packages needed: the serial port is opened with termios (macOS / Linux).

  python3 taxonomy_reader.py                 wait for tags; each one's address opens in one Chrome window kept for
                                             the reader, filling the screen (macOS; first time, allow the terminal
                                             to control Chrome); elsewhere, or with --tab, in the default browser.
                                             The tag already shown, laid on again: the page flies its frame in again
  python3 taxonomy_reader.py kiosk           the exhibition kiosk, offline: serves the built site (dist/, made by
                                             "npm run build") on this computer, opens it full screen in Chrome and
                                             tells the page which sample lies on the reader (see KIOSK below). The
                                             terminal stays open for commands while it runs (type help)
  python3 taxonomy_reader.py check           print the PN532's firmware version and exit
  python3 taxonomy_reader.py info            print the next tag's UID, chip version, first pages, address and data
  python3 taxonomy_reader.py write SMP_0001  write that sample's tag from the records (address + data, as in
                                             docs/TAG_FORMAT.md; needs node, run from this repository)
  python3 taxonomy_reader.py write <url>     write only <url> to the next NTAG21x tag laid on the reader
  options: --port /dev/cu.usbserial-10 (default: the first /dev/cu.usbserial* or /dev/ttyUSB*), --tab,
           --browser "Brave Browser" (any Chromium browser on macOS; default Google Chrome);
           kiosk only: --http 8017 (the local port), --no-browser, --keys (no reader: test tags only, see KIOSK)
  start_reader.command and start_kiosk.command (next to this file) start them from Finder with a double-click.
  While waiting for tags, the reader may be unplugged and plugged back in (or plugged in only after starting): it
  waits for it and goes on.

A tag without an address is looked up by its UID in tags.json next to this file ({"04a1b2c3d4e5f6": "https://..."});
an unknown tag's UID is printed so it can be added there.

KIOSK. The rig has one slot. A sample laid on it flies in and its full record opens; lifted off, it flies back to
its spine HOLD seconds after the reader last saw it (the wait also covers reads the reader misses). Only tags whose
address ends in #taxonomy/SMP_#### count; any other tag is ignored and named in this terminal. While the shown tag
lies there, other tags are ignored (the reader asks for that tag by its UID first, so it is found whatever else lies
near); once it is gone, a new sample takes over at once (a quick swap does not wait).
Tags carry the public address; the kiosk shows the same sample from the local copy. While it runs, the terminal
takes commands (CONSOLE below): test tags, the reader's state, reconnecting it, reloading or rebuilding the page,
opening and closing the full-screen window. With --keys there is no reader, only test tags; there a line of sample IDs
or addresses is what lies on the reader now, and an empty line lifts them.
"""
CONSOLE = """\
  SMP_0042            a test tag on the reader, as if that sample were laid on it (several: SMP_0001 SMP_0002;
                      an address works too); it follows the same rules as a real tag
  lift                the test tags off again (the sample goes back after 3 s, as on the rig)
  status              the page, the reader, the sample shown, what lies on the reader
  check               ask the reader for its firmware version
  reader              connect the reader again (after replugging it)
  reload              reload the full-screen page
  build               rebuild the site (npm run build), then reload the page
  open / close        open the full-screen page again / close it
  quit                close the page and stop (also ctrl-c)
  help                this list"""
import errno, functools, glob, hashlib, http.server, json, os, queue, re, select, subprocess, sys, tempfile, termios, threading, time
import urllib.parse, webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))                                # the repository
BASE = '/KnittingPixelArtEditor/'                                            # the site's base (vite.config.ts)
PUBLIC = 'https://nijatm.github.io' + BASE                                   # TAG_BASE in src/taxonomy/core.js
HOLD = 3.0                                                                   # kiosk: s after the shown tag is last seen
GONE = 1.0                                                                   # desk: s unseen before a tag counts as lifted
PREFIX = {0: '', 1: 'http://www.', 2: 'https://www.', 3: 'http://', 4: 'https://'}


LOST = (OSError, termios.error)                                              # the adapter unplugged (or its port gone)
# HSU wake-up. It goes out in the same write as the command behind it: a PN532 just powered (plugged in, or the Mac
# woke) slept through it when 50 ms came between, and stayed silent as if not wired (rig, 2026-11-02)
WAKE = bytes([0x55, 0x55] + [0] * 12)


class PN532:
    def __init__(self, port):
        self.fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        try:
            a = termios.tcgetattr(self.fd)
            a[0] = 0; a[1] = 0; a[3] = 0                                     # raw: no input/output/local processing
            a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL              # 8N1
            a[4] = a[5] = termios.B115200
            termios.tcsetattr(self.fd, termios.TCSANOW, a)
            termios.tcflush(self.fd, termios.TCIOFLUSH)
            self.call(0x14, [0x01, 0x14, 0x01], wake=True)                   # SAMConfiguration: normal mode
            self.call(0x32, [0x05, 0xFF, 0x01, 0x05])                        # retries: answer "no tag" quickly
            self.call(0x32, [0x01, 0x00]); time.sleep(0.05); self.call(0x32, [0x01, 0x01])  # field off and on: tags start fresh
        except BaseException: self.close(); raise

    def close(self):
        try: os.close(self.fd)
        except OSError: pass

    def read(self, n, timeout):
        out, end = b'', time.time() + timeout
        while len(out) < n and time.time() < end:
            r, _, _ = select.select([self.fd], [], [], max(0, end - time.time()))
            if not r: continue
            try: got = os.read(self.fd, n - len(out))
            except BlockingIOError: continue
            if not got: raise OSError(errno.EIO, 'the port closed')          # readable but empty: hung up
            out += got
        return out

    def call(self, cmd, data=(), timeout=1.0, wake=False):
        body = bytes([0xD4, cmd] + list(data))
        frame = bytes([0, 0, 0xFF, len(body), (-len(body)) & 0xFF]) + body + bytes([(-sum(body)) & 0xFF, 0])
        termios.tcflush(self.fd, termios.TCIFLUSH)
        os.write(self.fd, (WAKE if wake else b'') + frame)
        buf, heard = b'', False
        end = time.time() + timeout
        while time.time() < end:                                             # skip the ACK, find the answer
            got = self.read(1, end - time.time())
            heard = heard or bool(got)
            buf += got
            i = buf.find(b'\x00\xff', 0)
            while i >= 0 and i + 2 < len(buf) and buf[i + 2:i + 3] == b'\x00' and buf[i + 3:i + 4] == b'\xff':
                buf = buf[i + 4:]; i = buf.find(b'\x00\xff')                 # 00 FF 00 FF: an ACK
            if i >= 0 and len(buf) >= i + 4:
                n = buf[i + 2]
                if n and (n + buf[i + 3]) & 0xFF == 0:
                    rest = buf[i + 4:] + self.read(n + 2 - len(buf[i + 4:]), end - time.time())
                    payload = rest[:n]
                    if len(payload) == n and payload[0] == 0xD5 and payload[1] == cmd + 1:
                        return payload[2:]
                    return None
        # not a byte back: asleep again (powered anew, or a session ended mid-command): once more, woken first
        return None if wake or heard else self.call(cmd, data, timeout, wake=True)

    def reset(self):
        """The field off and on: on the rig, a tag once listed was not found again while it lay there (it stays
        selected), so it seemed lifted. Off, every tag starts afresh."""
        self.call(0x32, [0x01, 0x00]); time.sleep(0.01)                      # RFConfiguration: field off
        self.call(0x32, [0x01, 0x01]); time.sleep(0.01)                      # field on, tags power up

    def tags(self):
        """The tags on the reader, up to two: [(target number, UID)]."""
        self.reset()
        r = self.call(0x4A, [0x02, 0x00], timeout=1.5)                       # InListPassiveTarget, 106 kbps type A
        out, i = [], 1
        for _ in range(r[0] if r else 0):
            if i + 5 > len(r): break
            tg, sel, n = r[i], r[i + 3], r[i + 4]
            out.append((tg, bytes(r[i + 5:i + 5 + n])))
            i += 5 + n
            if sel & 0x20 and i < len(r): i += r[i]                          # an ISO 14443-4 card's ATS (length first)
        return out

    def there(self, uid):
        """Whether the tag with this UID is on the reader, whatever else is: it alone is asked for (InListPassiveTarget
        with its UID; a 7-byte UID after the cascade tag 0x88, as answered on the rig). Then it is target 1."""
        if len(uid) not in (4, 7): return uid in [u for _, u in self.tags()]
        self.reset()
        r = self.call(0x4A, [0x01, 0x00] + list(uid if len(uid) == 4 else b'\x88' + uid), timeout=1.5)
        return bool(r) and r[0] == 1

    def page4(self, page, tg=1):
        r = self.call(0x40, [tg, 0x30, page])                                # InDataExchange: NTAG READ (16 bytes)
        return bytes(r[1:17]) if r and r[0] == 0 and len(r) >= 17 else None

    def version(self):
        r = self.call(0x42, [0x60])                                          # InCommunicateThru: NTAG GET_VERSION
        return bytes(r[1:]) if r and r[0] == 0 else None

    def write_page(self, page, four, tg=1):
        r = self.call(0x40, [tg, 0xA2, page] + list(four))                   # NTAG WRITE (4 bytes)
        return bool(r) and r[0] == 0


def message(mem):
    """The NDEF message's records complete in the bytes read so far, [(TNF, type, payload)], and whether the whole
    message is in (or there is none)."""
    i = 0
    while i + 1 < len(mem):
        t = mem[i]
        if t == 0x00: i += 1; continue
        if t == 0xFE: return [], True
        if mem[i + 1] == 0xFF and i + 4 > len(mem): break
        n, h = (mem[i + 1], 2) if mem[i + 1] != 0xFF else (int.from_bytes(mem[i + 2:i + 4], 'big'), 4)
        if t == 0x03: return records(mem[i + h:i + h + n]), i + h + n <= len(mem)
        if i + h + n > len(mem): break
        i += h + n
    return [], False


def records(msg):
    out, j = [], 0
    while j + 3 <= len(msg):
        flags, tl = msg[j], msg[j + 1]
        k = j + 3 if flags & 0x10 else j + 6                                 # short record: 1 length byte, else 4
        if k > len(msg): break
        pl = msg[j + 2] if flags & 0x10 else int.from_bytes(msg[j + 2:j + 6], 'big')
        il = 0
        if flags & 0x08:                                                     # ID length present
            if k >= len(msg): break
            il = msg[k]; k += 1
        end = k + tl + il + pl
        if end > len(msg): break
        out.append((flags & 0x07, bytes(msg[k:k + tl]), bytes(msg[k + tl + il:end])))
        if flags & 0x40: break                                               # message end
        j = end
    return out


def read_tag(nfc, tg=1, whole=False):
    """(address, data): the tag's first URI record and, with whole=True, its application/json record (else None);
    either is None if the tag has none. False if the tag went away before what is needed was read whole (a frame
    lifted or slid mid-read): a cut-off address is never returned. Without whole, reading stops at the address."""
    mem, recs = b'', []
    for page in range(4, 228, 4):                                            # up to an NTAG216's last user page
        chunk = nfc.page4(page, tg)
        if chunk is None: return False
        mem += chunk
        recs, done = message(mem)
        url = next((PREFIX.get(p[0], '') + p[1:].decode('utf-8', 'replace') for f, t, p in recs if f == 1 and t == b'U' and p), None)
        if done or (url and not whole): break
    data = next((p.decode('utf-8', 'replace') for f, t, p in recs if f == 2 and t == b'application/json'), None)
    return url, data


def url_tlv(url):
    """The NDEF TLV of one short URI record (an address only)."""
    code, rest = 0, url
    for k in (4, 3, 2, 1):
        if url.startswith(PREFIX[k]): code, rest = k, url[len(PREFIX[k]):]; break
    payload = bytes([code]) + rest.encode()
    if len(payload) > 255: sys.exit('address too long for one short record')
    rec = bytes([0xD1, 0x01, len(payload)]) + b'U' + payload
    return bytes([0x03, len(rec)]) + rec + b'\xfe'


def sample_tlv(sid):
    """The TLV for a sample, from the records, by scripts/taxonomy-tag.mjs (the site's own code, src/taxonomy/core.js)."""
    try: r = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'taxonomy-tag.mjs'), sid], capture_output=True, text=True)
    except FileNotFoundError: sys.exit('writing a sample needs node (the one this repository builds with)')
    if r.returncode: sys.exit(r.stderr.strip() or 'scripts/taxonomy-tag.mjs failed')
    t = json.loads(r.stdout)
    print(f'{sid}: {t["bytes"]} bytes' + (f'; left off (the address leads to the full record): {", ".join(t["cut"])}' if t['cut'] else '; everything fits'))
    return t['url'], bytes.fromhex(t['tlv'])


def write_tlv(nfc, tlv, url):
    tlv += b'\x00' * (-len(tlv) % 4)
    cc = nfc.page4(3)
    if not cc or cc[0] != 0xE1: sys.exit(f'no NDEF capability container on page 3 ({cc[:4].hex(" ") if cc else "unreadable"}); not writing')
    if cc[3] & 0xF0: sys.exit(f'the tag is write-protected (CC {cc[:4].hex(" ")})')
    if len(tlv) > cc[2] * 8: sys.exit(f'needs {len(tlv)} bytes, the tag holds {cc[2] * 8}')
    old = read_tag(nfc)
    now = old[0] if old else None
    print(f'CC {cc[:4].hex(" ")} ({cc[2] * 8} bytes); address on it now: {now}')
    was, will = sample_of(now), sample_of(url)
    if was and will and was != will and input(f'this is {was}\'s tag; write {will} over it? [y/N] ').strip().lower() != 'y': sys.exit('not written')
    for k in range(0, len(tlv), 4):
        if not nfc.write_page(4 + k // 4, tlv[k:k + 4]): return False
    back = b''
    for page in range(4, 4 + len(tlv) // 4, 4):                              # read it back, byte for byte
        chunk = nfc.page4(page)
        if chunk is None: return False
        back += chunk
    return back[:len(tlv)] == tlv


SAMPLE = re.compile(r'#taxonomy/(SMP_\d{4})$')
OLD = re.compile(r'#grammar/learn/taxonomy(?:/frame-(\d+))?$')                # the first tag's address (2026-10-31)


def sample_of(url):
    """The sample a tag's address opens (as the site's router reads it), or None: not a Knitting Taxonomy tag."""
    m = SAMPLE.search(url or '')
    if m: return m.group(1)
    m = OLD.search(url or '')
    return f'SMP_{int(m.group(1) or 1):04d}' if m else None


# Chrome (or another Chromium browser), through JavaScript for Automation: the reader's own window (else one already on the site, else a new one),
# sized to the screen above the Dock and brought to the front. A sample's address already open: the same address
# with "/again" after it, which the page takes as the same sample and flies its frame in again (no reload); any
# other address already open reloads.
SHOW = r'''
function run(argv) {
  const url = argv[0], want = argv[1] || '', chrome = Application(argv[2]);
  const site = url.split('#')[0];
  let win = chrome.windows().find(w => String(w.id()) === want) || chrome.windows().find(w => w.activeTab().url().startsWith(site));
  if (!win) { chrome.Window().make(); win = chrome.windows[0]; }
  const tab = win.activeTab();
  if (tab.url() !== url) tab.url = url; else if (/#taxonomy\/SMP_\d{4}$/.test(url)) tab.url = url + '/again'; else tab.reload();
  ObjC.import('AppKit');
  const f = $.NSScreen.mainScreen.frame, v = $.NSScreen.mainScreen.visibleFrame;
  win.bounds = { x: v.origin.x, y: f.size.height - v.origin.y - v.size.height, width: v.size.width, height: v.size.height };
  win.index = 1;
  chrome.activate();
  return String(win.id());
}'''
shown = {}


def show(url, tab=False, browser='Google Chrome'):
    if sys.platform == 'darwin' and not tab and os.path.isdir(f'/Applications/{browser}.app'):
        r = subprocess.run(['osascript', '-l', 'JavaScript', '-e', SHOW, url, shown.get('win', ''), browser], capture_output=True, text=True)
        if r.returncode == 0: shown['win'] = r.stdout.strip(); return
        print(f'could not drive {browser} ({r.stderr.strip()}); allow it in System Settings → Privacy & Security → Automation')
    if sys.platform == 'darwin': subprocess.run(['open', url])
    else: webbrowser.open(url)


def find_port(want):
    if want: return want if os.path.exists(want) else None
    return next(iter(sorted(glob.glob('/dev/cu.usbserial*') + glob.glob('/dev/ttyUSB*'))), None)


def attempt(want):
    """The reader if its adapter is plugged in and the PN532 on it answers: (port, PN532, firmware "1.6"), else None."""
    port = find_port(want)
    if not port: return None
    try:
        nfc = PN532(port)
        v = nfc.call(0x02)                                                   # firmware version: it is a PN532, awake
        if v: return port, nfc, f'{v[1]}.{v[2]}'
        nfc.close()
    except LOST: pass
    return None


def connect(want):
    """The reader, once its adapter is plugged in and the PN532 on it answers."""
    said = False
    while True:
        got = attempt(want)
        if got: return got[:2]
        if not said:
            port = find_port(want)
            print(silent(port) if port else f'waiting for the reader on {want or "a USB-serial port"}', '(waiting; ctrl-c to stop)', flush=True); said = True
        time.sleep(1)


def holder(port):
    """Another program with the port open (a browser's serial tester, a reader left running), or None."""
    try: out = subprocess.run(['lsof', '-F', 'pc', port], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError): return None
    pid = None
    for line in out.splitlines():
        if line[:1] == 'p': pid = int(line[1:])
        elif line[:1] == 'c' and pid != os.getpid(): return f'{line[1:]} (pid {pid})'
    return None


def silent(port):
    """Why the reader on `port` does not answer, in the order worth checking."""
    h = holder(port)
    if h: return f'{port}: in use by {h}; close it (a browser tester: quit the browser)'
    return f'{port}: no answer from the PN532; unplug it, wait 5 s, plug it in (power LED on?); then wiring, HSU switches'


def load_table():
    try: return json.load(open(os.path.join(HERE, 'tags.json')))
    except (OSError, ValueError): return {}


class Desk:
    """The tags on the PN532 at each look, {UID: address or None}, and which of them are new. Each tag is read once
    while it stays; one the reader misses for less than `keep` s still counts as there (not read again)."""
    def __init__(self, nfc, keep):
        self.nfc, self.keep, self.table, self.known, self.when = nfc, keep, load_table(), {}, {}

    def there(self, uid):
        if not self.nfc.there(uid): return False
        self.when[uid] = time.time()
        return True

    def look(self):
        now, out, new = time.time(), {}, []
        for tg, uid in self.nfc.tags():
            if uid not in self.known:
                got = read_tag(self.nfc, tg)
                if got is False: continue                                    # not read whole: next look
                self.known[uid] = got[0] or self.table.get(uid.hex())
                new.append(uid)
            self.when[uid] = now
        for uid, t in list(self.when.items()):
            if now - t > self.keep: del self.when[uid]; del self.known[uid]
            else: out[uid] = self.known[uid]
        return out, new


def test_tags(items):
    """Test tags (the kiosk's console): {made-up UID: address} for sample IDs or addresses."""
    return {hashlib.sha1(i.encode()).digest()[:7]: (PUBLIC + '#taxonomy/' + i if re.fullmatch(r'SMP_\d{4}', i) else i) for i in items}


def watch(want, tab, browser):
    port, nfc = connect(want)
    desk = Desk(nfc, GONE)
    print(f'{port}: waiting for tags (ctrl-c to stop)', flush=True)
    while True:
        try:
            tags, new = desk.look()
            for uid in new:                                                  # a tag lying there opens once
                url = tags[uid]
                print(f'tag {uid.hex()}: {url or "no address on it and not in tags.json"}', flush=True)
                if url: show(url, tab, browser)
        except LOST as e:
            nfc.close()
            print(f'{port}: the reader went away ({e})', flush=True)
            port, nfc = connect(want)
            desk = Desk(nfc, GONE)
            print(f'{port}: back, waiting for tags', flush=True)
        time.sleep(0.3)


# ---------------------------------------------------------------- the kiosk
class Rig:
    """The one slot's rules (KIOSK above): tells the page show <sample> or clear."""
    def __init__(self, say):
        self.say, self.uid, self.sample, self.seen = say, None, None, 0.0

    def look(self, now, tags):
        """tags: {UID: sample or None (not a Knitting Taxonomy tag)} on the reader now."""
        if self.uid in tags: self.seen = now; return                         # the shown one is still there
        new = next(((u, s) for u, s in tags.items() if s), None)
        if new:
            (self.uid, self.sample), self.seen = new, now
            self.say('show', self.sample)
        elif self.sample and now - self.seen >= HOLD:
            self.uid = self.sample = None
            self.say('clear', '')


class Hub:
    """What the reader last told the page; each kiosk page listening (server-sent events) gets every change. A page
    that connects gets the state (show or clear); `keep=False` events (reload) go only to the pages listening then."""
    def __init__(self, log):
        self.cv, self.n, self.state, self.last, self.boot = threading.Condition(), 0, ('clear', ''), ('clear', ''), f'{int(time.time())}'
        self.log, self.pages = log, 0

    def say(self, event, data='', keep=True):
        with self.cv:
            self.n += 1; self.last = (event, data); self.cv.notify_all()
            if keep: self.state = (event, data)
        self.log(f'page: {event} {data}'.rstrip())

    def wait(self, n, timeout):
        with self.cv:
            self.cv.wait_for(lambda: self.n != n, timeout)
            return self.n, (self.state if n < 0 else self.last)

    def page(self, d):
        with self.cv: self.pages += d
        self.log(f'page {"connected" if d > 0 else "gone"} ({self.pages} open)')


class Site(http.server.SimpleHTTPRequestHandler):
    """The built site under BASE, and BASE + "reader": the reader's events."""
    hub = None

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == '/':
            self.send_response(302); self.send_header('Location', BASE + '?kiosk#taxonomy'); self.send_header('Content-Length', '0'); self.end_headers(); return
        if not path.startswith(BASE): return self.send_error(404)
        if path == BASE + 'reader': return self.events()
        return super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')                       # a rebuilt site shows at the next load
        super().end_headers()

    def translate_path(self, path):
        return super().translate_path('/' + urllib.parse.urlsplit(path).path[len(BASE):])

    def events(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        hub, last = self.hub, self.headers.get('Last-Event-ID')
        n, state = hub.wait(-1, 0)
        hub.page(1)
        try:
            self.wfile.write(b'retry: 2000\n\n')
            if last != f'{hub.boot}-{n}': self.send(hub.boot, n, state)        # a page that reconnects has it already
            while True:
                m, state = hub.wait(n, 15)
                if m == n: self.wfile.write(b': still here\n\n')
                else: n = m; self.send(hub.boot, n, state)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError): pass
        finally: hub.page(-1)

    def send(self, boot, n, state):
        self.wfile.write(f'id: {boot}-{n}\nevent: {state[0]}\ndata: {state[1]}\n\n'.encode()); self.wfile.flush()

    def log_message(self, *a): pass


PROFILE = os.path.join(tempfile.gettempdir(), 'knitting-taxonomy-kiosk')    # the kiosk browser's own profile


def open_full_screen(url, browser):
    """Chrome (or another Chromium browser) in kiosk mode, its own profile so it starts as a new instance (cmd-Q
    leaves); elsewhere the default browser."""
    if sys.platform == 'darwin' and os.path.isdir(f'/Applications/{browser}.app'):
        subprocess.run(['open', '-na', browser, '--args', '--kiosk', f'--user-data-dir={PROFILE}', '--no-first-run',
                        '--no-default-browser-check', '--disable-pinch', '--overscroll-history-navigation=0', url])
    else: webbrowser.open(url)


def close_full_screen():
    """The kiosk browser (the one with the kiosk's profile) quits; other browser windows stay."""
    return subprocess.run(['pkill', '-f', f'--user-data-dir={PROFILE}'], capture_output=True).returncode == 0


class Console:
    """The terminal while the kiosk runs: each line typed goes to the kiosk's loop (the only one using the reader).
    Messages print above the prompt."""
    def __init__(self):
        self.tty, self.lines, self.lock = sys.stdin.isatty(), queue.Queue(), threading.Lock()
        threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        while True:
            try: line = input()
            except EOFError: self.lines.put(None if self.tty else ''); return  # ctrl-d quits; a pipe ending lifts
            self.lines.put(line.strip())
            self.prompt()

    def prompt(self):
        if self.tty:
            with self.lock: sys.stdout.write('kiosk> '); sys.stdout.flush()

    def log(self, text, stamp=True):
        with self.lock:
            head = time.strftime('%H:%M:%S  ') if stamp else ''
            body = '\n'.join(head + t if i == 0 else ' ' * len(head) + t for i, t in enumerate(text.split('\n')))
            sys.stdout.write(('\r\033[K' if self.tty else '') + body + '\n' + ('kiosk> ' if self.tty else ''))
            sys.stdout.flush()


def kiosk(want, port, keys, browser, open_browser):
    site = os.path.join(ROOT, 'dist')
    if not os.path.isfile(os.path.join(site, 'index.html')): sys.exit('no built site in dist/: run "npm run build" here first')
    con = Console()
    log = con.log
    hub = Hub(log)
    handler = type('KioskSite', (Site,), {'hub': hub})
    try: server = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(handler, directory=site))
    except OSError as e: sys.exit(f'port {port}: {e.strerror} (another kiosk running? use --http <port>)')
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{port}{BASE}?kiosk#taxonomy'
    log(f'Knitting Taxonomy kiosk\n  page    {url}\n  reader  {"none (--keys): test tags only" if keys else want or "the first USB-serial port"}\n'
        f'commands (Enter after each):\n{CONSOLE}', stamp=False)
    if open_browser: open_full_screen(url, browser); log('page: opening full screen (cmd-Q there, or close here)')
    rig, test, seen = Rig(hub.say), {}, {}
    reader, retry, waiting = None, 0.0, False                                # reader: (port, PN532, firmware, Desk)

    def status():
        r = 'none (--keys)' if keys else f'{reader[0]}, PN532 firmware {reader[2]}' if reader else 'not connected, waiting for it'
        on = [f'{u.hex()} {sample_of(a) or "not a sample"}' for u, a in seen.items() if u not in test] + [f'test {sample_of(a) or a}' for a in test.values()]
        return (f'page    {url}, {hub.pages} open\nreader  {r}\nshown   {rig.sample or "nothing"}' +
                (' (lifted, goes back in a moment)' if rig.sample and rig.uid not in seen else '') + f'\non it   {", ".join(on) or "nothing"}')

    def command(line):
        """One line typed; False to stop."""
        nonlocal test, reader, retry, waiting
        if line is None: return False
        words = line.split()
        cmd = words[0].lower() if words else ''
        if not words or re.fullmatch(r'SMP_\d{4}', words[0]) or words[0].startswith('http') or cmd == 'put':
            items = words[1:] if cmd == 'put' else words
            if not items and not keys: return True                           # Enter alone: nothing
            test = test_tags(items)
            log(f'test tags on the reader: {" ".join(items)}' if items else 'test tags lifted')
        elif cmd == 'lift': test = {}; log('test tags lifted')
        elif cmd in ('status', 's'): log(status())
        elif cmd == 'check':
            if not reader: log('no reader connected')
            else:
                v = reader[1].call(0x02)
                log(f'{reader[0]}: PN532 firmware {v[1]}.{v[2]}' if v else silent(reader[0]))
        elif cmd == 'reader':
            if keys: log('no reader with --keys')
            else:
                if reader: reader[1].close()
                reader, retry, waiting = None, 0.0, False
                log('reader: connecting again')
        elif cmd == 'reload': hub.say('reload', keep=False)
        elif cmd == 'build':
            log('npm run build …')
            r = subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True, text=True)
            tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
            log(('built: ' if r.returncode == 0 else 'build failed:\n') + '\n'.join(tail))
            if r.returncode == 0: hub.say('reload', keep=False)
        elif cmd == 'open': open_full_screen(url, browser); log('page: opening full screen')
        elif cmd == 'close': log('page: closed' if close_full_screen() else 'page: no full-screen page open')
        elif cmd in ('quit', 'q', 'exit'): return False
        elif cmd in ('help', '?', 'h'): log(CONSOLE, stamp=False)
        else: log(f'{words[0]}: not a command (help lists them)')
        return True

    try:
        while True:
            while not con.lines.empty():
                if not command(con.lines.get()): return
            now = time.time()
            if not keys and not reader and now >= retry:
                got, retry = attempt(want), now + 1.0
                if got: reader = (*got, Desk(got[1], HOLD)); waiting = False; log(f'reader: {got[0]}, PN532 firmware {got[2]}; waiting for tags')
                elif not waiting: waiting = True; log(f'reader: waiting for it on {want or "a USB-serial port"} (test tags work meanwhile)')
            try:
                if rig.uid and (rig.uid in test or reader and reader[3].there(rig.uid)):   # the shown tag still lies
                    rig.look(now, {rig.uid: rig.sample}); time.sleep(0.2); continue       # there: the rest waits
                found, new = reader[3].look() if reader else ({}, [])
                for uid in new:
                    s = sample_of(found[uid])
                    log(f'tag {uid.hex()}: {s}' if s else f'tag {uid.hex()}: ignored, not a sample ({found[uid] or "no address"})')
                seen = {**found, **test}
                rig.look(now, {u: sample_of(a) for u, a in seen.items()})
            except LOST as e:
                reader[1].close()
                log(f'reader: {reader[0]} went away ({e}); waiting for it')
                reader, waiting, seen = None, True, dict(test)
                rig.look(time.time(), {u: sample_of(a) for u, a in test.items()})
            time.sleep(0.2)
    except KeyboardInterrupt: pass
    finally:
        if open_browser: close_full_screen()
        log('kiosk stopped', stamp=False)


def main():
    args = sys.argv[1:]
    if {'-h', '--help', 'help'} & set(args): return print(__doc__)
    def opt(name, default=None):
        if name not in args: return default
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    def flag(name):
        if name not in args: return False
        args.remove(name); return True
    port, browser, http_port = opt('--port'), opt('--browser', 'Google Chrome'), int(opt('--http', '8017'))
    tab, keys, no_browser = flag('--tab'), flag('--keys'), flag('--no-browser')
    # an option it does not know stops it (an unknown one once started a whole kiosk, which then held the reader)
    if bad := [a for a in args if a.startswith('-')]: sys.exit(f'unknown option {bad[0]} (see --help)')
    if args[:1] == ['kiosk']: return kiosk(port, http_port, keys, browser, not no_browser)
    if args[:1] not in (['check'], ['info'], ['write']): return watch(port, tab, browser)
    port = find_port(port)
    if not port: sys.exit('no USB-serial adapter found (use --port)')
    try: nfc = PN532(port)
    except LOST: sys.exit(silent(port))
    if args[:1] == ['check']:
        v = nfc.call(0x02)
        print(f'{port}: PN5{v[0]:x} firmware {v[1]}.{v[2]}' if v else silent(port))
        return
    if args[:1] == ['info']:
        print('lay the tag on the reader')
        while not (got := nfc.tags()): time.sleep(0.2)
        print(f'UID {got[0][1].hex(" ")}' + (f' (and {len(got) - 1} more tag on the reader)' if len(got) > 1 else ''))
        for page in (0, 4, 8, 12):
            c = nfc.page4(page)
            print(f'pages {page:2}-{page + 3:2}: {c.hex(" ") if c else "unreadable"}')
        t = read_tag(nfc, whole=True)
        print('address: not read whole (the tag moved?)' if t is False else f'address: {t[0]}\ndata: {t[1]}')
        v = nfc.version()                                                    # last: a chip without it stops answering
        print(f'GET_VERSION {v.hex(" ") if v else "no answer"}')
        return
    if args[:1] == ['write']:
        what = args[1]
        url, tlv = sample_tlv(what) if re.fullmatch(r'SMP_\d{4}', what) else (what, url_tlv(what))
        print(f'lay the tag on the reader to write {url}')
        while not nfc.tags(): time.sleep(0.2)
        print('written and read back' if write_tlv(nfc, tlv, url) else 'write failed (the tag moved?): lay it on again and repeat')


if __name__ == '__main__':
    try: main()
    except KeyboardInterrupt: pass
