const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const target = 256;

function fitIcon(source) {
  const size = source.getSize();
  const scale = Math.min(target / size.width, target / size.height);
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const fitted = source.resize({ width, height, quality: 'best' });
  const bitmap = fitted.toBitmap();
  const pixels = Buffer.alloc(target * target * 4, 0);
  const offsetX = Math.floor((target - width) / 2);
  const offsetY = Math.floor((target - height) / 2);
  for (let y = 0; y < height; y += 1) {
    bitmap.copy(pixels, ((offsetY + y) * target + offsetX) * 4, y * width * 4, (y + 1) * width * 4);
  }
  return nativeImage.createFromBitmap(pixels, { width: target, height: target });
}

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(path.join(__dirname, '..', 'icon.png'));
  if (source.isEmpty()) {
    console.error('icon.png missing');
    app.exit(1);
    return;
  }
  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'icon.png'), fitIcon(source).toPNG());
  app.exit(0);
});
