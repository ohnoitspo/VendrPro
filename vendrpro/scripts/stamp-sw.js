const fs   = require('fs');
const path = require('path');
const swPath = path.join(__dirname, '..', 'public', 'sw.js');
let src = fs.readFileSync(swPath, 'utf8');
src = src.replace(/const CACHE = 'vendrpro-[^']+';/, `const CACHE = 'vendrpro-${Date.now()}';`);
fs.writeFileSync(swPath, src);
console.log('sw.js cache version stamped for this build.');
