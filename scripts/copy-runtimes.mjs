// Self-host the WASM runtimes (no CDN): copy them from node_modules into public/ before dev/build.
import { cpSync, mkdirSync } from 'node:fs';

// MediaPipe tasks-vision (face points + regions).
mkdirSync('public/mediapipe/wasm', { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm', { recursive: true });
// (ONNX Runtime Web needs no copy: Vite bundles its .wasm files as assets.)

console.log('copied MediaPipe WASM into public/');
