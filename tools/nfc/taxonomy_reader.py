#!/usr/bin/env python3
"""Knitting Taxonomy, desk reader: a PN532 NFC module on a USB-serial adapter (HSU mode, 115200 baud).

Lay a framed sample on the reader and the laptop opens the address on its tag (the same page a phone opens).
No packages needed: the serial port is opened with termios (macOS / Linux).

  python3 taxonomy_reader.py                 wait for tags, open each one's address in the default browser
  python3 taxonomy_reader.py check           print the PN532's firmware version and exit
  python3 taxonomy_reader.py write <url>     write <url> to the next NTAG21x tag laid on the reader
  options: --port /dev/cu.usbserial-10 (default: the first /dev/cu.usbserial* or /dev/ttyUSB*)

A tag without an address is looked up by its UID in tags.json next to this file ({"04a1b2c3d4e5f6": "https://..."});
an unknown tag's UID is printed so it can be added there.
"""
import glob, json, os, select, subprocess, sys, termios, time, webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
PREFIX = {0: '', 1: 'http://www.', 2: 'https://www.', 3: 'http://', 4: 'https://'}


class PN532:
    def __init__(self, port):
        self.fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        a = termios.tcgetattr(self.fd)
        a[0] = 0; a[1] = 0; a[3] = 0                                         # raw: no input/output/local processing
        a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL                  # 8N1
        a[4] = a[5] = termios.B115200
        termios.tcsetattr(self.fd, termios.TCSANOW, a)
        termios.tcflush(self.fd, termios.TCIOFLUSH)
        os.write(self.fd, bytes([0x55, 0x55] + [0] * 14))                   # wake from power-down (HSU)
        time.sleep(0.05)
        self.call(0x14, [0x01, 0x14, 0x01])                                  # SAMConfiguration: normal mode
        self.call(0x32, [0x05, 0xFF, 0x01, 0x05])                            # retries: answer "no tag" quickly

    def read(self, n, timeout):
        out, end = b'', time.time() + timeout
        while len(out) < n and time.time() < end:
            r, _, _ = select.select([self.fd], [], [], max(0, end - time.time()))
            if r: out += os.read(self.fd, n - len(out))
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

    def write_page(self, page, four):
        r = self.call(0x40, [0x01, 0xA2, page] + list(four))                 # NTAG WRITE (4 bytes)
        return bool(r) and r[0] == 0


def read_url(nfc):
    """The first URI record of the tag's NDEF message, or None."""
    mem = b''
    for page in range(4, 40, 4):
        chunk = nfc.page4(page)
        if chunk is None: break
        mem += chunk
        if b'\xfe' in mem: break
    i = 0
    while i < len(mem):
        t = mem[i]
        if t == 0x00: i += 1; continue
        if t == 0xFE: return None
        if i + 1 >= len(mem): return None
        n, h = (mem[i + 1], 2) if mem[i + 1] != 0xFF else (int.from_bytes(mem[i + 2:i + 4], 'big'), 4)
        if t == 0x03:
            rec = mem[i + h:i + h + n]
            if len(rec) < 4: return None
            flags, tl = rec[0], rec[1]
            short = flags & 0x10
            pl = rec[2] if short else int.from_bytes(rec[2:6], 'big')
            j = 3 if short else 6
            if flags & 0x08: j += 1                                          # ID length present
            typ = rec[j:j + tl]; payload = rec[j + tl:j + tl + pl]
            if typ == b'U' and payload:
                return PREFIX.get(payload[0], '') + payload[1:].decode('utf-8', 'replace')
            return None
        i += h + n
    return None


def write_url(nfc, url):
    code, rest = 0, url
    for k in (4, 3, 2, 1):
        if url.startswith(PREFIX[k]): code, rest = k, url[len(PREFIX[k]):]; break
    payload = bytes([code]) + rest.encode()
    rec = bytes([0xD1, 0x01, len(payload)]) + b'U' + payload                 # one short well-known URI record
    tlv = bytes([0x03, len(rec)]) + rec + b'\xfe'
    tlv += b'\x00' * (-len(tlv) % 4)
    if len(tlv) > 140: sys.exit('address too long for an NTAG213')
    for k in range(0, len(tlv), 4):
        if not nfc.write_page(4 + k // 4, tlv[k:k + 4]): return False
    return True


def main():
    args = sys.argv[1:]
    port = None
    if '--port' in args:
        i = args.index('--port'); port = args[i + 1]; del args[i:i + 2]
    port = port or next(iter(sorted(glob.glob('/dev/cu.usbserial*') + glob.glob('/dev/ttyUSB*'))), None)
    if not port: sys.exit('no USB-serial adapter found (use --port)')
    nfc = PN532(port)
    if args[:1] == ['check']:
        v = nfc.call(0x02)
        print(f'{port}: PN5{v[0]:x} firmware {v[1]}.{v[2]}' if v else f'{port}: no answer from a PN532 (HSU mode? wiring?)')
        return
    if args[:1] == ['write']:
        url = args[1]
        print(f'lay the tag on the reader to write {url}')
        while not nfc.tag(): time.sleep(0.2)
        print('written' if write_url(nfc, url) and read_url(nfc) == url else 'write failed')
        return
    try: table = json.load(open(os.path.join(HERE, 'tags.json')))
    except (OSError, ValueError): table = {}
    print(f'{port}: waiting for tags (ctrl-c to stop)')
    last = None
    while True:
        uid = nfc.tag()
        if uid and uid != last:
            url = read_url(nfc) or table.get(uid.hex())
            print(f'tag {uid.hex()}: {url or "no address on it and not in tags.json"}')
            if url:
                if sys.platform == 'darwin': subprocess.run(['open', url])
                else: webbrowser.open(url)
        last = uid                                                           # the same tag lying there opens once
        time.sleep(0.3)


if __name__ == '__main__':
    try: main()
    except KeyboardInterrupt: pass
