import { writeFileSync } from 'node:fs';

/* Palette lifted from the client screenshot (quantised region samples), not invented:
   panel stone #504D3B-#565344, frame #5E554E/#252019, tab ground #271E18,
   tab faces #685D52/#41433B, cream text #F3F0EB, world green #89B080/#72A16B. */
const C = {
    ground: '#1a1710',       // chrome ground, warm near-black
    railGround: '#271e18',   // the dark strip the tabs sit on
    stone: '#443d31',        // interface panel face (sampled mid, minus what the grain adds back)
    stoneLit: '#655c4b',     // raised / active face
    well: '#37311f',         // inset list background
    edgeLit: '#7d7463',      // bevel highlight
    edgeDark: '#211d16',     // bevel shadow
    cream: '#ece7dc',
    dim: '#a89c86',
    faint: '#7d735f',
    gold: '#ffe139',
    green: '#90c040',
    good: '#04a800',
    warn: '#ff981f',
    red: '#a70700',
    redEdge: '#570700'
};

const TEX = `background-image:
        url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='70' height='70'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' seed='9'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='70' height='70' filter='url(%23g)' opacity='0.34'/%3E%3C/svg%3E"),
        url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='190' height='190'%3E%3Cfilter id='b'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.055' numOctaves='2' seed='21'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='190' height='190' filter='url(%23b)' opacity='0.3'/%3E%3C/svg%3E");
      background-blend-mode: overlay, overlay;`;

const head = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;700&display=swap');
    body { margin: 0; background: ${C.ground}; }
    .tile, .sunk, .rail, .btn, .title { text-shadow: 1px 1px 0 rgba(0, 0, 0, .78); }
    a { color: ${C.green}; text-decoration: none; }
    a:hover { color: ${C.green}; text-decoration: underline; }
    .px { font-family: 'Pixelify Sans', 'Trebuchet MS', Arial, sans-serif; }
    /* Raised interface stone: warm bevel, light above-left, shadow below-right. */
    .tile { background-color: ${C.stone}; ${TEX} border: 2px solid ${C.edgeDark}; border-top-color: ${C.edgeLit}; border-left-color: ${C.edgeLit}; }
    /* The same bevel inverted: a recess that holds a list or a field. */
    .sunk { background-color: ${C.well}; ${TEX} border: 2px solid ${C.edgeLit}; border-top-color: ${C.edgeDark}; border-left-color: ${C.edgeDark}; }
    /* An interface tab, as the client draws them: a stone tile on a dark strip. */
    .tab { width: 36px; height: 34px; display: flex; align-items: center; justify-content: center; background-color: #342e24; ${TEX} border: 1px solid ${C.edgeDark}; box-shadow: inset 1px 1px 0 rgba(0,0,0,.35); }
    .tab-on { background-color: ${C.stoneLit}; box-shadow: inset 1px 1px 0 rgba(255,255,255,.18), inset -1px -1px 0 rgba(0,0,0,.3); }
    .tab svg { opacity: .78; }
    .tab-on svg { opacity: 1; }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 3px 12px; background-color: ${C.stone}; ${TEX} border: 2px solid ${C.edgeDark}; border-top-color: ${C.edgeLit}; border-left-color: ${C.edgeLit}; color: ${C.gold}; font-family: 'Pixelify Sans', 'Trebuchet MS', Arial, sans-serif; font-size: 15px; }
    .btn-red { background: ${C.red}; border-color: ${C.redEdge}; border-top-color: #c8503f; border-left-color: #c8503f; color: #fff; }
    .title { text-align: center; font-family: 'Pixelify Sans', 'Trebuchet MS', Arial, sans-serif; font-size: 18px; color: ${C.gold}; padding: 7px 0 6px; }
    .row { display: flex; align-items: center; gap: 10px; padding: 5px 8px; }
    .rail { width: 48px; flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 5px 0; background-color: ${C.stone}; ${TEX} border: 2px solid ${C.edgeDark}; border-top-color: ${C.edgeLit}; border-left: 2px solid ${C.edgeDark}; box-shadow: inset 2px 0 0 rgba(0,0,0,.28); }
    .sep { width: 32px; height: 2px; background: ${C.edgeDark}; border-bottom: 1px solid rgba(255,255,255,.09); margin: 2px 0; }
  </style>
</helmet>
`;
const tail = `</x-dc>\n</body>\n</html>\n`;

const D = '#3a3428'; // the dark outline every icon shares, as sprite art does
const icons = {
    chat: `<path d="M2 3h14v9H9l-4 3v-3H2z" fill="${C.cream}" stroke="${D}" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 6.5h8M5 9.5h5" stroke="${D}" stroke-width="1.3"/>`,
    timer: `<path d="M6.5 2h5" stroke="${D}" stroke-width="2"/><circle cx="9" cy="10" r="6" fill="${C.gold}" stroke="${D}" stroke-width="1.3"/><path d="M9 6.5V10h3" stroke="${D}" stroke-width="1.4" fill="none"/>`,
    camera: `<path d="M2 5.5h3.2L6.7 3.5h4.6l1.5 2H16v8.5H2z" fill="${C.dim}" stroke="${D}" stroke-width="1.2" stroke-linejoin="round"/><circle cx="9" cy="9.7" r="2.7" fill="#4a453a" stroke="${D}" stroke-width="1.1"/>`,
    notes: `<path d="M4 2h6.5L14 5.2V16H4z" fill="${C.cream}" stroke="${D}" stroke-width="1.2" stroke-linejoin="round"/><path d="M6.5 8h5M6.5 11h5" stroke="${D}" stroke-width="1.3"/>`,
    globe: `<circle cx="9" cy="9" r="7" fill="#4a7fa8" stroke="${D}" stroke-width="1.3"/><path d="M2 9h14" stroke="#cfe3ef" stroke-width="1.2"/><path d="M9 2c2.6 2.6 2.6 11.4 0 14M9 2c-2.6 2.6-2.6 11.4 0 14" stroke="#cfe3ef" stroke-width="1.2" fill="none"/>`,
    book: `<path d="M9 4.5C7.6 3 5.6 2.6 2.5 3v10.5c3-.4 5 0 6.5 1.5 1.5-1.5 3.5-1.9 6.5-1.5V3c-3.1-.4-5.1 0-6.5 1.5z" fill="${C.cream}" stroke="${D}" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 4.5v10.5" stroke="${D}" stroke-width="1.2"/>`,
    map: `<path d="M2 4l4.5-2 5 2 4.5-2v12l-4.5 2-5-2L2 16z" fill="#c8a86a" stroke="${D}" stroke-width="1.2" stroke-linejoin="round"/><path d="M6.5 2v12M11.5 4v12" stroke="${D}" stroke-width="1.2"/>`,
    trophy: `<path d="M5.5 2h7v4a3.5 3.5 0 0 1-7 0z" fill="${C.gold}" stroke="${D}" stroke-width="1.2"/><path d="M9 9.5v3M3 3h2.5M12.5 3H15" stroke="${D}" stroke-width="1.4"/><path d="M6 12.5h6V16H6z" fill="${C.gold}" stroke="${D}" stroke-width="1.2"/>`,
    calc: `<rect x="3.5" y="2" width="11" height="14" fill="${C.dim}" stroke="${D}" stroke-width="1.2"/><rect x="5.5" y="4" width="7" height="3" fill="${D}"/><path d="M6 10.5h1.5M10.5 10.5h1.5M6 13.5h1.5M10.5 13.5h1.5" stroke="${D}" stroke-width="1.6"/>`,
    wrench: `<path d="M12.5 2a4 4 0 0 0-4.6 5.2L2.5 12.6l2.9 2.9 5.4-5.4A4 4 0 0 0 16 5.5l-2.3 2.3-1.9-.5-.5-1.9z" fill="${C.dim}" stroke="${D}" stroke-width="1.2" stroke-linejoin="round"/>`
};
const ico = k => `<svg width="18" height="18" viewBox="0 0 18 18" fill="none">${icons[k]}</svg>`;
const tab = (k, on) => `<div class="tab${on ? ' tab-on' : ''}">${ico(k)}</div>`;

/** The rail: app tools, a divider, server tools, then settings held at the bottom. */
const rail = active => `<div class="rail">
      ${['chat', 'timer', 'camera', 'notes'].map(k => tab(k, k === active)).join('\n      ')}
      <div class="sep"></div>
      ${['globe', 'book', 'map', 'trophy', 'calc'].map(k => tab(k, k === active)).join('\n      ')}
      <div style="flex: 1 1 auto;"></div>
      ${tab('wrench', active === 'wrench')}
    </div>`;

const win = inner => `<div style="width: 1168px; height: 676px; background: ${C.ground}; color: ${C.cream}; font-family: Arial, Helvetica, sans-serif; font-size: 13px; display: flex; flex-direction: column; overflow: hidden;">${inner}</div>`;
const panel = inner => `<div class="tile" style="width: 320px; flex: 0 0 auto; display: flex; flex-direction: column; border-right: none;">${inner}</div>`;

const gameTab = on => `<div class="${on ? 'tile' : 'tab'}" style="height: 26px; width: auto; display: flex; align-items: center; gap: 7px; padding: 0 10px; flex: 0 0 auto;${on ? '' : ` color: ${C.dim};`}">
      <span>Lost City &middot; W5 &middot; low &middot; 43 ms</span>${on ? `<span style="color: ${C.faint}; font-size: 12px;">rev 274</span>` : ''}
    </div>`;
const pageTab = (label, glyph, on) => `<div class="${on ? 'tile' : 'tab'}" style="height: 26px; width: auto; display: flex; align-items: center; gap: 7px; padding: 0 10px; flex: 0 0 auto;${on ? '' : ` color: ${C.dim};`}">
      <svg width="12" height="12" viewBox="0 0 18 18" fill="none" style="transform: scale(.72); transform-origin: center;">${icons[glyph]}</svg><span>${label}</span>
    </div>`;

const strip = tabs => `
  <div class="tile" style="height: 36px; display: flex; align-items: center; gap: 5px; padding: 0 6px; flex: 0 0 auto; border-left: none; border-right: none; border-top: none;">
    ${tabs}
    <div style="flex: 1 1 auto;"></div>
    <div class="tile" style="width: 32px; height: 26px; display: flex; align-items: center; justify-content: center; color: ${C.dim}; flex: 0 0 auto;">
      <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" stroke-width="2" shape-rendering="crispEdges"><rect x="1" y="1" width="12" height="10" /><path d="M9.5 1v10" /></svg>
    </div>
  </div>
  <div style="height: 2px; background: ${C.edgeDark}; box-shadow: inset 0 1px 0 rgba(255,255,255,.10); flex: 0 0 auto;"></div>`;

const plus = `<div class="tile" style="width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; color: ${C.gold}; flex: 0 0 auto;">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" shape-rendering="crispEdges"><path d="M6 1.5v9M1.5 6h9" /></svg>
    </div>`;

const worldRow = (id, region, sub, ms, msColor, current) => `<div class="row"${current ? ` style="background: ${C.stoneLit};"` : ''}>
          <span style="width: 32px; flex: 0 0 auto; color: ${current ? C.gold : C.dim};">W${id}</span>
          <span style="flex: 1 1 auto; min-width: 0;">${region}<span style="display: block; font-size: 12px; color: ${C.dim};">${sub}</span></span>
          <span style="flex: 0 0 auto; color: ${msColor};">${ms}</span>
        </div>`;

/* The client's own scrollbar: arrow tiles top and bottom, a stone thumb in a recess. */
const scrollbar = `<div style="width: 14px; flex: 0 0 auto; display: flex; flex-direction: column; background: ${C.edgeDark};">
        <div class="tile" style="height: 13px; border-width: 1px; display: flex; align-items: center; justify-content: center;"><svg width="7" height="5" viewBox="0 0 7 5" fill="${C.gold}"><path d="M3.5 0L7 5H0z"/></svg></div>
        <div class="tile" style="height: 74px; border-width: 1px; margin: 1px 0;"></div>
        <div style="flex: 1 1 auto;"></div>
        <div class="tile" style="height: 13px; border-width: 1px; display: flex; align-items: center; justify-content: center;"><svg width="7" height="5" viewBox="0 0 7 5" fill="${C.gold}"><path d="M3.5 5L0 0h7z"/></svg></div>
      </div>`;

const worldsPanel = panel(`
      <div class="title">Worlds</div>
      <div style="display: flex; gap: 6px; padding: 0 10px 7px;">
        <div class="btn btn-red px" style="flex: 1 1 0;">Low detail</div>
        <div class="btn px" style="flex: 1 1 0; color: ${C.dim};">High detail</div>
      </div>
      <div class="sunk" style="margin: 0 10px; flex: 1 1 auto; min-height: 0; display: flex;">
        <div style="flex: 1 1 auto; min-width: 0;">
          ${worldRow(1, 'US (East)', '2 online &middot; free', '293 ms', C.dim, false)}
          ${worldRow(2, 'US (East)', '91 online &middot; members', '296 ms', C.dim, false)}
          ${worldRow(3, 'Finland', '65 online &middot; members', '229 ms', C.dim, false)}
          ${worldRow(5, 'Australia', '28 online &middot; members', '287 ms', C.dim, true)}
          ${worldRow(7, 'Singapore', '25 online &middot; members', '46 ms', C.good, false)}
        </div>
        ${scrollbar}
      </div>
      <div style="display: flex; align-items: center; gap: 8px; padding: 8px 10px;">
        <div class="btn px">Refresh</div>
        <span style="font-size: 12px; color: ${C.dim};">updated 14 s ago</span>
      </div>`);

writeFileSync('Main.dc.html', head + win(`${strip(`${gameTab(true)}\n    ${pageTab('Clue scroll (medium)', 'book', false)}\n    ${pageTab('World map', 'map', false)}\n    ${plus}`)}
  <div style="flex: 1 1 auto; display: flex; min-height: 0;">
    <div style="flex: 1 1 auto; background: #000;"></div>
    ${worldsPanel}
    ${rail('globe')}
  </div>`) + tail);

writeFileSync('Rail.dc.html', head + `<div style="width: 620px; height: 430px; background: ${C.ground}; color: ${C.cream}; font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 18px 20px; display: flex; gap: 28px;">
  <div style="display: flex; flex-direction: column; gap: 14px;">
    <div class="px" style="font-size: 18px; color: ${C.gold};">Interface tabs</div>
    <div style="display: flex; gap: 22px; align-items: flex-start;">
      <div style="display: flex; flex-direction: column; align-items: center; gap: 7px;">
        <div class="tile" style="padding: 5px;">${tab('globe', false)}</div>
        <span style="font-size: 12px; color: ${C.dim};">resting</span>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; gap: 7px;">
        <div class="tile" style="padding: 5px;">${tab('globe', true)}</div>
        <span style="font-size: 12px; color: ${C.gold};">open</span>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; gap: 7px;">
        <div class="tile" style="padding: 5px;"><div class="tab" style="background-color: #332d24; box-shadow: inset 1px 1px 0 rgba(0,0,0,.4);">${ico('globe')}</div></div>
        <span style="font-size: 12px; color: ${C.dim};">pressed</span>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; gap: 7px;">
        <div class="tile" style="padding: 5px;"><div class="tab" style="opacity: .42;">${ico('globe')}</div></div>
        <span style="font-size: 12px; color: ${C.faint};">not on this server</span>
      </div>
    </div>
    <div style="height: 2px; background: ${C.edgeDark}; border-bottom: 1px solid #4a4133; margin: 4px 0;"></div>
    <div class="px" style="font-size: 18px; color: ${C.gold};">Anatomy</div>
    <div style="display: flex; flex-direction: column; gap: 5px; color: ${C.dim}; line-height: 1.55; max-width: 340px;">
      <div>36 &times; 34 tile, 1px ${C.edgeDark} outline with an inner highlight above and left.</div>
      <div>Resting face <span style="color: ${C.cream};">#443c30</span>, open face <span style="color: ${C.cream};">${C.stoneLit}</span>, both carrying the stone grain.</div>
      <div>Icons are flat sprites on a ${D} outline, dimmed to 78% until the tab is open.</div>
      <div>They are cut into the interface slab itself, not floating on a dark strip.</div>
    </div>
  </div>
  <div style="display: flex; flex-direction: column; gap: 7px;">
    <span class="px" style="font-size: 15px; color: ${C.gold};">In place</span>
    ${rail('globe')}
  </div>
</div>` + tail);

const toolPanel = (activeIcon, inner) => head + `<div style="width: 368px; height: 640px; background: ${C.ground}; color: ${C.cream}; font-family: Arial, Helvetica, sans-serif; font-size: 13px; display: flex;">
  ${panel(inner)}
  ${rail(activeIcon)}
</div>` + tail;

writeFileSync('Chat.dc.html', toolPanel('chat', `
      <div class="title">Chat</div>
      <div style="display: flex; gap: 6px; padding: 0 10px 7px;">
        <div class="btn px" style="padding: 2px 10px; background: ${C.stoneLit};">#04scape</div>
        <div class="btn px" style="padding: 2px 10px; color: ${C.dim}; gap: 7px;">#lostcity <span style="color: ${C.gold};">3</span></div>
      </div>
      <div class="sunk" style="margin: 0 10px; flex: 1 1 auto; min-height: 0; padding: 6px 8px; display: flex; flex-direction: column; gap: 5px; line-height: 1.45;">
        <div><span style="color: #9db8c3;">kev</span> anyone running clues on w2 tonight</div>
        <div><span style="color: #faa8aa;">zanna</span> im on w5, hopping over in a sec</div>
        <div style="color: ${C.faint};">&rarr; mod_ash joined #04scape</div>
        <div><span style="color: ${C.gold};">mod_ash</span> w3 is getting a restart in 10 minutes</div>
        <div><span style="color: #9db8c3;">kev</span> ta, ill bank first</div>
        <div style="margin-top: auto;"><span style="color: #faa8aa;">zanna</span> here, w5 castle wars bank</div>
      </div>
      <div style="display: flex; gap: 6px; padding: 8px 10px; align-items: center;">
        <div class="sunk" style="flex: 1 1 auto; padding: 3px 7px; color: ${C.faint};">Say something</div>
        <div class="btn btn-red px">Send</div>
      </div>`));

writeFileSync('Timers.dc.html', toolPanel('timer', `
      <div class="title">Timers</div>
      <div class="sunk" style="margin: 0 10px 8px; padding: 2px 0;">
        <div class="row" style="background: ${C.stoneLit};">
          <span style="flex: 1 1 auto;">Herb patch<span style="display: block; font-size: 12px; color: ${C.dim};">Ardougne, ends 21:40</span></span>
          <span style="flex: 0 0 auto; font-size: 15px; color: ${C.green};">62:14</span>
        </div>
        <div class="row">
          <span style="flex: 1 1 auto;">Wine of Zamorak<span style="display: block; font-size: 12px; color: ${C.dim};">respawn</span></span>
          <span style="flex: 0 0 auto; font-size: 15px; color: ${C.green};">0:23</span>
        </div>
        <div class="row">
          <span style="flex: 1 1 auto; color: ${C.dim};">Away from keyboard<span style="display: block; font-size: 12px; color: ${C.faint};">resets when you click the game</span></span>
          <span style="flex: 0 0 auto; font-size: 15px; color: ${C.warn};">4:51</span>
        </div>
      </div>
      <div style="padding: 0 10px 6px; font-size: 12px; color: ${C.dim};">Add a timer</div>
      <div style="display: flex; gap: 6px; padding: 0 10px 8px;">
        <div class="sunk" style="flex: 1 1 auto; padding: 3px 7px; color: ${C.faint};">Label</div>
        <div class="sunk" style="width: 58px; flex: 0 0 auto; padding: 3px 7px; color: ${C.faint};">5:00</div>
      </div>
      <div style="display: flex; gap: 5px; padding: 0 10px;">
        <div class="btn px" style="flex: 1 1 0; padding: 2px 0; color: ${C.dim};">1 min</div>
        <div class="btn px" style="flex: 1 1 0; padding: 2px 0; color: ${C.dim};">5 min</div>
        <div class="btn px" style="flex: 1 1 0; padding: 2px 0; color: ${C.dim};">30 min</div>
        <div class="btn px" style="flex: 1 1 0; padding: 2px 0; color: ${C.dim};">80 min</div>
      </div>
      <div style="margin-top: auto; display: flex; align-items: center; gap: 8px; padding: 8px 10px;">
        <div class="btn btn-red px">Start</div>
        <span style="font-size: 12px; color: ${C.dim};">Timers run with the panel closed.</span>
      </div>`));

writeFileSync('Settings.dc.html', toolPanel('wrench', `
      <div class="title">Settings</div>
      <div style="padding: 0 10px 5px; font-size: 12px; color: ${C.green};">Chat</div>
      <div style="display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 6px; padding: 0 10px 12px; align-items: center;">
        <span style="color: ${C.dim};">Server</span><div class="sunk" style="padding: 3px 7px;">irc.libera.chat</div>
        <span style="color: ${C.dim};">Nickname</span><div class="sunk" style="padding: 3px 7px;">mattg</div>
      </div>
      <div style="padding: 0 10px 5px; font-size: 12px; color: ${C.green};">Screenshots</div>
      <div style="display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 6px; padding: 0 10px 8px; align-items: center;">
        <span style="color: ${C.dim};">Folder</span><div class="sunk" style="padding: 3px 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">~/Pictures/SwiftKit</div>
        <span style="color: ${C.dim};">Shortcut</span><div class="sunk" style="padding: 3px 7px;">&#8984;&#8679;S</div>
      </div>
      <div style="padding: 0 10px 5px; font-size: 12px; color: ${C.green};">Window</div>
      <div style="padding: 0 10px 12px; display: flex; flex-direction: column; gap: 7px;">
        <div style="display: flex; align-items: center; gap: 9px;"><div class="sunk" style="width: 15px; height: 15px; flex: 0 0 auto;"></div><span>Keep this window on top</span></div>
        <div style="display: flex; align-items: center; gap: 9px;"><div class="sunk" style="width: 15px; height: 15px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;"><svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="${C.gold}" stroke-width="2"><path d="M1.5 5.5l2.5 2.5 5-5.5"/></svg></div><span>Ask before closing a window</span></div>
      </div>
      <div style="padding: 0 10px 5px; font-size: 12px; color: ${C.green};">Servers</div>
      <div class="sunk" style="margin: 0 10px; flex: 1 1 auto; min-height: 0; padding: 2px 0;">
        <div class="row" style="background: ${C.stoneLit};"><span style="flex: 1 1 auto;">Lost City<span style="display: block; font-size: 12px; color: ${C.dim};">rev 274 &middot; 5 worlds</span></span><span style="color: ${C.faint}; font-size: 12px;">2 open</span></div>
        <div class="row"><span style="flex: 1 1 auto;">Zanaris<span style="display: block; font-size: 12px; color: ${C.dim};">rev 274 &middot; 1 world</span></span></div>
        <div class="row"><span style="flex: 1 1 auto;">Lost City Labs<span style="display: block; font-size: 12px; color: ${C.dim};">rev unknown &middot; 4 worlds</span></span></div>
        <div class="row"><span style="flex: 1 1 auto;">Local server<span style="display: block; font-size: 12px; color: ${C.dim};">rev 289 &middot; no worlds</span></span></div>
      </div>
      <div style="display: flex; gap: 6px; padding: 8px 10px;">
        <div class="btn px">Add server</div>
        <div class="btn px" style="color: ${C.dim};">Edit</div>
        <div class="btn px" style="color: ${C.dim};">Remove</div>
      </div>`));

writeFileSync('WikiTab.dc.html', head + win(`${strip(`${gameTab(false)}\n    ${pageTab('Clue scroll (medium)', 'book', true)}\n    ${pageTab('World map', 'map', false)}\n    ${plus}`)}
  <div class="tile" style="height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 8px; flex: 0 0 auto; border-left: none; border-right: none; border-top: none;">
    <div style="display: flex; gap: 5px; flex: 0 0 auto;">
      <div class="tile" style="width: 24px; height: 22px; display: flex; align-items: center; justify-content: center; color: ${C.gold};"><svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 1.5l-4 4 4 4"/></svg></div>
      <div class="tile" style="width: 24px; height: 22px; display: flex; align-items: center; justify-content: center; color: ${C.faint};"><svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 1.5l4 4-4 4"/></svg></div>
      <div class="tile" style="width: 24px; height: 22px; display: flex; align-items: center; justify-content: center; color: ${C.gold};"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 5A4 4 0 1 1 8.5 2.2M9.5 .5l-.5 2.2 2.2-.4"/></svg></div>
    </div>
    <div class="sunk" style="flex: 1 1 auto; min-width: 0; padding: 2px 8px; color: ${C.green}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">2004.losthq.rs/?p=clueguides</div>
    <span style="flex: 0 0 auto; font-size: 12px; color: ${C.faint};">rev 274 &middot; 2004.losthq.rs</span>
  </div>
  <div style="flex: 1 1 auto; display: flex; min-height: 0;">
    <div style="flex: 1 1 auto; background: #000; padding: 22px 28px; overflow: hidden;">
      <div style="max-width: 620px; display: flex; flex-direction: column; gap: 13px;">
        <div style="font-size: 21px; color: ${C.gold};">Clue scroll (medium)</div>
        <div style="color: ${C.dim}; line-height: 1.6;">Medium clues are made up of anagrams, cryptic hints, map steps and coordinate steps. Each casket holds three to five steps.</div>
        <div style="font-size: 15px; color: ${C.green}; margin-top: 4px;">Anagrams</div>
        <div style="display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 6px 18px; color: ${C.dim}; line-height: 1.5;">
          <span style="color: ${C.cream};">A Elf Knows</span><span>Snowflake, north of Falador</span>
          <span style="color: ${C.cream};">Car If Ices</span><span>Sacrifice, Edgeville monastery</span>
          <span style="color: ${C.cream};">Dt Run B</span><span>Brundt, Rellekka longhall</span>
        </div>
        <div style="color: ${C.faint}; font-size: 12px; margin-top: 6px;">Links off the allowed hosts open in your browser.</div>
      </div>
    </div>
    ${rail('book')}
  </div>`) + tail);

console.log('wrote Main, Rail, Chat, Timers, Settings, WikiTab');
