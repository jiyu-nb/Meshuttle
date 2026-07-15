"""Build deterministic Meshuttle PNG and ICO assets from the code-native logo geometry."""

from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "client" / "build"
BG = "#0b0d10"
AMBER = "#f4b942"


def draw_icon(size: int) -> Image.Image:
    scale = size / 512
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    radius = round(112 * scale)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=BG)

    width = max(2, round(38 * scale))
    line_width = max(2, round(32 * scale))
    points = [(142, 128), (142, 325), (151, 355), (175, 383), (229, 401), (283, 401), (337, 383), (361, 355), (370, 325), (370, 128)]
    draw.line([(round(x * scale), round(y * scale)) for x, y in points], fill=AMBER, width=width, joint="curve")
    cap = max(2, round(width / 2))
    for x, y in (points[0], points[-1]):
        draw.ellipse((round(x * scale) - cap, round(y * scale) - cap, round(x * scale) + cap, round(y * scale) + cap), fill=AMBER)
    for y, left, right in ((178, 174, 338), (257, 174, 338), (337, 200, 312)):
        draw.line((round(left * scale), round(y * scale), round(right * scale), round(y * scale)), fill=AMBER, width=line_width)
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon = draw_icon(512)
    icon.save(OUT / "icon.png", optimize=True)
    icon.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    main()
