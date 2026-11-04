"""Render the authored Hanpan tile mark to install icons. Requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2] / "public" / "icons"
SCALE = 4


def render(size: int, maskable: bool = False) -> Image.Image:
    image = Image.new("RGBA", (512 * SCALE, 512 * SCALE), "#d75b39" if maskable else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def box(bounds, radius, fill):
        draw.rounded_rectangle(tuple(value * SCALE for value in bounds), radius=radius * SCALE, fill=fill)

    if not maskable:
        box((0, 0, 512, 512), 144, "#d75b39")
    for x, y in ((116, 116), (280, 116), (116, 280)):
        box((x, y, x + 116, y + 116), 38, "#fff9ed")
    draw.ellipse(tuple(value * SCALE for value in (280, 280, 396, 396)), fill="#fff9ed")
    return image.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    for filename, size, maskable in (("icon-192.png", 192, False), ("icon-512.png", 512, False), ("maskable-512.png", 512, True), ("apple-touch-icon.png", 180, False)):
        render(size, maskable).save(ROOT / filename)
        print(f"Rendered {filename}: {size}x{size}")
