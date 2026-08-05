# ADR-0007: Vendored jsQR fallback so the scanner exists on iOS

Date: 2026-08-05 · Status: accepted

## Context
The payment-QR scanner used the browser's BarcodeDetector API, which iOS
Safari (and therefore every iPhone browser, all WebKit) does not have —
so the feature silently didn't exist on the primary platform. ADR-0001
says no runtime dependencies, but the only alternatives were "no scanner
on iPhones" or a server (out of scope).

## Decision
Vendor jsQR 1.4.0 (Apache-2.0, ~130 KB minified) as a self-hosted file at
`js/vendor/jsqr.js`, wrapped as an ES module. It is loaded lazily via
dynamic import only when BarcodeDetector is missing, so Android never
parses it. Frames are decoded through a canvas capped at 640 px. The file
is in the service-worker precache, keeping the offline promise. No
package manager, no build step — replace the file wholesale to upgrade.

## Consequences
- The scan button now shows wherever `getUserMedia` exists, including
  iPhones; `scanSupported()` no longer checks BarcodeDetector.
- One vendored third-party file to track for updates (jsQR is stable and
  effectively feature-complete).
- The no-runtime-deps rule now reads: no *package-managed* runtime deps;
  vendored, versioned, self-hosted single files are allowed with an ADR.
