// Measure the real page in a real browser, from `node --test`.
//
// Why this exists, in one sentence: a layout that is MODELLED is not the
// layout a person sees. The app icon shipped clipped on Android because
// getBBox() said its ink reached r=38.4 and rasterising said 45.8 — the
// measurement and the renderer disagreed and only one of them is what
// somebody looks at. A test was then written that measured the same wrong
// way, and it passed.
//
// The landing screen had the same hole in a worse place. Its acceptance
// criterion was "the call to action is above the fold on a 375x667 phone",
// the numbers were taken by hand and written into a comment, and the guards
// that shipped were about word counts and DOM order. Two lines appended to
// styles.css — a padding and a font-size, the most ordinary edit there is —
// put the button 58px under the fold again with every test still green. A
// measurement is not a test. This is the test.
//
// No dependencies, because there are none in this project (ADR-0001) and a
// headless-browser package plus its browser download is not a devDependency
// this repo is going to carry. So: a static server over node:http, Chrome
// in headless mode, and CDP over a hand-rolled WebSocket, which is about
// eighty lines and has no version to keep up with.
//
// It measures the tree it is given, unmodified — nothing is injected into
// index.html, because a page with an extra script in it is a different
// page.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, normalize, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- finding a browser ----------

// A contributor on a distro nobody here has, or a CI image that moves the
// binary, needs a way in that is not editing this list.
const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
];

export function findChrome() {
  // CHROME_PATH is the last word, both ways. Naming a binary that is not
  // there and then quietly measuring with a different one is how a machine
  // reports on a browser nobody asked it about; the honest answer is "no
  // browser", which skips out loud and fails the release gate.
  const named = process.env.CHROME_PATH || process.env.CHROME_BIN;
  if (named) return existsSync(named) ? named : null;

  for (const path of CANDIDATES) if (existsSync(path)) return path;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      const found = execFileSync("command", ["-v", name], { shell: true, encoding: "utf8" }).trim();
      if (found && existsSync(found)) return found;
    } catch { /* not on PATH */ }
  }
  return null;
}

// ---------- a WebSocket client, because CDP speaks nothing else ----------

function websocket(url) {
  const u = new URL(url);
  const sock = connect(Number(u.port), u.hostname);
  const key = randomBytes(16).toString("base64");
  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  const listeners = [];
  let buf = Buffer.alloc(0);
  let frag = Buffer.alloc(0);
  let open = false;
  let opened, failed;
  const ready = new Promise((res, rej) => { opened = res; failed = rej; });
  sock.on("error", (e) => failed(e));

  sock.on("connect", () => sock.write(
    `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\n` +
    `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));

  sock.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      const end = buf.indexOf("\r\n\r\n");
      if (end === -1) return;
      if (!buf.subarray(0, end).toString().includes(accept)) {
        sock.destroy();
        return failed(new Error("the browser refused the websocket handshake"));
      }
      buf = buf.subarray(end + 4);
      open = true;
      opened();
    }
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const short = buf[1] & 0x7f;
      let off = 2, len = short;
      if (short === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (short === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      const payload = buf.subarray(off, off + len);
      buf = buf.subarray(off + len);
      if (opcode === 0x8) { sock.destroy(); return; }          // close
      if (opcode !== 0x1 && opcode !== 0x0) continue;           // ping/pong/binary
      frag = Buffer.concat([frag, payload]);
      if (!fin) continue;
      const text = frag.toString();
      frag = Buffer.alloc(0);
      for (const fn of listeners) fn(text);
    }
  });

  const send = (text) => {
    const body = Buffer.from(text);
    const mask = randomBytes(4);
    let header;
    if (body.length < 126) header = Buffer.from([0x81, 0x80 | body.length]);
    else if (body.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81; header[1] = 0xfe; header.writeUInt16BE(body.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81; header[1] = 0xff; header.writeBigUInt64BE(BigInt(body.length), 2);
    }
    const masked = Buffer.from(body);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    sock.write(Buffer.concat([header, mask, masked]));
  };

  return { ready, send, onMessage: (fn) => listeners.push(fn), close: () => sock.destroy() };
}

async function devtools(url) {
  const conn = websocket(url);
  await conn.ready;
  let id = 0;
  const pending = new Map();
  const events = [];
  conn.onMessage((text) => {
    const msg = JSON.parse(text);
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve: res, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`)) : res(msg.result);
    } else if (msg.method) {
      for (const fn of events) fn(msg);
    }
  });
  return {
    send: (method, params = {}) => new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, { resolve: res, reject: rej });
      conn.send(JSON.stringify({ id: n, method, params }));
    }),
    on: (fn) => events.push(fn),
    close: () => conn.close(),
  };
}

// ---------- the tree, served ----------

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function serve(root) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split("?")[0]);
    const rel = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(root, rel));
      res.writeHead(200, { "content-type": TYPES[extname(rel)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not here");
    }
  });
  return new Promise((res) => server.listen(0, "127.0.0.1",
    () => res({ port: server.address().port, close: () => server.close() })));
}

const deadline = (ms, what) => new Promise((_, rej) =>
  setTimeout(() => rej(new Error(`timed out after ${ms}ms: ${what}`)), ms).unref?.());

// ---------- what a person sees ----------

// Everything a measurement needs before it means anything: the fonts
// loaded, boot() finished painting, and two frames for layout to land.
// `settleOn` is the id that must be laid out first — paint here is
// asynchronous, because boot() reads storage, decides the audience and then
// writes the screen, so measuring on load fires the tape measure at a page
// that is still empty.
const settleFor = (settleOn) => `(async () => {
  await document.fonts.ready;
  const painted = () => {
    const el = document.getElementById(${JSON.stringify(settleOn ?? "")});
    return el && !el.hidden && el.getBoundingClientRect().height > 0;
  };
  for (let i = 0; i < 200 && !painted(); i++) await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return JSON.stringify(painted());
})()`;

// Loads `root` at the given viewport with EMPTY storage — a throwaway
// profile per run, so this is always somebody's first arrival — waits for
// the page to settle, and hands `run` two things:
//
//   evaluate(expression) → whatever the page JSON-stringifies back
//   click(x, y)          → a real mouse press and release at that point
//
// The click is not a convenience. `:focus-visible` is a heuristic about how
// focus ARRIVED, and a scripted `el.focus()` does not satisfy it — measured
// here: focusing an amount input from script leaves `:focus-visible` false
// and the row draws no ring, which would have read as the defect rather
// than as the wrong gesture. A dispatched mouse event goes through the same
// pipeline a finger does.
//
// Two callers want different things from one browser: tests/fold.test.mjs
// measures boxes, tests/focus.test.mjs focuses a control and reads the
// style the renderer resolved. Booting Chrome is the expensive part and
// there is no reason to write it twice.
export async function page({
  root = ROOT, width = 375, height = 667, settleOn, chrome = findChrome(),
} = {}, run) {
  if (!chrome) throw new Error("no browser found");
  const site = await serve(root);
  const profile = await mkdtemp(join(tmpdir(), "tripcash-layout-"));
  const proc = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
    "--disable-extensions", "--disable-background-networking",
    `--user-data-dir=${profile}`, "--remote-debugging-port=0",
    // Nothing off this machine. The app is offline-first and the rates
    // fetch must not decide how long this takes or whether it passes.
    "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  // Chrome writes its profile as it shuts down, so removing the directory
  // while it is still exiting raced and threw ENOTEMPTY out of the service
  // worker cache — a failure that looked exactly like the layout assertion
  // it interrupted. Wait for the process, then treat a leftover temp
  // directory as litter rather than as a verdict about the page.
  const cleanup = async () => {
    proc.kill();
    site.close();
    if (proc.exitCode === null && proc.signalCode === null) {
      await Promise.race([
        new Promise((res) => proc.once("exit", res)),
        new Promise((res) => setTimeout(res, 5000).unref?.()),
      ]);
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      .catch(() => {});
  };

  try {
    const wsUrl = await Promise.race([
      new Promise((res, rej) => {
        let err = "";
        proc.on("error", rej);
        proc.stderr.on("data", (d) => {
          err += d;
          const m = err.match(/DevTools listening on (ws:\S+)/);
          if (m) res(m[1]);
        });
      }),
      deadline(30000, "waiting for Chrome to start"),
    ]);

    const targets = await (await fetch(new URL("/json/list", wsUrl.replace(/^ws:/, "http:")))).json();
    const target = targets.find((t) => t.type === "page");
    if (!target) throw new Error("Chrome started with no page target");
    const cdp = await devtools(target.webSocketDebuggerUrl);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    // mobile:true is not decoration: it gives overlay scrollbars, and a
    // classic 15px scrollbar would narrow the layout to 360 and change what
    // wraps. The phone this is standing in for has no scrollbar gutter.
    await cdp.send("Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 1, mobile: true });

    const loaded = new Promise((res) => cdp.on((m) => m.method === "Page.loadEventFired" && res()));
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${site.port}/` });
    await Promise.race([loaded, deadline(30000, "waiting for the page to load")]);

    const evaluate = async (expression, what = "evaluating in the page") => {
      const { result, exceptionDetails } = await Promise.race([
        cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
        deadline(60000, what),
      ]);
      // The description carries the stack. Without it this reads "Uncaught",
      // which says a probe broke but not which line of it.
      if (exceptionDetails) {
        throw new Error(`${what} threw: ${exceptionDetails.exception?.description
          ?? exceptionDetails.exception?.value ?? exceptionDetails.text}`);
      }
      return JSON.parse(result.value);
    };

    const click = async (x, y) => {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await cdp.send("Input.dispatchMouseEvent",
          { type, x, y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0 });
      }
    };

    await evaluate(settleFor(settleOn), "waiting for the page to settle");
    const answer = await run({ evaluate, click });
    cdp.close();
    return answer;
  } finally {
    await cleanup();
  }
}

// The bounding boxes of `ids` in CSS pixels, plus the fold (innerHeight).
export function layout({ ids = [], ...opts } = {}) {
  return page(opts, ({ evaluate }) => evaluate(`(() => {
    const painted = () => {
      const el = document.getElementById(${JSON.stringify(opts.settleOn ?? "")});
      return el && !el.hidden && el.getBoundingClientRect().height > 0;
    };
    const box = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
        height: +r.height.toFixed(1), width: +r.width.toFixed(1),
        hidden: !!el.hidden,
        shown: !el.hidden && r.height > 0 && getComputedStyle(el).visibility !== "hidden",
      };
    };
    const boxes = {};
    for (const id of ${JSON.stringify(ids)}) boxes[id] = box(id);
    return JSON.stringify({
      fold: innerHeight, width: innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
      settled: painted(), boxes,
    });
  })()`, "measuring the page"));
}

// A readable dump of a measurement, for a failure message. A number with no
// stack around it does not tell the next person which block grew.
export function stack(m) {
  const rows = Object.entries(m.boxes).map(([id, b]) =>
    b == null ? `  #${id}: absent`
      : b.hidden ? `  #${id}: hidden`
        : `  #${id}: ${b.top}–${b.bottom}${b.bottom > m.fold ? "   ← under the fold" : ""}`);
  return [`viewport ${m.width}x${m.fold}, page ${m.scrollHeight} tall`, ...rows].join("\n");
}
