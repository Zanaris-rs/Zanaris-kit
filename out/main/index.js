"use strict";
const electron = require("electron");
const node_fs = require("node:fs");
const node_path = require("node:path");
const DEFAULT_PORT = 8888;
function resolveServerRoot() {
  const override = process.env.SWIFTKIT_SERVER_ROOT;
  if (override) {
    return node_path.resolve(override);
  }
  return node_path.resolve(__dirname, "../../..");
}
function resolveServerTarget() {
  const serverRoot = resolveServerRoot();
  const configPath = node_path.resolve(serverRoot, "engine/data/config/world.json");
  let port = DEFAULT_PORT;
  let source;
  try {
    const raw = node_fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const configured = parsed.web?.port;
    if (typeof configured === "number" && Number.isInteger(configured) && configured > 0 && configured < 65536) {
      port = configured;
      source = configPath;
    } else {
      source = `${configPath} (no usable web.port — fell back to ${DEFAULT_PORT})`;
    }
  } catch (err) {
    source = `${configPath} unreadable (${err.message}) — fell back to ${DEFAULT_PORT}`;
  }
  return { url: `http://127.0.0.1:${port}/rs2.cgi`, port, source, serverRoot };
}
async function isReachable(url, timeoutMs = 2e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
const RNG_PROBE_SOURCE = `(() => {
    if (window.__swiftkitRng) return;
    const orig = Math.random;
    const N = 65536;
    const ring = new Float64Array(N);
    let seq = 0;
    const patched = function random() {
        const v = orig();
        ring[seq % N] = v;
        seq++;
        return v;
    };
    window.__swiftkitRng = {
        installed: true,
        get seq() { return seq; },
        patched: () => Math.random === patched,
        dump(tail) {
            const want = tail || 16384;
            const start = Math.max(0, seq - Math.min(want, N));
            const values = [];
            for (let i = start; i < seq; i++) values.push(ring[i % N]);
            return { baseSeq: start, seq, values };
        },
        disarm() { Math.random = orig; return seq; }
    };
    Math.random = patched;
})();`;
const RANDOM_MULTIPLIER = 99999999;
function seedWordFromRandom(r) {
  return Math.floor(RANDOM_MULTIPLIER * r) | 0;
}
function findAdjacentPair(dump, want0, want1) {
  const v = dump.values;
  for (let i = 0; i + 1 < v.length; i++) {
    if (seedWordFromRandom(v[i]) === want0 && seedWordFromRandom(v[i + 1]) === want1) {
      return { found: true, index: dump.baseSeq + i, candidates: Math.max(v.length - 1, 0) };
    }
  }
  return { found: false, index: null, candidates: Math.max(v.length - 1, 0) };
}
const OPCODE_GAME_LOGIN = 14;
const OPCODE_ONDEMAND = 15;
function frameBytes(response) {
  const data = response?.payloadData;
  if (!data) return new Uint8Array(0);
  if (response?.opcode === 1) return new Uint8Array(Buffer.from(data, "utf8"));
  return new Uint8Array(Buffer.from(data, "base64"));
}
class WebSocketTap {
  constructor(wc, log2, injectRngProbe) {
    this.wc = wc;
    this.log = log2;
    this.injectRngProbe = injectRngProbe;
  }
  wc;
  log;
  injectRngProbe;
  sockets = /* @__PURE__ */ new Map();
  reportTimer = null;
  attached = false;
  /** Called for every game-socket frame, in order, once the socket is classified. */
  onGameFrame = null;
  /** Snapshot of the game socket, for the sidebar's connection panel. */
  gameStats() {
    for (const s of this.sockets.values()) {
      if (s.kind === "game") {
        return {
          open: !s.closed,
          txFrames: s.txFrames,
          rxFrames: s.rxFrames,
          txBytes: s.txBytes,
          rxBytes: s.rxBytes
        };
      }
    }
    return { open: false, txFrames: 0, rxFrames: 0, txBytes: 0, rxBytes: 0 };
  }
  async attach() {
    try {
      this.wc.debugger.attach("1.3");
    } catch (err) {
      this.log(`[tap] FAILED to attach debugger: ${err.message}`);
      return;
    }
    this.attached = true;
    this.wc.debugger.on("detach", (_e, reason) => {
      this.attached = false;
      this.log(`[tap] debugger detached: ${reason}`);
    });
    this.wc.debugger.on("message", (_event, method, params) => {
      try {
        this.onCdpMessage(method, params);
      } catch (err) {
        this.log(`[tap] handler error (swallowed): ${err.message}`);
      }
    });
    await this.wc.debugger.sendCommand("Network.enable");
    this.log("[tap] Network domain enabled — frame mirroring active");
    if (this.injectRngProbe) {
      await this.wc.debugger.sendCommand("Page.enable");
      await this.wc.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
        source: RNG_PROBE_SOURCE
      });
      this.log("[tap] RNG probe registered for document_start (main world)");
    }
    this.reportTimer = setInterval(() => this.report(), 5e3);
  }
  detach() {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
    if (this.attached) {
      try {
        this.wc.debugger.detach();
      } catch {
      }
    }
  }
  classify(s, first) {
    if (first === OPCODE_GAME_LOGIN) {
      s.kind = "game";
      this.log("[tap] socket classified: game (first client byte 14)");
    } else if (first === OPCODE_ONDEMAND) {
      s.kind = "ondemand";
      this.log("[tap] socket classified: ondemand (first client byte 15) — ignored");
    } else {
      return;
    }
    if (s.kind === "game") {
      for (const f of s.pending) this.onGameFrame?.(f.dir, f.bytes);
    }
    s.pending.length = 0;
  }
  record(s, dir, bytes) {
    if (s.kind === "unknown") {
      s.pending.push({ dir, bytes });
    } else if (s.kind === "game") {
      this.onGameFrame?.(dir, bytes);
    }
  }
  onCdpMessage(method, params) {
    switch (method) {
      case "Network.webSocketCreated": {
        const p = params;
        this.sockets.set(p.requestId, {
          id: p.requestId,
          url: p.url,
          kind: "unknown",
          txFrames: 0,
          rxFrames: 0,
          txBytes: 0,
          rxBytes: 0,
          closed: false,
          pending: []
        });
        this.log(`[tap] socket opened: ${p.url}`);
        break;
      }
      case "Network.webSocketFrameSent": {
        const p = params;
        const s = this.sockets.get(p.requestId);
        if (!s) break;
        const bytes = frameBytes(p.response);
        if (s.kind === "unknown" && bytes.length > 0) this.classify(s, bytes[0]);
        s.txFrames++;
        s.txBytes += bytes.length;
        this.record(s, "up", bytes);
        break;
      }
      case "Network.webSocketFrameReceived": {
        const p = params;
        const s = this.sockets.get(p.requestId);
        if (!s) break;
        const bytes = frameBytes(p.response);
        s.rxFrames++;
        s.rxBytes += bytes.length;
        this.record(s, "down", bytes);
        break;
      }
      case "Network.webSocketClosed": {
        const p = params;
        const s = this.sockets.get(p.requestId);
        if (s) {
          s.closed = true;
          this.log(`[tap] socket closed: ${s.kind}`);
        }
        break;
      }
    }
  }
  report() {
    if (this.sockets.size === 0) return;
    const lines = [...this.sockets.values()].map(
      (s) => `  ${s.kind.padEnd(8)} tx ${String(s.txFrames).padStart(6)} / ${String(s.txBytes).padStart(9)} B   rx ${String(s.rxFrames).padStart(6)} / ${String(s.rxBytes).padStart(9)} B`
    );
    this.log(`[tap] ${this.sockets.size} socket(s)
${lines.join("\n")}`);
  }
}
const S2C_SEED_OFFSET = 9;
const C2S_LOGIN_OFFSET = 2;
class HandshakeReader {
  constructor(onComplete, log2) {
    this.onComplete = onComplete;
    this.log = log2;
  }
  onComplete;
  log;
  up = [];
  down = [];
  done = false;
  feed(dir, bytes) {
    if (this.done) return;
    const sink = dir === "up" ? this.up : this.down;
    for (const b of bytes) sink.push(b);
    this.tryParse();
  }
  tryParse() {
    if (this.down.length < S2C_SEED_OFFSET + 8) return;
    if (this.up.length < C2S_LOGIN_OFFSET + 45) return;
    const responseCode = this.down[8];
    if (responseCode !== 0) {
      this.log(`[seed] server refused login with code ${responseCode} — no seed exchanged`);
      this.done = true;
      return;
    }
    const seedBytes = Buffer.from(this.down.slice(S2C_SEED_OFFSET, S2C_SEED_OFFSET + 8));
    const serverSeedHi = seedBytes.readUInt32BE(0) | 0;
    const serverSeedLo = seedBytes.readUInt32BE(4) | 0;
    const up = Buffer.from(this.up);
    const opcode = up[C2S_LOGIN_OFFSET];
    if (opcode !== 16 && opcode !== 18) {
      this.log(`[seed] unexpected login opcode ${opcode} at offset ${C2S_LOGIN_OFFSET} — layout mismatch`);
      this.done = true;
      return;
    }
    let p = C2S_LOGIN_OFFSET + 2;
    const marker = up[p];
    p += 1;
    if (marker !== 255) {
      this.log(`[seed] expected 255 revision marker, got ${marker} — layout mismatch`);
      this.done = true;
      return;
    }
    const revision = up.readUInt16BE(p);
    p += 2;
    p += 1;
    p += 36;
    const rsaLen = up[p];
    p += 1;
    if (up.length < p + rsaLen) return;
    const rsaBlock = up.subarray(p, p + rsaLen);
    this.done = true;
    this.onComplete({ serverSeedHi, serverSeedLo, revision, reconnect: opcode === 18, rsaBlock });
  }
}
function bytesToBigInt(b) {
  let v = 0n;
  for (const byte of b) {
    v = v << 8n | BigInt(byte);
  }
  return v;
}
function bigIntToBytes(v) {
  if (v === 0n) return Buffer.from([0]);
  const out = [];
  while (v > 0n) {
    out.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return Buffer.from(out);
}
function modPow(base, exp, mod) {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = result * b % mod;
    b = b * b % mod;
    e >>= 1n;
  }
  return result;
}
function readTlv(buf, pos) {
  const tag = buf[pos];
  let p = pos + 1;
  let len = buf[p];
  p += 1;
  if (len & 128) {
    const count = len & 127;
    len = 0;
    for (let i = 0; i < count; i++) {
      len = len << 8 | buf[p];
      p += 1;
    }
  }
  return { tag, valueStart: p, valueEnd: p + len };
}
function readDerInt(buf, pos) {
  const t = readTlv(buf, pos);
  return { value: bytesToBigInt(buf.subarray(t.valueStart, t.valueEnd)), next: t.valueEnd };
}
function loadPrivateKey(pemPath) {
  const pem = node_fs.readFileSync(pemPath, "utf8");
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""), "base64");
  const pkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  let body = der;
  if (!pkcs1) {
    const outer = readTlv(der, 0);
    let p = outer.valueStart;
    p = readTlv(der, p).valueEnd;
    p = readTlv(der, p).valueEnd;
    const octet = readTlv(der, p);
    body = der.subarray(octet.valueStart, octet.valueEnd);
  }
  const seq = readTlv(body, 0);
  let q = seq.valueStart;
  q = readTlv(body, q).valueEnd;
  const n = readDerInt(body, q);
  const e = readDerInt(body, n.next);
  const d = readDerInt(body, e.next);
  return { n: n.value, d: d.value };
}
function decryptLoginBlock(rsaBlock, key) {
  const plain = bigIntToBytes(modPow(bytesToBigInt(rsaBlock), key.d, key.n));
  return {
    magic: plain[0],
    seeds: [plain.readInt32BE(1), plain.readInt32BE(5), plain.readInt32BE(9), plain.readInt32BE(13)]
  };
}
const RAIL_WIDTH = 48;
const PANEL_WIDTH = 280;
const MIN_GAME_WIDTH = 480;
function sidebarWidth(open) {
  return open ? RAIL_WIDTH + PANEL_WIDTH : RAIL_WIDTH;
}
function computeLayout(input) {
  const sw = sidebarWidth(input.open);
  const height = input.window.height;
  const pushLayout = () => {
    const gameW = Math.max(MIN_GAME_WIDTH, input.window.width - sw);
    const shellW = Math.max(0, input.window.width - gameW);
    return {
      mode: "push",
      window: { ...input.window },
      game: { x: 0, y: 0, width: gameW, height },
      shell: { x: gameW, y: 0, width: shellW, height }
    };
  };
  if (!input.canResize) return pushLayout();
  const desiredWidth = input.gameWidth + sw;
  if (desiredWidth > input.workArea.width) return pushLayout();
  let x = input.window.x;
  const rightEdge = input.workArea.x + input.workArea.width;
  if (x + desiredWidth > rightEdge) x = rightEdge - desiredWidth;
  if (x < input.workArea.x) x = input.workArea.x;
  return {
    mode: "widen",
    window: { x, y: input.window.y, width: desiredWidth, height },
    game: { x: 0, y: 0, width: input.gameWidth, height },
    shell: { x: input.gameWidth, y: 0, width: sw, height }
  };
}
const IPC = {
  sidebarToggle: "swiftkit:sidebar-toggle",
  sidebarSetOpen: "swiftkit:sidebar-set-open",
  sidebarState: "swiftkit:sidebar-state",
  sessionState: "swiftkit:session-state"
};
const SEAM_ENABLED = process.env.SWIFTKIT_SEAM !== "0";
const RNG_PROBE_ENABLED = process.env.SWIFTKIT_RNG !== "0";
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;
const CAPTURE_DIR = process.env.SWIFTKIT_CAPTURE;
const log = (msg) => console.log(msg);
let win = null;
let gameView = null;
let shellView = null;
let tap = null;
let target;
let pollTimer = null;
let statsTimer = null;
let sidebarOpen = false;
let sidebarMode = "widen";
let gameWidth = 800;
let applyingLayout = false;
const session_ = {
  revision: null,
  seedRecovered: null
};
function applyLayout() {
  if (!win || !gameView || !shellView || win.isDestroyed()) return;
  const current = win.getContentBounds();
  const display = electron.screen.getDisplayMatching(win.getBounds());
  const result = computeLayout({
    open: sidebarOpen,
    window: current,
    workArea: display.workArea,
    gameWidth,
    canResize: !win.isMaximized() && !win.isFullScreen()
  });
  sidebarMode = result.mode;
  const w = result.window;
  if (w.x !== current.x || w.y !== current.y || w.width !== current.width || w.height !== current.height) {
    applyingLayout = true;
    win.setContentBounds(w);
    applyingLayout = false;
  }
  gameView.setBounds(result.game);
  shellView.setBounds(result.shell);
  pushSidebarState();
}
function sidebarState() {
  return { open: sidebarOpen, mode: sidebarMode };
}
function pushSidebarState() {
  shellView?.webContents.send(IPC.sidebarState, sidebarState());
}
function pushSessionState() {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  const stats = tap?.gameStats() ?? { open: false, txFrames: 0, rxFrames: 0, txBytes: 0, rxBytes: 0 };
  const state = {
    serverUrl: target.url,
    socketOpen: stats.open,
    txFrames: stats.txFrames,
    rxFrames: stats.rxFrames,
    txBytes: stats.txBytes,
    rxBytes: stats.rxBytes,
    revision: session_.revision,
    seedRecovered: session_.seedRecovered
  };
  shellView.webContents.send(IPC.sessionState, state);
}
async function verifySeedRecovery(h) {
  session_.revision = h.revision;
  log(`[seed] revision ${h.revision}, server seed ${h.serverSeedHi}/${h.serverSeedLo}`);
  let dump = null;
  try {
    dump = await gameView.webContents.executeJavaScript(
      "window.__swiftkitRng ? window.__swiftkitRng.dump() : null"
    );
  } catch {
  }
  if (!dump) {
    log("[seed] RNG probe not installed — cannot recover");
    session_.seedRecovered = false;
    pushSessionState();
    return;
  }
  const pemPath = node_path.resolve(target.serverRoot, "engine/data/config/private.pem");
  if (!node_fs.existsSync(pemPath)) {
    log("[seed] no private.pem — skipping oracle verification");
    pushSessionState();
    return;
  }
  try {
    const { magic, seeds } = decryptLoginBlock(h.rsaBlock, loadPrivateKey(pemPath));
    const plaintextMatch = seeds[2] === h.serverSeedHi && seeds[3] === h.serverSeedLo;
    const pair = findAdjacentPair(dump, seeds[0], seeds[1]);
    session_.seedRecovered = magic === 10 && plaintextMatch && pair.found;
    log(
      `[seed] recovered=${session_.seedRecovered} (magic ${magic}, plaintext ${plaintextMatch}, pair ${pair.found ? `at draw #${pair.index}/${dump.seq}` : "not found"})`
    );
  } catch (err) {
    session_.seedRecovered = false;
    log(`[seed] verification failed: ${err.message}`);
  }
  try {
    await gameView.webContents.executeJavaScript("window.__swiftkitRng.disarm()");
    log("[rng] disarmed — Math.random restored to native");
  } catch {
  }
  pushSessionState();
}
const wait = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
async function captureAndExit(dir) {
  if (!shellView) return;
  node_fs.mkdirSync(dir, { recursive: true });
  const shot = async (name) => {
    const image = await shellView.webContents.capturePage();
    node_fs.writeFileSync(node_path.join(dir, `${name}.png`), image.toPNG());
    log(`[capture] ${name}.png`);
  };
  sidebarOpen = false;
  applyLayout();
  await wait(350);
  await shot("rail-closed");
  sidebarOpen = true;
  applyLayout();
  await wait(350);
  await shot("panel-empty");
  const populated = {
    serverUrl: target.url,
    socketOpen: true,
    txFrames: 773,
    rxFrames: 2694,
    txBytes: 2100,
    rxBytes: 11909,
    revision: 289,
    seedRecovered: true
  };
  shellView.webContents.send(IPC.sessionState, populated);
  await wait(350);
  await shot("panel-live");
  electron.app.quit();
}
function createGameView() {
  const view = new electron.WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // No preload. Our code stays out of the game page entirely.
      session: electron.session.fromPartition("persist:swiftkit-game")
    }
  });
  const allowedOrigin = `http://127.0.0.1:${target.port}`;
  view.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(allowedOrigin) && !url.startsWith("about:")) {
      event.preventDefault();
      log(`[nav] blocked navigation to ${url}`);
    }
  });
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) void electron.shell.openExternal(url);
    return { action: "deny" };
  });
  return view;
}
function createShellView() {
  const view = new electron.WebContentsView({
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  view.setBackgroundColor("#0d0b09");
  if (RENDERER_DEV_URL) {
    void view.webContents.loadURL(RENDERER_DEV_URL);
  } else {
    void view.webContents.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  }
  return view;
}
async function loadGameWhenReady() {
  if (!gameView) return;
  if (await isReachable(target.url)) {
    log(`[main] server reachable — loading ${target.url}`);
    await gameView.webContents.loadURL(target.url);
    return;
  }
  log(`[main] server not reachable at ${target.url} — waiting`);
  pollTimer = setInterval(async () => {
    if (!gameView || gameView.webContents.isDestroyed()) return;
    if (await isReachable(target.url)) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      log(`[main] server came up — loading ${target.url}`);
      await gameView.webContents.loadURL(target.url);
    }
  }, 2e3);
}
electron.app.whenReady().then(async () => {
  target = resolveServerTarget();
  log("");
  log("  SwiftKit");
  log(`  server root : ${target.serverRoot}`);
  log(`  target      : ${target.url}`);
  log(`  seam        : ${SEAM_ENABLED ? "ON (CDP, observe-only)" : "OFF"}`);
  log("");
  win = new electron.BrowserWindow({
    width: gameWidth + RAIL_WIDTH,
    height: 700,
    minWidth: MIN_GAME_WIDTH + RAIL_WIDTH,
    minHeight: 480,
    title: "SwiftKit",
    backgroundColor: "#0d0b09",
    show: false
  });
  gameView = createGameView();
  shellView = createShellView();
  win.contentView.addChildView(gameView);
  win.contentView.addChildView(shellView);
  applyLayout();
  win.once("ready-to-show", () => win?.show());
  shellView.webContents.once("did-finish-load", () => {
    win?.show();
    pushSidebarState();
    pushSessionState();
  });
  win.on("resize", () => {
    if (applyingLayout || !win) return;
    gameWidth = Math.max(MIN_GAME_WIDTH, win.getContentBounds().width - sidebarWidth(sidebarOpen));
    applyLayout();
  });
  win.on("maximize", () => applyLayout());
  win.on("unmaximize", () => applyLayout());
  win.on("enter-full-screen", () => applyLayout());
  win.on("leave-full-screen", () => applyLayout());
  win.on("closed", () => {
    win = null;
    gameView = null;
    shellView = null;
  });
  await gameView.webContents.loadURL("about:blank");
  if (SEAM_ENABLED) {
    tap = new WebSocketTap(gameView.webContents, log, RNG_PROBE_ENABLED);
    const reader = new HandshakeReader((h) => void verifySeedRecovery(h), log);
    tap.onGameFrame = (dir, bytes) => reader.feed(dir, bytes);
    await tap.attach();
  }
  if (CAPTURE_DIR) {
    await new Promise((resolve2) => shellView.webContents.once("did-finish-load", () => resolve2()));
    await captureAndExit(CAPTURE_DIR);
    return;
  }
  statsTimer = setInterval(pushSessionState, 1e3);
  await loadGameWhenReady();
});
electron.ipcMain.handle(IPC.sidebarToggle, () => {
  sidebarOpen = !sidebarOpen;
  applyLayout();
  return sidebarState();
});
electron.ipcMain.handle(IPC.sidebarSetOpen, (_e, open) => {
  sidebarOpen = open === true;
  applyLayout();
  return sidebarState();
});
electron.app.on("window-all-closed", () => electron.app.quit());
electron.app.on("before-quit", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (statsTimer) clearInterval(statsTimer);
  tap?.detach();
});
