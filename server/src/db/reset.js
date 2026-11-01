import fs from 'node:fs';
import { config } from '../config.js';

const files = [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`];
for (const file of files) {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    console.log(`removed ${file}`);
  }
}
console.log('Database reset. Run `npm run seed` to rebuild the demo data.');
