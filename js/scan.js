// Camera QR scanning. Android Chrome has a native BarcodeDetector; iOS
// Safari/Chrome (WebKit) has none, so there we lazily load the vendored
// jsQR decoder and scan video frames through a canvas instead. Either way
// the button shows wherever a camera API exists.

const hasDetector = () => typeof globalThis.BarcodeDetector === "function";

export const scanSupported = () => !!navigator.mediaDevices?.getUserMedia;

// Streams the rear camera into `video` and calls onFound(rawValue) on the
// first code seen. Returns a stop() that always releases the camera.
export async function startScan(video, onFound, timeoutMs = 8000) {
  // Start the decoder fetch (iOS path) in parallel with the camera prompt.
  const decoderPending = hasDetector()
    ? null
    : import("./vendor/jsqr.js").then((m) => m.default);
  // A camera held by another app can leave getUserMedia pending forever;
  // fail loudly instead of showing a dead black rectangle.
  const pending = navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  });
  let stream;
  try {
    stream = await Promise.race([
      pending,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("camera timeout")), timeoutMs)
      ),
    ]);
  } catch (err) {
    // If the stream shows up after we gave up, release it.
    pending.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
    throw err;
  }
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  try {
    video.srcObject = stream;
    // Best effort: play() can stay pending on a stream that hasn't delivered a
    // frame yet, and the detect loop retries regardless.
    video.play().catch(() => {});
    const detect = await makeDetector(video, decoderPending);
    const tick = async () => {
      if (stopped) return;
      try {
        const raw = await detect();
        if (raw) {
          stop();
          onFound(raw);
          return;
        }
      } catch {
        // Decode errors between frames are normal — keep looking.
      }
      setTimeout(tick, 200);
    };
    tick();
  } catch (err) {
    stop();
    throw err;
  }
  return stop;
}

// One frame → rawValue|null, via whichever decoder this browser has.
async function makeDetector(video, decoderPending) {
  if (hasDetector()) {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    return async () => (await detector.detect(video))[0]?.rawValue ?? null;
  }
  const jsQR = await decoderPending;
  if (typeof jsQR !== "function") throw new Error("no decoder");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return () => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null; // no frame delivered yet
    // Decode at a capped size — plenty for a QR, much cheaper on phones.
    const scale = Math.min(1, 640 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height)?.data ?? null;
  };
}
