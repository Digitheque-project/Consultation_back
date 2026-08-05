const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourceEntry = path.join(rootDir, 'dist', 'src', 'main.js');
const targetEntry = path.join(rootDir, 'dist', 'main.js');

if (!fs.existsSync(sourceEntry)) {
  console.warn(`Build output not found at ${sourceEntry}`);
  process.exit(0);
}

fs.writeFileSync(targetEntry, "require('./src/main.js');\n", 'utf8');
console.log(`Created compatibility entrypoint: ${path.relative(rootDir, targetEntry)}`);
