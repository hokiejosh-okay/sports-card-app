// lib/images.js — client-side image resize + thumbnail (spec §3, §6).
// Full image: max 1600px long edge, JPEG q0.85 (~300–600 KB).
// Thumb: max 400px long edge, JPEG q0.82 (grid tiles).
window.CV = window.CV || {};

CV.images = (function () {
  const FULL_MAX = 1600;
  const FULL_Q = 0.85;
  const THUMB_MAX = 400;
  const THUMB_Q = 0.82;

  // Load a File/Blob into an HTMLImageElement (iOS Safari transcodes HEIC→JPEG on file input).
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that image. Try a JPEG or PNG."));
      };
      img.src = url;
    });
  }

  function drawScaled(img, maxEdge, quality) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, outW, outH);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Image encode failed."))),
        "image/jpeg",
        quality
      );
    });
  }

  // Returns { fullBlob, thumbBlob, previewUrl } for one photo.
  // previewUrl is an object URL for immediate on-screen preview (revoke when done).
  async function process(file) {
    const img = await loadImage(file);
    const fullBlob = await drawScaled(img, FULL_MAX, FULL_Q);
    const thumbBlob = await drawScaled(img, THUMB_MAX, THUMB_Q);
    const previewUrl = URL.createObjectURL(thumbBlob);
    return { fullBlob, thumbBlob, previewUrl };
  }

  return { process, FULL_MAX, THUMB_MAX };
})();
