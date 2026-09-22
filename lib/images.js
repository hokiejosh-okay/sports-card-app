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

  // ---- Rotation (spec §3) ----------------------------------------------------
  // Load a stored image URL with CORS enabled so the canvas stays UNTAINTED when
  // we read it back with toBlob (required to re-encode a Firebase Storage image).
  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load the image to rotate."));
      img.src = url;
    });
  }

  // Draw `img` rotated by `deg` (a multiple of 90) into a canvas scaled so its
  // long edge ≤ maxEdge, then JPEG-encode at `quality`.
  function drawRotatedScaled(img, deg, maxEdge, quality) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));
    const quarter = (((deg || 0) % 360) + 360) % 360;
    const swap = quarter === 90 || quarter === 270;

    const canvas = document.createElement("canvas");
    canvas.width = swap ? sh : sw;
    canvas.height = swap ? sw : sh;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((quarter * Math.PI) / 180);
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);

    return new Promise((resolve, reject) => {
      // toBlob throws a SecurityError if the canvas is tainted (CORS) — surfaced
      // to the caller so the UI can tell the user to enable bucket CORS.
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Image encode failed."))),
        "image/jpeg",
        quality
      );
    });
  }

  // Rotate ONE stored side by `deg` (default 90° CW): re-encode the full image
  // (1600px long edge, q0.85) AND the thumbnail (400px, q0.82) from the rotated
  // canvas. `url` is the side's current download URL; a cache-bust param is added
  // so a freshly re-uploaded object (unchanged download token) still reloads
  // before rotating again. Returns { fullBlob, thumbBlob }.
  async function rotate(url, deg) {
    deg = deg || 90;
    const src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "cb=" + Date.now();
    const img = await loadImageFromUrl(src);
    const fullBlob = await drawRotatedScaled(img, deg, FULL_MAX, FULL_Q);
    const thumbBlob = await drawRotatedScaled(img, deg, THUMB_MAX, THUMB_Q);
    return { fullBlob, thumbBlob };
  }

  return { process, rotate, FULL_MAX, THUMB_MAX };
})();
