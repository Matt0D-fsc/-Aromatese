// Phone cameras produce 3-12 MB photos; the chat and product uploads cap at 5 MB, and a 1600px JPEG is all
// the AI or a product card ever needs. Shrinking in the browser also means less mobile data for the customer,
// and turns an iPhone HEIC into a JPEG wherever the browser can decode it (Safari can).
// Browser only: uses createImageBitmap and a canvas.

const MAX_SIDE = 1600;
const QUALITY = 0.85;
const KEEP_AS_IS = ['image/jpeg', 'image/png', 'image/webp'];

export async function shrinkImage(file: File, maxSide = MAX_SIDE): Promise<File> {
  // GIFs would lose their animation. Anything already small, in a format everything reads, is left alone.
  if (file.type === 'image/gif') return file;
  if (file.size <= 500 * 1024 && KEEP_AS_IS.includes(file.type)) return file;

  try {
    // Applies the EXIF rotation, so portrait phone photos don't come out sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // JPEG has no transparency: a transparent PNG would otherwise turn black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    // A re-encode that came out bigger (an already-optimised PNG, say) is no improvement.
    if (!blob || (blob.size >= file.size && KEEP_AS_IS.includes(file.type))) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    // The browser cannot decode it (e.g. HEIC in Chrome): send the original and let the size check decide.
    return file;
  }
}
