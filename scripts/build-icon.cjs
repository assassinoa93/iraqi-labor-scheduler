/**
 * Converts assets/icon.png → assets/icon.ico for Windows installer
 * Run via: node scripts/build-icon.js
 */
const pngToIco = require('png-to-ico');
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'assets', 'icon.png');
const dst = path.join(__dirname, '..', 'assets', 'icon.ico');

pngToIco(src)
  .then(buf => {
    fs.writeFileSync(dst, buf);
    console.log('✅ icon.ico created at assets/icon.ico');
  })
  .catch(err => {
    console.warn('⚠️ Warning: Could not create custom icon.ico (Image format issue). Using default.');
    // Create an empty or dummy icon if needed, or just let electron-builder use the PNG
    // For now, we just don't crash the build.
  });
