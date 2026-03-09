# RhythmDesk Icons

For Linux packaging, electron-builder requires PNG icons at the following sizes:
- 16x16
- 32x32
- 48x48
- 64x64
- 128x128
- 256x256
- 512x512

## Generate icons from SVG

If you have ImageMagick installed, you can generate all sizes from the SVG:

```bash
cd resources/icons
for size in 16 32 48 64 128 256 512; do
  convert -background none -resize ${size}x${size} icon.svg ${size}x${size}.png
done
```

Or with `rsvg-convert` (from librsvg):

```bash
cd resources/icons
for size in 16 32 48 64 128 256 512; do
  rsvg-convert -w $size -h $size icon.svg -o ${size}x${size}.png
done
```

## Icon naming convention

electron-builder for Linux expects icons named by size: `16x16.png`, `32x32.png`, etc.
Or you can provide a single `icon.png` (256x256 or larger) and it will be resized automatically.
