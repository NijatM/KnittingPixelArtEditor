#!/usr/bin/env python3
"""Knitting Taxonomy, desk reader: a PN532 NFC module on a USB-serial adapter (HSU mode, 115200 baud).

Lay a framed sample on the reader and the laptop opens the address on its tag (the same page a phone opens).
No packages needed: the serial port is opened with termios (macOS / Linux).

  python3 taxonomy_reader.py                 wait for tags; each one's address opens in one Chrome window kept for
                                             the reader, filling the screen (macOS; first time, allow the terminal
                                             to control Chrome); elsewhere, or with --tab, in the default browser
  python3 taxonomy_reader.py check           print the PN532's firmware version and exit
  python3 taxonomy_reader.py info            print the next tag's UID, chip version, first pages and address (reads only)
  python3 taxonomy_reader.py write <url>     write <url> to the next NTAG21x tag laid on the reader
  options: --port /dev/cu.usbserial-10 (default: the first /dev/cu.usbserial* or /dev/ttyUSB*), --tab,
           --browser "Brave Browser" (any Chromium browser on macOS; default Google Chrome)
  start_reader.command (next to this file) starts it from Finder with a double-click.
  While waiting for tags, the reader may be unplugged and plugged back in (or plugged in only after starting): it
  waits for it and goes on.

A tag without an address is looked up by its UID in tags.json next to this file ({"04a1b2c3d4e5f6": "https://..."});
an unknown tag's UID is printed so it can be added there.
"""
import errno, glob, json, os, select, subprocess, sys, termios, time, webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
PREFIX = {0: '', 1: 'http://www.', 2: 'https://www.', 3: 'http://', 4: 'https://'}


LOST = (OSError, termios.error)                                              # the adapter unplugged (or its port gone)


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
            os.write(self.fd, bytes([0x55, 0x55] + [0] * 14))               # wake from power-down (HSU)
            time.sleep(0.05)
            self.call(0x14, [0x01, 0x14, 0x01])                              # SAMConfiguration: normal mode
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

    def call(self, cmd, data=(), timeout=1.0):
        body = bytes([0xD4, cmd] + list(data))
        frame = bytes([0, 0, 0xFF, len(body), (-len(body)) & 0xFF]) + body + bytes([(-sum(body)) & 0xFF, 0])
        termios.tcflush(self.fd, termios.TCIFLUSH)
        os.write(self.fd, frame)
        buf = b''
        end = time.time() + timeout
        while time.time() < end:                                             # skip the ACK, find the answer
            buf += self.read(1, end - time.time())
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
        return None

    def tag(self):
        """UID of a tag on the reader, or None."""
        r = self.call(0x4A, [0x01, 0x00], timeout=1.5)                       # InListPassiveTarget, 106 kbps type A
        if not r or r[0] == 0: return None
        return bytes(r[6:6 + r[5]])

    def page4(self, page):
        r = self.call(0x40, [0x01, 0x30, page])                              # InDataExchange: NTAG READ (16 bytes)
        return bytes(r[1:17]) if r and r[0] == 0 and len(r) >= 17 else None

    def version(self):
        r = self.call(0x42, [0x60])                                          # InCommunicateThru: NTAG GET_VERSION
        return bytes(r[1:]) if r and r[0] == 0 else None

    def write_page(self, page, four):
        r = self.call(0x40, [0x01, 0xA2, page] + list(four))                 # NTAG WRITE (4 bytes)
        return bool(r) and r[0] == 0


def parse(mem):
    """(whole, url): whole is False while the NDEF message runs past the bytes read so far; url is its first URI or None."""
    i = 0
    while i < len(mem):
        t = mem[i]
        if t == 0x00: i += 1; continue
        if t == 0xFE: return True, None
        if i + 4 > len(mem): return False, None
        n, h = (mem[i + 1], 2) if mem[i + 1] != 0xFF else (int.from_bytes(mem[i + 2:i + 4], 'big'), 4)
        if i + h + n > len(mem): return False, None
        if t == 0x03:
            rec = mem[i + h:i + h + n]
            if len(rec) < 4: return True, None
            flags, tl = rec[0], rec[1]
            short = flags & 0x10
            pl = rec[2] if short else int.from_bytes(rec[2:6], 'big')
            j = 3 if short else 6
            if flags & 0x08: j += 1                                          # ID length present
            typ = rec[j:j + tl]; payload = rec[j + tl:j + tl + pl]
            if typ == b'U' and payload and len(payload) == pl:
                return True, PREFIX.get(payload[0], '') + payload[1:].decode('utf-8', 'replace')
            return True, None
        i += h + n
    return False, None


def read_url(nfc):
    """The first URI record of the tag's NDEF message, None if it has none, or False if the tag went away before its
    message was read whole (a frame lifted or slid mid-read): a cut-off address is never returned."""
    mem = b''
    for page in range(4, 228, 4):                                            # up to an NTAG216's last user page
        chunk = nfc.page4(page)
        if chunk is None: return False
        mem += chunk
        whole, url = parse(mem)
        if whole: return url
    return None


def write_url(nfc, url):
    code, rest = 0, url
    for k in (4, 3, 2, 1):
        if url.startswith(PREFIX[k]): code, rest = k, url[len(PREFIX[k]):]; break
    payload = bytes([code]) + rest.encode()
    rec = bytes([0xD1, 0x01, len(payload)]) + b'U' + payload                 # one short well-known URI record
    tlv = bytes([0x03, len(rec)]) + rec + b'\xfe'
    tlv += b'\x00' * (-len(tlv) % 4)
    cc = nfc.page4(3)
    if not cc or cc[0] != 0xE1: sys.exit(f'no NDEF capability container on page 3 ({cc[:4].hex(" ") if cc else "unreadable"}); not writing')
    if cc[3] & 0xF0: sys.exit(f'the tag is write-protected (CC {cc[:4].hex(" ")})')
    if len(tlv) > cc[2] * 8: sys.exit(f'address needs {len(tlv)} bytes, the tag holds {cc[2] * 8}')
    print(f'CC {cc[:4].hex(" ")} ({cc[2] * 8} bytes); address on it now: {read_url(nfc)}')
    for k in range(0, len(tlv), 4):
        if not nfc.write_page(4 + k // 4, tlv[k:k + 4]): return False
    return True


# Chrome (or another Chromium browser), through JavaScript for Automation: the reader's own window (else one already on the site, else a new one),
# sized to the screen above the Dock and brought to the front; the same address again reloads, so the page scrolls
# back to the frame.
SHOW = r'''
function run(argv) {
  const url = argv[0], want = argv[1] || '', chrome = Application(argv[2]);
  const site = url.split('#')[0];
  let win = chrome.windows().find(w => String(w.id()) === want) || chrome.windows().find(w => w.activeTab().url().startsWith(site));
  if (!win) { chrome.Window().make(); win = chrome.windows[0]; }
  const tab = win.activeTab();
  if (tab.url() === url) tab.reload(); else tab.url = url;
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


def connect(want):
    """The reader, once its adapter is plugged in and the PN532 on it answers."""
    said = False
    while True:
        port = find_port(want)
        if port:
            try:
                nfc = PN532(port)
                if nfc.call(0x02): return port, nfc                          # firmware version: it is a PN532, awake
                nfc.close()
            except LOST: pass
        if not said: print(f'waiting for the reader on {want or "a USB-serial port"} (ctrl-c to stop)', flush=True); said = True
        time.sleep(1)


def watch(want, tab, browser):
    try: table = json.load(open(os.path.join(HERE, 'tags.json')))
    except (OSError, ValueError): table = {}
    port, nfc = connect(want)
    print(f'{port}: waiting for tags (ctrl-c to stop)', flush=True)
    last = None
    while True:
        try:
            uid = nfc.tag()
            if uid and uid != last:
                url = read_url(nfc)
                if url is False: time.sleep(0.1); continue                   # not read whole: try again, not yet seen
                url = url or table.get(uid.hex())
                print(f'tag {uid.hex()}: {url or "no address on it and not in tags.json"}', flush=True)
                if url: show(url, tab, browser)
            last = uid                                                       # the same tag lying there opens once
        except LOST as e:
            nfc.close()
            print(f'{port}: the reader went away ({e})', flush=True)
            port, nfc = connect(want)
            print(f'{port}: back, waiting for tags', flush=True)
        time.sleep(0.3)


def main():
    args = sys.argv[1:]
    port = None
    if '--port' in args:
        i = args.index('--port'); port = args[i + 1]; del args[i:i + 2]
    tab = '--tab' in args
    if tab: args.remove('--tab')
    browser = 'Google Chrome'
    if '--browser' in args:
        i = args.index('--browser'); browser = args[i + 1]; del args[i:i + 2]
    if args[:1] not in (['check'], ['info'], ['write']): return watch(port, tab, browser)
    port = find_port(port)
    if not port: sys.exit('no USB-serial adapter found (use --port)')
    nfc = PN532(port)
    if args[:1] == ['check']:
        v = nfc.call(0x02)
        print(f'{port}: PN5{v[0]:x} firmware {v[1]}.{v[2]}' if v else f'{port}: no answer from a PN532 (HSU mode? wiring?)')
        return
    if args[:1] == ['info']:
        print('lay the tag on the reader')
        while not (uid := nfc.tag()): time.sleep(0.2)
        print(f'UID {uid.hex(" ")}')
        for page in (0, 4, 8, 12):
            c = nfc.page4(page)
            print(f'pages {page:2}-{page + 3:2}: {c.hex(" ") if c else "unreadable"}')
        u = read_url(nfc)
        print(f'address: {"not read whole (the tag moved?)" if u is False else u}')
        v = nfc.version()                                                    # last: a chip without it stops answering
        print(f'GET_VERSION {v.hex(" ") if v else "no answer"}')
        return
    if args[:1] == ['write']:
        url = args[1]
        print(f'lay the tag on the reader to write {url}')
        while not nfc.tag(): time.sleep(0.2)
        print('written' if write_url(nfc, url) and read_url(nfc) == url else 'write failed')


if __name__ == '__main__':
    try: main()
    except KeyboardInterrupt: pass
