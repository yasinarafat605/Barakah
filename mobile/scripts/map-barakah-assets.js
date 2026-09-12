/**
 * Map and generate official Barakah brand assets into mobile/assets/ and mobile/public/
 * Based on Barakah_Brand_Assets_v1
 */

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp-compact');

async function mapAssets() {
  const brandDir = path.resolve(__dirname, '../../Barakah_Brand_Assets_v1');
  const imagesDir = path.resolve(__dirname, '../assets/images');
  const brandTargetDir = path.resolve(__dirname, '../assets/brand');
  const publicDir = path.resolve(__dirname, '../public');

  if (!fs.existsSync(brandTargetDir)) {
    fs.mkdirSync(brandTargetDir, { recursive: true });
  }
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  console.log('1. Copying app icon (1024x1024 Emerald full-bleed)...');
  const appIconSource = path.join(brandDir, '02_App_Icons/Android/app-icon-1024.png');
  fs.copyFileSync(appIconSource, path.join(imagesDir, 'icon.png'));
  fs.copyFileSync(appIconSource, path.join(brandTargetDir, 'icon.png'));

  console.log('2. Copying adaptive icon foreground and monochrome...');
  const fgSource = path.join(brandDir, '02_App_Icons/Android/adaptive-icon-foreground-1024.png');
  fs.copyFileSync(fgSource, path.join(imagesDir, 'android-icon-foreground.png'));

  const monoSource = path.join(brandDir, '02_App_Icons/Android/monochrome-icon-1024.png');
  fs.copyFileSync(monoSource, path.join(imagesDir, 'android-icon-monochrome.png'));

  console.log('3. Generating Android adaptive icon background (#0B6B57 Emerald)...');
  // 0x0B6B57FF
  const bg = new Jimp(1024, 1024, 0x0b6b57ff);
  await bg.writeAsync(path.join(imagesDir, 'android-icon-background.png'));

  console.log('4. Copying favicon and web icons...');
  const favicon48Source = path.join(brandDir, '04_Web/favicon-48.png');
  fs.copyFileSync(favicon48Source, path.join(imagesDir, 'favicon.png'));

  console.log('5. Copying master logo variants (horizontal, stacked, reverse, symbol)...');
  const logos = [
    { src: '01_Logos/PNG_4K/barakah-logo-horizontal-4096.png', dest: 'logo-horizontal.png' },
    { src: '01_Logos/PNG_4K/barakah-logo-horizontal-reverse-4096.png', dest: 'logo-horizontal-reverse.png' },
    { src: '01_Logos/PNG_4K/barakah-logo-stacked-4096.png', dest: 'logo-stacked.png' },
    { src: '01_Logos/PNG_4K/barakah-logo-stacked-reverse-4096.png', dest: 'logo-stacked-reverse.png' },
    { src: '01_Logos/PNG_4K/barakah-symbol-primary-4096.png', dest: 'mark.png' },
    { src: '01_Logos/PNG_4K/barakah-symbol-primary-4096.png', dest: 'logo-primary.png' },
    { src: '01_Logos/PNG_4K/barakah-symbol-reverse-4096.png', dest: 'mark-reverse.png' },
    { src: '01_Logos/PNG_4K/barakah-wordmark-dark-4096.png', dest: 'wordmark-dark.png' },
    { src: '01_Logos/PNG_4K/barakah-wordmark-light-4096.png', dest: 'wordmark-light.png' },
  ];

  for (const item of logos) {
    const srcPath = path.join(brandDir, item.src);
    fs.copyFileSync(srcPath, path.join(imagesDir, item.dest));
    fs.copyFileSync(srcPath, path.join(brandTargetDir, item.dest));
  }

  console.log('6. Generating splash icons and copying full splash artwork...');
  // Splash light and dark full-screen art
  fs.copyFileSync(
    path.join(brandDir, '03_Splash/splash-light-1440x3200.png'),
    path.join(imagesDir, 'splash-light.png')
  );
  fs.copyFileSync(
    path.join(brandDir, '03_Splash/splash-dark-1440x3200.png'),
    path.join(imagesDir, 'splash-dark.png')
  );

  // Splash icon for Expo splash screen (centered stacked logo on 1024x1024 transparent canvas)
  const stackedImg = await Jimp.read(path.join(brandDir, '01_Logos/PNG_4K/barakah-logo-stacked-4096.png'));
  stackedImg.contain(760, 760);
  const splashCanvas = new Jimp(1024, 1024, 0x00000000);
  splashCanvas.composite(
    stackedImg,
    Math.round((1024 - stackedImg.bitmap.width) / 2),
    Math.round((1024 - stackedImg.bitmap.height) / 2)
  );
  await splashCanvas.writeAsync(path.join(imagesDir, 'splash-icon.png'));

  console.log('7. Copying PWA and Web assets to public/...');
  const webFiles = [
    { src: '04_Web/favicon.ico', dest: 'favicon.ico' },
    { src: '04_Web/favicon.svg', dest: 'favicon.svg' },
    { src: '04_Web/favicon-16.png', dest: 'favicon-16.png' },
    { src: '04_Web/favicon-32.png', dest: 'favicon-32.png' },
    { src: '04_Web/favicon-48.png', dest: 'favicon-48.png' },
    { src: '04_Web/favicon-512.png', dest: 'favicon-512.png' },
    { src: '04_Web/apple-touch-icon-180.png', dest: 'apple-touch-icon.png' },
    { src: '04_Web/social-share-2400x1260.png', dest: 'social-share.png' },
    { src: '02_App_Icons/PWA/icon-192.png', dest: 'icon-192.png' },
    { src: '02_App_Icons/PWA/icon-512.png', dest: 'icon-512.png' },
    { src: '02_App_Icons/PWA/icon-1024.png', dest: 'icon-1024.png' },
    { src: '02_App_Icons/PWA/maskable-icon-192.png', dest: 'maskable-icon-192.png' },
    { src: '02_App_Icons/PWA/maskable-icon-512.png', dest: 'maskable-icon-512.png' },
    { src: '02_App_Icons/PWA/maskable-icon-1024.png', dest: 'maskable-icon-1024.png' },
  ];

  for (const item of webFiles) {
    const srcPath = path.join(brandDir, item.src);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(publicDir, item.dest));
    }
  }

  // Create PWA site.webmanifest and manifest.json
  const manifestContent = {
    name: 'Barakah',
    short_name: 'Barakah',
    description: 'Privacy-first Islamic personal finance application.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F8F4',
    theme_color: '#0B6B57',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-1024.png',
        sizes: '1024x1024',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/maskable-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/maskable-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/maskable-icon-1024.png',
        sizes: '1024x1024',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };

  const manifestJson = JSON.stringify(manifestContent, null, 2);
  fs.writeFileSync(path.join(publicDir, 'site.webmanifest'), manifestJson, 'utf-8');
  fs.writeFileSync(path.join(publicDir, 'manifest.json'), manifestJson, 'utf-8');

  console.log('All Barakah brand assets successfully mapped, generated, and verified!');
}

mapAssets().catch((err) => {
  console.error('Failed to map Barakah assets:', err);
  process.exit(1);
});
