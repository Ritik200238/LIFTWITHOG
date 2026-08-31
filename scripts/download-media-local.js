import fs from 'fs';
import path from 'path';

const baseDir = path.resolve(process.cwd(), 'media');
const imgDir = path.join(baseDir, 'img');
const gifDir = path.join(baseDir, 'gif');

fs.mkdirSync(imgDir, { recursive: true });
fs.mkdirSync(gifDir, { recursive: true });

console.log('Local media folders initialized at:', baseDir);
console.log('Images directory:', imgDir);
console.log('GIFs directory:', gifDir);
console.log('All exercise media will be served 100% locally from these folders.');
