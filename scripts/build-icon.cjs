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
    console.error('❌ Failed to create icon.ico:', err.message);
    process.exit(1);
  });
