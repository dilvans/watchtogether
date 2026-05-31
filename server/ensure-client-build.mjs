import { existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(serverDir, '../client/dist/index.html');

if (existsSync(distIndex)) {
  console.log('Client build found.');
  process.exit(0);
}

console.log('Client build missing, running production build...');
execSync('npm run build', { stdio: 'inherit', cwd: serverDir });
