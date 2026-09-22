"""Recompress embedded GLB textures for faster mobile downloads.

Policy (safe for the current assets):
- Fully opaque PNGs become JPEG quality 82 at the same size.
- PNGs with real alpha are downscaled to 512px on the long edge and
  re-encoded with PNG optimization (alpha must survive).
- Already-compressed JPEGs are left untouched.
- Geometry, materials, animations and texture references are unchanged.

Usage: python3 art/compress_glb.py public/models/<name>.glb [...]
"""
import io
import json
import struct
import sys

from PIL import Image

JPEG_QUALITY = 82
ALPHA_MAX_EDGE = 512


def read_glb(path):
    with open(path, 'rb') as handle:
        data = handle.read()
    magic, version, length = struct.unpack('<III', data[:12])
    assert magic == 0x46546C67 and version == 2 and length == len(data), path
    json_len, json_type = struct.unpack('<II', data[12:20])
    assert json_type == 0x4E4F534A, path
    doc = json.loads(data[20:20 + json_len])
    offset = 20 + json_len
    blob = b''
    if offset < len(data):
        bin_len, bin_type = struct.unpack('<II', data[offset:offset + 8])
        assert bin_type == 0x004E4942, path
        blob = data[offset + 8:offset + 8 + bin_len]
    return doc, blob


def transform(mime, raw):
    image = Image.open(io.BytesIO(raw))
    image.load()
    if mime == 'image/png' and image.mode == 'RGBA':
        if image.getchannel('A').getextrema() == (255, 255):
            out = io.BytesIO()
            image.convert('RGB').save(out, 'JPEG', quality=JPEG_QUALITY)
            return 'image/jpeg', out.getvalue()
        if max(image.size) > ALPHA_MAX_EDGE:
            ratio = ALPHA_MAX_EDGE / max(image.size)
            image = image.resize((round(image.width * ratio), round(image.height * ratio)), Image.LANCZOS)
        out = io.BytesIO()
        image.save(out, 'PNG', optimize=True)
        return 'image/png', out.getvalue()
    return None


def compress(path):
    doc, blob = read_glb(path)
    views = doc['bufferViews']
    originals = [(view.get('byteOffset', 0), view['byteLength']) for view in views]
    spans = sorted(originals)
    for (_, first_end), (second_start, _) in zip(spans, spans[1:]):
        assert first_end <= second_start, f'overlapping bufferViews in {path}'
    replacements = {}
    for entry in doc.get('images', []):
        if 'bufferView' not in entry:
            continue
        start, size = originals[entry['bufferView']]
        result = transform(entry.get('mimeType'), blob[start:start + size])
        if result:
            replacements[entry['bufferView']] = result
    if not replacements:
        print(f'{path}: nothing to compress')
        return
    new_blob = bytearray()
    for index, view in enumerate(views):
        while len(new_blob) % 4:
            new_blob.append(0)
        view['byteOffset'] = len(new_blob)
        if index in replacements:
            mime, payload = replacements[index]
            new_blob.extend(payload)
            view['byteLength'] = len(payload)
            for entry in doc['images']:
                if entry.get('bufferView') == index:
                    entry['mimeType'] = mime
        else:
            start, size = originals[index]
            new_blob.extend(blob[start:start + size])
    assert len(doc.get('buffers', [])) == 1, f'multi-buffer GLB unsupported: {path}'
    while len(new_blob) % 4:
        new_blob.append(0)
    for buffer in doc.get('buffers', []):
        buffer['byteLength'] = len(new_blob)
    payload = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    while len(payload) % 4:
        payload += b' '
    header = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(payload) + 8 + len(new_blob))
    with open(path, 'wb') as handle:
        handle.write(header)
        handle.write(struct.pack('<II', len(payload), 0x4E4F534A))
        handle.write(payload)
        handle.write(struct.pack('<II', len(new_blob), 0x004E4942))
        handle.write(new_blob)
    print(f'{path}: {len(blob) // 1024}KB -> {len(new_blob) // 1024}KB bin')


def main(paths):
    for path in paths:
        compress(path)


if __name__ == '__main__':
    main(sys.argv[1:])
