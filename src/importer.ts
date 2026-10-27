// Image import: file picker, drag & drop, paste. Decoding through <img> applies the EXIF orientation.
export const MAX_SIDE = 1600;

/** Decode an image file at its own size (photo, PNG, BMP, …). */
export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url); // the decoded image stays drawable
  }
}

/** The photo the pipeline works on: at most MAX_SIDE px, smoothly downscaled. */
export function photoCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export const decodeImage = async (file: Blob) => photoCanvas(await loadImage(file));

const imageIn = (items: Iterable<File>) => [...items].find(f => f.type.startsWith('image/')) ?? null;

/** Calls onFile for images picked, dropped anywhere on the page, or pasted, while `active()` says the importer's
 *  section is the one on screen. */
export function wireImport(input: HTMLInputElement, onFile: (f: File) => void, onDragState: (over: boolean) => void, active: () => boolean = () => true) {
  input.addEventListener('change', () => { const f = imageIn(input.files ?? []); if (f) onFile(f); input.value = ''; });
  let depth = 0;
  const hasFiles = (e: DragEvent) => active() && e.dataTransfer?.types.includes('Files');
  window.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; onDragState(true); } });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) { depth = 0; onDragState(false); } });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; onDragState(false);
    const f = imageIn(e.dataTransfer!.files); if (f) onFile(f);
  });
  window.addEventListener('paste', e => {
    if (!active()) return;
    const f = imageIn([...(e.clipboardData?.items ?? [])].filter(i => i.kind === 'file').map(i => i.getAsFile()!).filter(Boolean));
    if (f) { e.preventDefault(); onFile(f); }
  });
}
