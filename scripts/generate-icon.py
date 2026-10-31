"""Generate the app's native vector-style icon without external Python packages."""
from pathlib import Path
import math
import struct
import zlib

SIZE = 512
bars = [(136, 216, 296), (196, 158, 354), (256, 126, 386), (316, 174, 338), (376, 218, 294)]

def color(x, y):
    dx, dy = max(150 - x, 0, x - 362), max(150 - y, 0, y - 362)
    if math.hypot(dx, dy) > 134:
        return (0, 0, 0, 0)
    for bx, top, bottom in bars:
        if math.hypot(x - bx, max(top - y, 0, y - bottom)) <= 12:
            return (255, 255, 255, 255)
    t = (x + y) / (SIZE * 2)
    return (round(247 - 31 * t), round(126 - 52 * t), round(125 - 36 * t), 255)

rows = bytearray()
for y in range(SIZE):
    rows.append(0)
    for x in range(SIZE):
        samples = [color(x + dx, y + dy) for dx, dy in [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)]]
        rows.extend(round(sum(s[c] for s in samples) / 4) for c in range(4))

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

image = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b'')
Path(__file__).resolve().parent.parent.joinpath('resources/icon.png').write_bytes(image)
