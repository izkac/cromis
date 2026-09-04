// Records the Alcove demo clip from the running browser mock:
//   cd ..\alcove && npm run dev            (serves 127.0.0.1:43147)
//   node demo.mjs                          (writes frames to demo-frames/)
//   python demo-encode.py                  (frames -> animated webp + gif)
//
// Same CDP machinery as screenshots.mjs: drive the mock, but capture a stream
// of frames while a scripted sequence plays instead of single stills.
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
const URL = "http://127.0.0.1:43147/"
const PORT = 9334
const PROFILE = process.env.TEMP + "/alcove-demo-profile"
const OUT = process.argv[2] || "S:/Projects/cromis/demo-frames"
const W = 1440, H = 900
const FPS = 12

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
try { rmSync(PROFILE, { recursive: true, force: true }) } catch {}

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--disable-extensions", "--mute-audio",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  `--window-size=${W},${H}`, "about:blank",
], { stdio: "ignore" })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pageWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === "page")
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error("no chrome debug target")
}

const ws = new WebSocket(await pageWs())
await new Promise((r) => (ws.onopen = r))

let id = 0
const pending = new Map()
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id
    pending.set(n, { resolve, reject })
    ws.send(JSON.stringify({ id: n, method, params }))
  })

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + expression)
  return r.result.value
}

await send("Page.enable")
await send("Runtime.enable")
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false })

// --- the same posing screenshots.mjs does, so the clip shows the sample desk --
const WALLPAPER = "data:image/jpeg;base64," + readFileSync("wallpaper.jpg").toString("base64")
const ART_FILES = {
  chrome: "chrome", "chrome-setup": "chrome", vscode: "visual-studio-code", slack: "slack",
  spotify: "spotify", steam: "steam", "steam-setup": "steam", discord: "discord",
  figma: "figma", docker: "docker", terminal: "powershell", "node-msi": "nodejs",
  "git-setup": "git", "alcove-zip": "7zip",
}
const ART = Object.fromEntries(Object.entries(ART_FILES).map(([id, file]) =>
  [id, "data:image/png;base64," + readFileSync(`icons/${file}.png`).toString("base64")]))
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const KEY = 'alcove.desktop.v1';
    const art = ${JSON.stringify(ART)}, names = { terminal: 'PowerShell' };
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      const raw = read.call(this, key);
      if (key !== KEY || !raw) return raw;
      try {
        const s = JSON.parse(raw);
        for (const icon of s.icons || []) {
          if (art[icon.id]) icon.imageUrl = art[icon.id];
          if (names[icon.id]) icon.name = names[icon.id];
        }
        return JSON.stringify(s);
      } catch { return raw }
    };
  })()`,
})

await send("Page.navigate", { url: URL })
await sleep(2000)
await evaluate(`localStorage.setItem('alcove.mock.wallpaper', ${JSON.stringify(WALLPAPER)}), 1`)

const reload = async (ms = 3500) => { await send("Page.reload"); await sleep(ms) }
await reload()

// Hide the toast stack; a "welcome" toast mid-clip reads as a bug.
const hideToasts = () => evaluate(`(() => {
  let st = document.getElementById('demo-css');
  if (!st) { st = document.createElement('style'); st.id = 'demo-css'; document.head.append(st); }
  st.textContent = '[data-sonner-toaster]{display:none!important}';
  return 1;
})()`)

// --- set the desk up before the camera rolls ---------------------------------
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Organize desktop');
  if (b) b.click();
  return !!b;
})()`)
await sleep(1500)
await reload()

const openDrawer = async (name, settle = 900) => {
  const hit = await evaluate(`(() => {
    const t = [...document.querySelectorAll('[data-alcove-strip] [data-alcove-id]')]
      .find(e => e.textContent.includes(${JSON.stringify(name)}));
    if (t) t.click();
    return !!t;
  })()`)
  await sleep(settle)
  return hit
}
const OPEN = `[...document.querySelectorAll('[data-alcove-id]')]
  .filter(e => !document.querySelector('[data-alcove-strip]').contains(e))[0]`

// Warm the frequent strip the way a real desk gets used.
for (const [drawer, n] of [["Apps", 5], ["Documents", 4], ["Photos", 2], ["Installers", 2]]) {
  await openDrawer(drawer)
  await evaluate(`(() => {
    const open = ${OPEN};
    if (!open) return 0;
    const icons = [...open.querySelectorAll('[data-desktop-icon]')].slice(0, ${n});
    for (const el of icons) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    return icons.length;
  })()`)
  await sleep(300)
}

// Strip along the bottom, and Documents pre-seeded as a canvas so the clip can
// show both drawer shapes without a reload cutting the picture in half.
await evaluate(`(() => {
  const KEY = 'alcove.desktop.v1';
  const s = JSON.parse(localStorage.getItem(KEY));
  s.stripEdge = 'bottom';
  const target = s.alcoves.find(a => a.name === 'Documents');
  target.groups = [{ id: 'g-week', name: 'This week' }, { id: 'g-client', name: 'Client A' }];
  target.view = 'canvas';
  const byDrawer = {};
  for (const i of s.icons) {
    if (!i.alcoveId || i.alcoveId === target.id) continue;
    (byDrawer[i.alcoveId] ||= []).push(i);
  }
  const pool = Object.values(byDrawer).flatMap(list => list.slice(0, Math.max(1, list.length - 3)));
  pool.forEach((icon, n) => {
    icon.alcoveId = target.id;
    icon.groupId = n % 3 === 0 ? 'g-week' : n % 3 === 1 ? 'g-client' : null;
  });
  localStorage.setItem(KEY, JSON.stringify(s));
  return pool.length;
})()`)
await reload()
await hideToasts()

// --- roll ---------------------------------------------------------------------
let frame = 0, rolling = true
const recorder = (async () => {
  const gap = 1000 / FPS
  while (rolling) {
    const t = Date.now()
    try {
      const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 })
      writeFileSync(`${OUT}/f${String(frame++).padStart(4, "0")}.jpg`, Buffer.from(data, "base64"))
    } catch {}
    const left = gap - (Date.now() - t)
    if (left > 0) await sleep(left)
  }
})()

await sleep(1200)                     // the desk, uncluttered
await openDrawer("Photos", 1800)      // a small drawer opens as a panel
await openDrawer("Documents", 2600)   // opening a second shuts the first: canvas
await openDrawer("Documents", 1200)   // clicking again closes it

const openSearch = () => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')]
    .find(b => /search/i.test((b.getAttribute('aria-label') || b.title || b.textContent) || ''));
  if (b) b.click();
  return !!b;
})()`)
await openSearch()
await sleep(1400)

// cmdk's input is React-controlled, so go through the native value setter.
const typeSearch = (text) => evaluate(`(() => {
  const input = document.querySelector('[cmdk-input]');
  if (!input) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, ${JSON.stringify(text)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`)
for (const t of ["b", "bu", "bud", "budg", "budge", "budget"]) { await typeSearch(t); await sleep(160) }
await sleep(2200)

rolling = false
await recorder
console.log(`captured ${frame} frames at ${FPS}fps -> ${OUT}`)

ws.close()
chrome.kill()
process.exit(0)
