/**
 * Map and generate official Friday Amanah brand assets into mobile/assets/
 * Based on docs/17-brand-assets-and-metadata.md
 */

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp-compact');

async function mapAssets() {
  const brandDir = path.resolve(__dirname, '../../Friday_Amanah_Brand_Assets');
  const imagesDir = path.resolve(__dirname, '../assets/images');
  const brandTargetDir = path.resolve(__dirname, '../assets/brand');

  if (!fs.existsSync(brandTargetDir)) {
    fs.mkdirSync(brandTargetDir, { recursive: true });
  }

  console.log('1. Copying app icon (1024x1024 Midnight Navy full-bleed)...');
  const darkIconSource = path.join(brandDir, '02_App_Icons/Dark/Friday_Amanah_Dark_1024x1024.png');
  fs.copyFileSync(darkIconSource, path.join(imagesDir, 'icon.png'));
  fs.copyFileSync(darkIconSource, path.join(brandTargetDir, 'icon.png'));

  console.log('2. Copying favicon (48x48)...');
  const faviconSource = path.join(brandDir, '03_Web_Icons/favicon-48x48.png');
  fs.copyFileSync(faviconSource, path.join(imagesDir, 'favicon.png'));

  console.log('3. Copying primary, horizontal, stacked, and mark logos...');
  fs.copyFileSync(
    path.join(brandDir, '01_Logos/Friday_Amanah_Primary_Transparent_4K.png'),
    path.join(imagesDir, 'logo-primary.png')
  );
  fs.copyFileSync(
    path.join(brandDir, '01_Logos/Friday_Amanah_Horizontal_Transparent_3K.png'),
    path.join(imagesDir, 'logo-horizontal.png')
  );
  fs.copyFileSync(
    path.join(brandDir, '01_Logos/Friday_Amanah_Stacked_Transparent_2K.png'),
    path.join(imagesDir, 'logo-stacked.png')
  );
  fs.copyFileSync(
    path.join(brandDir, '01_Logos/Friday_Amanah_Icon_Only_Transparent_4K.png'),
    path.join(imagesDir, 'mark.png')
  );

  // Also in assets/brand/ per doc 17
  fs.copyFileSync(
    path.join(brandDir, '01_Logos/Friday_Amanah_Primary_Transparent_4K.png'),
    path.join(brandTargetDir, 'logo-primary.png')
  );
  fs.copyFileSync(
    path.join(brandDir, '01_Logos/Friday_Amanah_Horizontal_Transparent_3K.png'),
    path.join(brandTargetDir, 'logo-horizontal.png')
  );
  fs.copyFileSync(
    path.join(brandDir, '01_Logos/Friday_Amanah_Stacked_Transparent_2K.png'),
    path.join(brandTargetDir, 'logo-stacked.png')
  );
  fs.copyFileSync(
    path.join(brandDir, '01_Logos/Friday_Amanah_Icon_Only_Transparent_4K.png'),
    path.join(brandTargetDir, 'mark.png')
  );

  console.log('4. Generating splash icon (centered stacked artwork on 1024x1024 canvas)...');
  const stackedImg = await Jimp.read(path.join(brandDir, '01_Logos/Friday_Amanah_Stacked_Transparent_2K.png'));
  stackedImg.contain(800, 800);
  const splashCanvas = new Jimp(1024, 1024, 0x00000000);
  splashCanvas.composite(
    stackedImg,
    Math.round((1024 - stackedImg.bitmap.width) / 2),
    Math.round((1024 - stackedImg.bitmap.height) / 2)
  );
  await splashCanvas.writeAsync(path.join(imagesDir, 'splash-icon.png'));

  console.log('5. Generating Android adaptive icon background (#0A1D37 Midnight Navy)...');
  const bg = new Jimp(1024, 1024, 0x0a1d37ff);
  await bg.writeAsync(path.join(imagesDir, 'android-icon-background.png'));

  console.log('6. Generating Android adaptive icon foreground (centered within safe zone)...');
  const markImg = await Jimp.read(path.join(brandDir, '01_Logos/Friday_Amanah_Icon_Only_Transparent_4K.png'));
  markImg.contain(680, 680);
  const fgCanvas = new Jimp(1024, 1024, 0x00000000);
  fgCanvas.composite(
    markImg,
    Math.round((1024 - markImg.bitmap.width) / 2),
    Math.round((1024 - markImg.bitmap.height) / 2)
  );
  await fgCanvas.writeAsync(path.join(imagesDir, 'android-icon-foreground.png'));

  console.log('7. Generating Android monochrome icon (white silhouette on transparent)...');
  const monoImg = fgCanvas.clone();
  monoImg.scan(0, 0, monoImg.bitmap.width, monoImg.bitmap.height, function (x, y, idx) {
    const alpha = this.bitmap.data[idx + 3];
    if (alpha > 15) {
      this.bitmap.data[idx] = 255;
      this.bitmap.data[idx + 1] = 255;
      this.bitmap.data[idx + 2] = 255;
    }
  });
  await monoImg.writeAsync(path.join(imagesDir, 'android-icon-monochrome.png'));

  console.log('All brand assets successfully mapped and written!');
}

mapAssets().catch((err) => {
  console.error('Failed to map assets:', err);
  process.exit(1);
});
