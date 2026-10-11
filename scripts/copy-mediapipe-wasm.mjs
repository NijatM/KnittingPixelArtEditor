// Self-host MediaPipe's WASM runtime (no CDN): copy it from node_modules into public/ before dev/build.
import { cpSync, mkdirSync } from 'node:fs';

const from = 'node_modules/@mediapipe/tasks-vision/wasm';
const to = 'public/mediapipe/wasm';
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`copied ${from} -> ${to}`);
