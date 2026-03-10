/**
 * Generate app icons in multiple sizes for Linux packaging
 * Run with: node scripts/generate-icons.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SIZES = [512, 256, 128, 64, 48, 32, 16];
const SOURCE_ICON = path.join(__dirname, '../resources/icon.png');
const OUTPUT_DIR = path.join(__dirname, '../resources/icons');

async function generateIcons() {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Generating icons from: ${SOURCE_ICON}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);

  for (const size of SIZES) {
    const outputPath = path.join(OUTPUT_DIR, `${size}x${size}.png`);
    
    try {
      await sharp(SOURCE_ICON)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Generated: ${size}x${size}.png`);
    } catch (err) {
      console.error(`✗ Failed to generate ${size}x${size}.png:`, err.message);
    }
  }

  // Also copy the source as icon.png for compatibility
  const iconPngPath = path.join(OUTPUT_DIR, 'icon.png');
  try {
    await sharp(SOURCE_ICON)
      .resize(256, 256)
      .png()
      .toFile(iconPngPath);
    console.log('✓ Generated: icon.png (256x256)');
  } catch (err) {
    console.error('✗ Failed to generate icon.png:', err.message);
  }

  console.log('\nIcon generation complete!');
  console.log('Icons are in:', OUTPUT_DIR);
}

generateIcons().catch(console.error);
