// Regenerate alcove/img/*.webp from the running Alcove browser mock:
//   cd ..\alcove && npm run dev            (serves 127.0.0.1:43147)
//   node screenshots.mjs
// Drives the Alcove browser mock over CDP and writes real screenshots.
// Zero deps: Node's built-in WebSocket + headless Chrome already on the machine.
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
const URL = "http://127.0.0.1:43147/"
const PORT = 9333
const PROFILE = process.env.TEMP + "/alcove-shots-profile"
const OUT = process.argv[2] || "S:/Projects/cromis/alcove/img"
const W = 1600, H = 1000, SCALE = 2

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
const events = []
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  } else if (msg.method) events.push(msg.method)
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

/** Union of every element matching one of `selectors`, padded. Returns a RECT expression. */
const union = (selectors, pad = 0) => `RECT:(() => {
  const els = ${JSON.stringify(selectors)}.flatMap(s => [...document.querySelectorAll(s)]);
  if (!els.length) return null;
  const r = els.map(e => e.getBoundingClientRect());
  const x = Math.min(...r.map(b => b.left)) - ${pad}, y = Math.min(...r.map(b => b.top)) - ${pad};
  return { x, y, width: Math.max(...r.map(b => b.right)) + ${pad} - x,
                 height: Math.max(...r.map(b => b.bottom)) + ${pad} - y };
})()`

async function shot(name, selector, pad = 0, radius = 0) {
  await evaluate(`(() => {
    let st = document.getElementById('shot-css');
    if (!st) { st = document.createElement('style'); st.id = 'shot-css'; document.head.append(st); }
    st.textContent = '[data-sonner-toaster]{display:none!important}';
    return 1;
  })()`)
  const params = { format: "webp", quality: 92, captureBeyondViewport: false }
  if (selector) {
    const box = await evaluate(selector.startsWith("RECT:")
      ? selector.slice(5)
      : `(() => {
      const el = ${selector};
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`)
    if (!box) { console.log(`  ! ${name}: selector found nothing`); return }
    params.clip = {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: Math.min(W, box.width + pad * 2), height: Math.min(H, box.height + pad * 2),
      scale: 1, // deviceScaleFactor already doubles it
    }
  } else {
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: SCALE, mobile: false })
  }
  const { data } = await send("Page.captureScreenshot", params)
  const buf = Buffer.from(data, "base64")
  writeFileSync(`${OUT}/${name}.webp`, buf)
  console.log(`  + ${name}.webp  ${(buf.length / 1024).toFixed(0)} kB`)
  void radius
}

await send("Page.enable")
await send("Runtime.enable")
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: SCALE, mobile: false })
await send("Page.navigate", { url: URL })
await sleep(4000)

// 1. The first-run screen, before anything is sorted.
await shot("firstrun", `RECT:(() => {
  const d = document.querySelector('[role="dialog"]').getBoundingClientRect();
  return { x: d.x, y: d.y, width: d.width, height: Math.min(d.height, 530) };
})()`)

const organized = await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Organize desktop');
  if (b) b.click();
  return !!b;
})()`)
console.log("organized:", organized)
await sleep(1500)

const openDrawer = async (name) => {
  await evaluate(`(() => {
    const t = [...document.querySelectorAll('[data-alcove-strip] [data-alcove-id]')]
      .find(e => e.textContent.includes(${JSON.stringify("__NAME__")}));
    if (t) t.click();
    return !!t;
  })()`.replace("__NAME__", name))
  await sleep(900)
}

const OPEN = `[...document.querySelectorAll('[data-alcove-id]')]
  .filter(e => !document.querySelector('[data-alcove-strip]').contains(e))[0]`

// Warm the frequent strip: open a handful of things, the way a real desk gets used.
for (const [drawer, n] of [["Apps", 5], ["Documents", 4], ["Photos", 2], ["Installers", 2]]) {
  await openDrawer(drawer)
  await evaluate(`(() => {
    const open = ${OPEN};
    if (!open) return 0;
    const icons = [...open.querySelectorAll('[data-desktop-icon]')].slice(0, ${n});
    for (const el of icons) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    return icons.length;
  })()`)
  await sleep(400)
}
await sleep(1000)

// 2. The desktop with one drawer open as a compact panel.
await openDrawer("Documents")
await shot("desktop", null)
await shot("panel", OPEN, 0)
await shot("drawer", `RECT:(() => {
  const rail = document.querySelector('[data-alcove-strip]').getBoundingClientRect();
  const p = ([...document.querySelectorAll('[data-alcove-id]')].filter(e => !document.querySelector('[data-alcove-strip]').contains(e))[0]).getBoundingClientRect();
  const pad = 26;
  return { x: rail.left, y: p.top - pad, width: p.right + pad - rail.left, height: p.height + pad * 2 };
})()`)
await shot("strip", union(["[data-strip-launch]", "[data-strip-label]"], 13))

// 3. A drawer big enough to earn the canvas: seed the app's own saved state,
//    reload, and let Alcove render it for real.
await evaluate(`(() => {
  const KEY = 'alcove.desktop.v1';
  const s = JSON.parse(localStorage.getItem(KEY));
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
await send("Page.reload")
await sleep(3500)
await openDrawer("Documents")
await shot("groups", `RECT:(() => {
  const p = ([...document.querySelectorAll('[data-alcove-id]')].filter(e => !document.querySelector('[data-alcove-strip]').contains(e))[0]).getBoundingClientRect();
  const rows = [...document.querySelectorAll('[data-group-row]')].map(e => e.getBoundingClientRect());
  const bottom = rows.length ? Math.max(...rows.map(r => r.bottom)) + 18 : p.bottom;
  return { x: p.left, y: p.top, width: p.width, height: Math.min(p.bottom, bottom) - p.top };
})()`)

// 4. Search, on a clear desktop.
await openDrawer("Documents") // clicking the open tile again closes it
await sleep(600)
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')]
    .find(b => /search/i.test((b.getAttribute('aria-label') || b.title || b.textContent) || ''));
  if (b) b.click();
  return !!b;
})()`)
await sleep(1200)
await shot("search-panel", `document.querySelector('[cmdk-root]')`, 0)

chrome.kill()
process.exit(0)
