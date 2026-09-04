"""Turn demo-frames/*.jpg into shareable loops.

    node demo.mjs && python demo-encode.py

Writes demo.webp (small, sharp - for the site and GitHub) and demo.gif (bigger
and coarser, for the places that still only take GIF). No ffmpeg needed; if you
install one, the same frames encode to mp4 with:

    ffmpeg -framerate 12 -i demo-frames/f%04d.jpg -vf scale=1200:-2 \
           -c:v libx264 -pix_fmt yuv420p -crf 23 demo.mp4
"""
import glob
from PIL import Image

FPS = 12
frames = sorted(glob.glob("demo-frames/*.jpg"))
assert frames, "no frames - run `node demo.mjs` first"


def load(width, step=1):
    out = []
    for p in frames[::step]:
        im = Image.open(p).convert("RGB")
        out.append(im.resize((width, round(width * im.height / im.width)), Image.LANCZOS))
    return out


def save(path, ims, step, **kw):
    ms = round(1000 / FPS) * step
    # Hold on the last frame so the loop doesn't snap back the instant it ends.
    # Done by repeating it rather than with a per-frame duration list, which
    # libwebp does not carry through. Identical frames get merged by the encoder
    # anyway, so the repeats cost almost nothing.
    ims = ims + [ims[-1]] * max(1, round(0.9 / (ms / 1000)))
    ims[0].save(path, save_all=True, append_images=ims[1:], duration=ms, loop=0, **kw)
    kb = __import__("os").path.getsize(path) / 1024
    print(f"{path}: {len(ims)} frames, {ims[0].size[0]}x{ims[0].size[1]}, {kb:.0f} kB")


save("demo.webp", load(1200), 1, quality=72, method=6)

# GIF gets 256 colours a frame, and what they are spent on matters more than how
# many. A palette picked by pixel frequency (MEDIANCUT) is dominated by the
# wallpaper and turns the app icons grey - Spotify loses its green, node's
# hexagon goes tan. FASTOCTREE spends colours on the range actually present, so
# the icons survive; the wallpaper picks up faint banding in exchange, which
# dithering hides well enough. Per-frame palettes, so each beat gets its own.
gif = [f.quantize(colors=255, method=Image.FASTOCTREE, dither=Image.FLOYDSTEINBERG)
       for f in load(1100)]
save("demo.gif", gif, 1, optimize=True)
