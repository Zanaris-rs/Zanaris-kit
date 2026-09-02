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
  /** Fired when a new game socket opens, so decode state can be reset. */
  onGameSocketOpen = null;
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
      this.onGameSocketOpen?.();
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
class Isaac {
  count = 0;
  rsl = new Int32Array(256);
  mem = new Int32Array(256);
  a = 0;
  b = 0;
  c = 0;
  constructor(seed = [0, 0, 0, 0]) {
    for (let i = 0; i < seed.length; i++) {
      this.rsl[i] = seed[i];
    }
    this.init();
  }
  // prettier-ignore
  init() {
    let a = 2654435769, b = 2654435769, c = 2654435769, d = 2654435769, e = 2654435769, f = 2654435769, g = 2654435769, h = 2654435769;
    const mix = () => {
      a ^= b << 11;
      d += a;
      b += c;
      b ^= c >>> 2;
      e += b;
      c += d;
      c ^= d << 8;
      f += c;
      d += e;
      d ^= e >>> 16;
      g += d;
      e += f;
      e ^= f << 10;
      h += e;
      f += g;
      f ^= g >>> 4;
      a += f;
      g += h;
      g ^= h << 8;
      b += g;
      h += a;
      h ^= a >>> 9;
      c += h;
      a += b;
    };
    for (let i = 0; i < 4; i++) mix();
    for (let i = 0; i < 256; i += 8) {
      a += this.rsl[i];
      b += this.rsl[i + 1];
      c += this.rsl[i + 2];
      d += this.rsl[i + 3];
      e += this.rsl[i + 4];
      f += this.rsl[i + 5];
      g += this.rsl[i + 6];
      h += this.rsl[i + 7];
      mix();
      this.mem[i] = a;
      this.mem[i + 1] = b;
      this.mem[i + 2] = c;
      this.mem[i + 3] = d;
      this.mem[i + 4] = e;
      this.mem[i + 5] = f;
      this.mem[i + 6] = g;
      this.mem[i + 7] = h;
    }
    for (let i = 0; i < 256; i += 8) {
      a += this.mem[i];
      b += this.mem[i + 1];
      c += this.mem[i + 2];
      d += this.mem[i + 3];
      e += this.mem[i + 4];
      f += this.mem[i + 5];
      g += this.mem[i + 6];
      h += this.mem[i + 7];
      mix();
      this.mem[i] = a;
      this.mem[i + 1] = b;
      this.mem[i + 2] = c;
      this.mem[i + 3] = d;
      this.mem[i + 4] = e;
      this.mem[i + 5] = f;
      this.mem[i + 6] = g;
      this.mem[i + 7] = h;
    }
    this.isaac();
    this.count = 256;
  }
  isaac() {
    this.c++;
    this.b += this.c;
    for (let i = 0; i < 256; i++) {
      const x = this.mem[i];
      switch (i & 3) {
        case 0:
          this.a ^= this.a << 13;
          break;
        case 1:
          this.a ^= this.a >>> 6;
          break;
        case 2:
          this.a ^= this.a << 2;
          break;
        case 3:
          this.a ^= this.a >>> 16;
          break;
      }
      this.a += this.mem[i + 128 & 255];
      const y = this.mem[i] = this.mem[x >>> 2 & 255] + this.a + this.b;
      this.rsl[i] = this.b = this.mem[y >>> 8 >>> 2 & 255] + x;
    }
  }
  nextInt() {
    if (this.count-- === 0) {
      this.isaac();
      this.count = 255;
    }
    return this.rsl[this.count];
  }
}
const REVISION = 289;
const SERVER_PROT = [
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  { name: "TUT_OPEN", length: 2 },
  { name: "CHAT_FILTER_SETTINGS", length: 3 },
  null,
  null,
  null,
  null,
  { name: "IF_SETOBJECT", length: 6 },
  null,
  null,
  { name: "SET_PLAYER_OP", length: -1 },
  null,
  { name: "IF_CLOSE", length: 0 },
  null,
  null,
  null,
  null,
  { name: "UPDATE_INV_STOP_TRANSMIT", length: 2 },
  { name: "MIDI_JINGLE", length: 4 },
  { name: "IF_SETPLAYERHEAD", length: 2 },
  null,
  null,
  null,
  null,
  { name: "P_COUNTDIALOG", length: 0 },
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  { name: "UPDATE_RUNWEIGHT", length: 2 },
  { name: "UPDATE_IGNORELIST", length: -2 },
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  { name: "IF_OPENMAIN_SIDE", length: 4 },
  null,
  null,
  null,
  { name: "IF_SETTEXT", length: -2 },
  { name: "OBJ_ADD", length: 5 },
  null,
  null,
  { name: "IF_SETTAB", length: 3 },
  null,
  { name: "NPC_INFO", length: -2 },
  null,
  null,
  null,
  null,
  null,
  { name: "OBJ_DEL", length: 3 },
  null,
  { name: "CAM_MOVETO", length: 6 },
  null,
  { name: "VARP_SMALL", length: 3 },
  { name: "UPDATE_INV_PARTIAL", length: -2 },
  null,
  null,
  { name: "IF_SETPOSITION", length: 6 },
  null,
  { name: "IF_OPENCHAT", length: 2 },
  { name: "CAM_LOOKAT", length: 6 },
  { name: "LOC_MERGE", length: 14 },
  null,
  null,
  null,
  { name: "MAP_PROJANIM", length: 15 },
  null,
  null,
  { name: "LOC_ADD_CHANGE", length: 4 },
  null,
  null,
  null,
  null,
  null,
  null,
  { name: "VARP_LARGE", length: 6 },
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  { name: "LOC_ANIM", length: 4 },
  { name: "UPDATE_INV_FULL", length: -2 },
  null,
  null,
  null,
  null,
  { name: "UPDATE_ZONE_PARTIAL_ENCLOSED", length: -2 },
  null,
  null,
  { name: "HINT_ARROW", length: 6 },
  null,
  { name: "OBJ_COUNT", length: 7 },
  null,
  { name: "IF_OPENMAIN", length: 2 },
  { name: "UPDATE_PID", length: 3 },
  { name: "LOGOUT", length: 0 },
  null,
  null,
  null,
  null,
  null,
  { name: "IF_OPENOVERLAY", length: 2 },
  null,
  null,
  null,
  null,
  null,
  { name: "CAM_RESET", length: 0 },
  null,
  null,
  { name: "MINIMAP_TOGGLE", length: 1 },
  null,
  { name: "IF_SETHIDE", length: 3 },
  null,
  null,
  null,
  null,
  null,
  { name: "UPDATE_ZONE_FULL_FOLLOWS", length: 2 },
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  { name: "UPDATE_STAT", length: 6 },
  { name: "UPDATE_ZONE_PARTIAL_FOLLOWS", length: 2 },
  null,
  null,
  null,
  null,
  { name: "IF_SETCOLOUR", length: 4 },
  null,
  null,
  null,
  { name: "UNSET_MAP_FLAG", length: 0 },
  null,
  null,
  null,
  { name: "UPDATE_FRIENDLIST", length: 9 },
  null,
  null,
  null,
  { name: "RESET_CLIENT_VARCACHE", length: 0 },
  null,
  null,
  null,
  { name: "OBJ_REVEAL", length: 7 },
  { name: "SYNTH_SOUND", length: 5 },
  null,
  null,
  null,
  { name: "TUT_FLASH", length: 1 },
  null,
  null,
  { name: "IF_SETSCROLLPOS", length: 4 },
  null,
  null,
  { name: "MIDI_SONG", length: 2 },
  { name: "PLAYER_INFO", length: -2 },
  { name: "IF_SETTAB_ACTIVE", length: 1 },
  null,
  null,
  null,
  null,
  { name: "LOC_DEL", length: 2 },
  { name: "UPDATE_RUNENERGY", length: 1 },
  { name: "MESSAGE_GAME", length: -1 },
  null,
  null,
  null,
  null,
  { name: "RESET_ANIMS", length: 0 },
  null,
  null,
  { name: "UPDATE_REBOOT_TIMER", length: 2 },
  null,
  null,
  null,
  { name: "CAM_SHAKE", length: 4 },
  null,
  null,
  { name: "IF_SETANIM", length: 4 },
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  { name: "REBUILD_NORMAL", length: 4 },
  null,
  null,
  { name: "IF_SETMODEL", length: 4 },
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  { name: "MAP_ANIM", length: 6 },
  null,
  { name: "FRIENDLIST_LOADED", length: 1 },
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  { name: "MESSAGE_PRIVATE", length: -1 },
  { name: "IF_SETNPCHEAD", length: 4 },
  null,
  null,
  { name: "SET_MULTIWAY", length: 1 },
  null,
  null,
  null,
  null,
  { name: "IF_OPENSIDE", length: 2 },
  { name: "LAST_LOGIN_INFO", length: 10 },
  null,
  null
];
const SKILLS = ["attack", "defence", "strength", "hitpoints", "ranged", "prayer", "magic", "cooking", "woodcutting", "fletching", "fishing", "firemaking", "crafting", "smithing", "mining", "herblore", "agility", "thieving", "slayer", "-unused-", "runecraft", "-unused-", "-unused-", "-unused-", "-unused-"];
class FrameSplitter {
  buf = Buffer.alloc(0);
  pos = 0;
  pendingOpcode = null;
  pendingDef = null;
  pendingLen = null;
  desynced = false;
  desyncReason = null;
  packets = 0;
  // Node's strip-only type mode rejects parameter properties, and this file is
  // imported directly by the tests, so the fields are declared explicitly.
  isaac;
  onPacket;
  constructor(isaac, onPacket) {
    this.isaac = isaac;
    this.onPacket = onPacket;
  }
  push(bytes) {
    if (this.desynced) return;
    const remaining = this.buf.subarray(this.pos);
    this.buf = remaining.length === 0 ? Buffer.from(bytes) : Buffer.concat([remaining, bytes]);
    this.pos = 0;
    this.run();
    if (this.pos > 0) {
      this.buf = this.buf.subarray(this.pos);
      this.pos = 0;
    }
  }
  get available() {
    return this.buf.length - this.pos;
  }
  run() {
    for (; ; ) {
      if (this.pendingOpcode === null) {
        if (this.available < 1) return;
        const raw = this.buf[this.pos];
        this.pos += 1;
        const opcode = raw - this.isaac.nextInt() & 255;
        const def = SERVER_PROT[opcode];
        if (!def) {
          this.desynced = true;
          this.desyncReason = `unknown opcode ${opcode} after ${this.packets} packets`;
          return;
        }
        this.pendingOpcode = opcode;
        this.pendingDef = def;
        this.pendingLen = def.length >= 0 ? def.length : null;
      }
      if (this.pendingLen === null) {
        const need = this.pendingDef.length === -1 ? 1 : 2;
        if (this.available < need) return;
        this.pendingLen = need === 1 ? this.buf[this.pos] : this.buf.readUInt16BE(this.pos);
        this.pos += need;
      }
      if (this.available < this.pendingLen) return;
      const payload = Uint8Array.prototype.slice.call(this.buf, this.pos, this.pos + this.pendingLen);
      this.pos += this.pendingLen;
      this.packets += 1;
      this.onPacket({ opcode: this.pendingOpcode, def: this.pendingDef, payload });
      this.pendingOpcode = null;
      this.pendingDef = null;
      this.pendingLen = null;
    }
  }
}
function trialFrame(stream, seed, want) {
  const isaac = new Isaac([...seed]);
  let framed = 0;
  const splitter = new FrameSplitter(isaac, () => {
    framed += 1;
  });
  splitter.push(stream);
  if (splitter.desynced) return "fail";
  return framed >= want ? "ok" : "need-more";
}
const RANDOM_MULTIPLIER = 99999999;
const DECRYPT_OFFSET = 50;
const VERIFY_PACKETS = 6;
const MAX_CANDIDATES = 512;
const OPCODE_UPDATE_STAT = SERVER_PROT.findIndex((p) => p?.name === "UPDATE_STAT");
const OPCODE_LOGOUT = SERVER_PROT.findIndex((p) => p?.name === "LOGOUT");
class SessionDecoder {
  hooks;
  up = [];
  down = [];
  phase = "handshake";
  serverSeedHi = null;
  serverSeedLo = null;
  revision = null;
  streamStart = -1;
  randoms = null;
  rsaBlock = null;
  askedForRandoms = false;
  splitter = null;
  constructor(hooks) {
    this.hooks = hooks;
  }
  feed(dir, bytes) {
    if (this.phase === "dead") return;
    if (this.phase === "keyed") {
      if (dir === "down") this.splitter.push(bytes);
      this.checkDesync();
      return;
    }
    for (const b of bytes) (dir === "up" ? this.up : this.down).push(b);
    this.parseHandshake();
    this.tryKey();
  }
  /** Supplied asynchronously after onNeedRandoms fires. */
  setRandoms(dump) {
    if (!dump) {
      this.fail("RNG observer was not installed");
      return;
    }
    this.randoms = dump;
    this.tryKey();
  }
  fail(reason) {
    this.phase = "dead";
    this.hooks.onDegraded(reason);
  }
  checkDesync() {
    if (this.splitter?.desynced) {
      this.fail(this.splitter.desyncReason ?? "stream desync");
    }
  }
  parseHandshake() {
    if (this.revision === null && this.up.length >= 7) {
      const opcode = this.up[2];
      if (opcode !== 16 && opcode !== 18) {
        this.fail(`unexpected login opcode ${opcode}`);
        return;
      }
      if (this.up[4] !== 255) {
        this.fail("login block layout mismatch");
        return;
      }
      this.revision = this.up[5] << 8 | this.up[6];
      if (this.revision !== REVISION) {
        this.fail(`server is revision ${this.revision}, decoder is ${REVISION}`);
        return;
      }
      if (this.rsaBlock === null && this.up.length >= 45) {
        const rsaLen = this.up[44];
        if (this.up.length >= 45 + rsaLen) {
          this.rsaBlock = Uint8Array.from(this.up.slice(45, 45 + rsaLen));
        }
      }
      if (!this.askedForRandoms) {
        this.askedForRandoms = true;
        this.hooks.onNeedRandoms();
      }
    }
    if (this.revision !== null && this.rsaBlock === null && this.up.length >= 45) {
      const rsaLen = this.up[44];
      if (this.up.length >= 45 + rsaLen) {
        this.rsaBlock = Uint8Array.from(this.up.slice(45, 45 + rsaLen));
      }
    }
    if (this.serverSeedHi === null && this.down.length >= 17) {
      if (this.down[8] !== 0) {
        this.fail(`server refused login with code ${this.down[8]}`);
        return;
      }
      const seed = Buffer.from(this.down.slice(9, 17));
      this.serverSeedHi = seed.readUInt32BE(0) | 0;
      this.serverSeedLo = seed.readUInt32BE(4) | 0;
    }
    if (this.streamStart < 0 && this.serverSeedHi !== null && this.down.length >= 18) {
      const reply = this.down[17];
      if (reply === 2) {
        if (this.down.length < 20) return;
        this.streamStart = 20;
      } else if (reply === 15) {
        this.streamStart = 18;
      } else {
        this.fail(`login rejected with code ${reply}`);
      }
    }
  }
  tryKey() {
    if (this.phase !== "handshake") return;
    if (this.streamStart < 0 || this.serverSeedHi === null || !this.randoms) return;
    const stream = Uint8Array.from(this.down.slice(this.streamStart));
    if (stream.length < 24) return;
    const values = this.randoms.values;
    let sawNeedMore = false;
    const limit = Math.max(0, values.length - 1 - MAX_CANDIDATES);
    for (let i = values.length - 2; i >= limit; i--) {
      const seeds = [
        Math.floor(RANDOM_MULTIPLIER * values[i]) | 0,
        Math.floor(RANDOM_MULTIPLIER * values[i + 1]) | 0,
        this.serverSeedHi,
        this.serverSeedLo
      ];
      const decrypt = seeds.map((w) => w + DECRYPT_OFFSET | 0);
      const outcome = trialFrame(stream, decrypt, VERIFY_PACKETS);
      if (outcome === "ok") {
        this.key(decrypt, stream, this.randoms.baseSeq + i, seeds);
        return;
      }
      if (outcome === "need-more") sawNeedMore = true;
    }
    if (!sawNeedMore) {
      this.fail(`seed not recoverable from ${values.length} observed draws`);
    }
  }
  key(decryptSeed, stream, drawIndex, seeds) {
    this.splitter = new FrameSplitter(new Isaac(decryptSeed), (p) => this.onPacket(p));
    this.phase = "keyed";
    this.hooks.onKeyed({
      revision: this.revision,
      drawIndex,
      totalDraws: this.randoms.seq,
      seeds,
      rsaBlock: this.rsaBlock
    });
    this.splitter.push(stream);
    this.checkDesync();
  }
  onPacket(p) {
    if (p.opcode === OPCODE_UPDATE_STAT) {
      const buf = Buffer.from(p.payload);
      this.hooks.onStat(buf.readUInt8(0), buf.readUInt32BE(1), buf.readUInt8(5));
    } else if (p.opcode === OPCODE_LOGOUT) {
      this.hooks.onLogout();
    }
  }
}
class XpTracker {
  baseline = /* @__PURE__ */ new Map();
  current = /* @__PURE__ */ new Map();
  update(skill, xp2, level) {
    if (!this.baseline.has(skill)) this.baseline.set(skill, xp2);
    this.current.set(skill, { xp: xp2, level });
  }
  reset() {
    this.baseline.clear();
    this.current.clear();
  }
  rows() {
    const rows = [];
    for (let id = 0; id < SKILLS.length; id++) {
      const name = SKILLS[id];
      if (name === "-unused-") continue;
      const now = this.current.get(id);
      rows.push({
        id,
        name,
        xp: now?.xp ?? 0,
        level: now?.level ?? 0,
        gained: now ? now.xp - (this.baseline.get(id) ?? now.xp) : 0,
        seen: now !== void 0
      });
    }
    return rows;
  }
  totalGained() {
    let total = 0;
    for (const [id, base] of this.baseline) {
      total += (this.current.get(id)?.xp ?? base) - base;
    }
    return total;
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
  sessionState: "swiftkit:session-state",
  xpState: "swiftkit:xp-state"
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
const xp = new XpTracker();
let decoder = null;
let xpKeyed = false;
let xpDegraded = null;
function pushXpState() {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  const state = {
    rows: xp.rows(),
    totalGained: xp.totalGained(),
    keyed: xpKeyed,
    degraded: xpDegraded
  };
  shellView.webContents.send(IPC.xpState, state);
}
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
function crossCheckSeed(seeds, rsaBlock) {
  if (!rsaBlock) return;
  const pemPath = node_path.resolve(target.serverRoot, "engine/data/config/private.pem");
  if (!node_fs.existsSync(pemPath)) return;
  try {
    const { magic, seeds: truth } = decryptLoginBlock(rsaBlock, loadPrivateKey(pemPath));
    const match = magic === 10 && truth.every((w, i) => w === seeds[i]);
    log(`[seed] oracle cross-check: ${match ? "MATCH" : `MISMATCH recovered ${seeds} vs true ${truth}`}`);
  } catch (err) {
    log(`[seed] oracle unavailable: ${err.message}`);
  }
}
function createDecoder() {
  return new SessionDecoder({
    log,
    onNeedRandoms: () => {
      void (async () => {
        let dump = null;
        try {
          dump = await gameView.webContents.executeJavaScript(
            "window.__swiftkitRng ? window.__swiftkitRng.dump() : null"
          );
        } catch {
        }
        decoder?.setRandoms(dump);
        try {
          await gameView.webContents.executeJavaScript("window.__swiftkitRng && window.__swiftkitRng.disarm()");
        } catch {
        }
      })();
    },
    onKeyed: (info) => {
      xpKeyed = true;
      xpDegraded = null;
      session_.revision = info.revision;
      session_.seedRecovered = true;
      log(`[seed] keyed on revision ${info.revision} from draw #${info.drawIndex} of ${info.totalDraws}`);
      crossCheckSeed(info.seeds, info.rsaBlock);
      pushSessionState();
      pushXpState();
    },
    onStat: (skill, exp, level) => {
      xp.update(skill, exp, level);
      pushXpState();
    },
    onLogout: () => {
      log("[session] logout");
      xpKeyed = false;
      pushXpState();
    },
    onDegraded: (reason) => {
      xpKeyed = false;
      xpDegraded = reason;
      session_.seedRecovered = false;
      log(`[session] degraded: ${reason}`);
      pushSessionState();
      pushXpState();
    }
  });
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
  const fixture = [[0, 4320, 42], [2, 1180, 38], [3, 1440, 44], [7, 275, 21], [14, 9860, 51]];
  for (const [id, , level] of fixture) xp.update(id, 1e5, level);
  for (const [id, gained, level] of fixture) xp.update(id, 1e5 + gained, level);
  xpKeyed = true;
  pushXpState();
  await wait(350);
  await shot("panel-live");
  await shellView.webContents.executeJavaScript(
    "document.querySelectorAll('[role=tab]')[1].click()"
  );
  await wait(250);
  await shot("panel-xp");
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
    pushXpState();
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
    decoder = createDecoder();
    tap.onGameFrame = (dir, bytes) => decoder?.feed(dir, bytes);
    tap.onGameSocketOpen = () => {
      decoder = createDecoder();
      xp.reset();
      xpKeyed = false;
      xpDegraded = null;
      pushXpState();
    };
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
