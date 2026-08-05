// Camera QR scanning via the browser's built-in BarcodeDetector (Android
// Chrome). Where it isn't available the scan button never appears.

export const scanSupported = () =>
  typeof globalThis.BarcodeDetector === "function" && !!navigator.mediaDevices?.getUserMedia;

// Streams the rear camera into `video` and calls onFound(rawValue) on the
// first code seen. Returns a stop() that always releases the camera.
export async function startScan(video, onFound, timeoutMs = 8000) {
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
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const tick = async () => {
      if (stopped) return;
      try {
        const [code] = await detector.detect(video);
        if (code?.rawValue) {
          stop();
          onFound(code.rawValue);
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
