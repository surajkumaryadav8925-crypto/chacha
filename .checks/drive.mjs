/**
 * Local verification harness: launches headless Chrome, drives the real page
 * with CDP input events and records what happened. Not part of the app build.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const APP = 'http://127.0.0.1:5173/';
const OUT = path.resolve('.checks');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} ${JSON.stringify(msg.error.data ?? '')}`));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description ?? ''));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  evaluate(expression) {
    return this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }).then((r) => {
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    });
  }

  async screenshot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  }

  async mouse(type, x, y, extra = {}) {
    await this.send('Input.dispatchMouseEvent', { type, x, y, ...extra });
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(OUT, 'profile');
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--window-size=1600,1000',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--enable-gpu',
      '--use-angle=d3d11',
      APP,
    ],
    { stdio: 'ignore' },
  );

  const report = { steps: [], errors: [] };
  let ws;
  try {
    // wait for the debugging target
    let target = null;
    for (let i = 0; i < 60 && !target; i += 1) {
      await sleep(250);
      try {
        const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
        target = list.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:5173'));
      } catch {
        /* keep waiting */
      }
    }
    if (!target) throw new Error('Chrome page target never appeared');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const ready = async () => {
      for (let i = 0; i < 80; i += 1) {
        const info = await cdp.evaluate('window.__sphere ? window.__sphere.getDebugInfo() : null');
        if (info && info.textures >= 20) return info;
        await sleep(250);
      }
      throw new Error('sphere never became ready');
    };

    const renderer = await cdp.evaluate(`(() => {
      const gl = document.getElementById('scene').getContext('webgl2');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        dpr: window.devicePixelRatio,
        viewport: [innerWidth, innerHeight],
      };
    })()`);
    report.renderer = renderer;

    await ready();
    await sleep(1200);
    report.initial = await cdp.evaluate('window.__sphere.getDebugInfo()');
    await cdp.screenshot('01-initial');

    // ── frame rate ────────────────────────────────────────────────
    report.fps = await cdp.evaluate(`new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const step = () => {
        frames += 1;
        if (performance.now() - start < 2000) requestAnimationFrame(step);
        else resolve({ frames, ms: +(performance.now() - start).toFixed(0), fps: +(frames / ((performance.now() - start) / 1000)).toFixed(1) });
      };
      requestAnimationFrame(step);
    })`);

    // ── hover ────────────────────────────────────────────────────
    await cdp.mouse('mouseMoved', 800, 500);
    await sleep(350);
    report.hover = await cdp.evaluate('window.__sphere.getDebugInfo().hovered');
    await cdp.screenshot('02-hover');

    // ── drag rotation ────────────────────────────────────────────
    const beforeDrag = await cdp.evaluate('window.__sphere.getDebugInfo()');
    await cdp.mouse('mousePressed', 800, 500, { button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 12; i += 1) {
      await cdp.mouse('mouseMoved', 800 + i * 18, 500 + i * 6, { button: 'left', buttons: 1 });
      await sleep(16);
    }
    await cdp.mouse('mouseReleased', 1016, 572, { button: 'left', buttons: 0, clickCount: 1 });
    await sleep(120);
    const afterDrag = await cdp.evaluate('window.__sphere.getDebugInfo()');
    report.drag = {
      before: beforeDrag.rotation,
      after: afterDrag.rotation,
      rotated: JSON.stringify(beforeDrag.rotation) !== JSON.stringify(afterDrag.rotation),
    };
    await cdp.screenshot('03-rotated');

    // inertia: the sphere should keep turning briefly after release
    await sleep(300);
    const inertia = await cdp.evaluate('window.__sphere.getDebugInfo()');
    report.inertia = JSON.stringify(inertia.rotation) !== JSON.stringify(afterDrag.rotation);

    // ── wheel zoom ───────────────────────────────────────────────
    const beforeZoom = await cdp.evaluate('window.__sphere.getDebugInfo()');
    for (let i = 0; i < 4; i += 1) {
      await cdp.mouse('mouseWheel', 800, 500, { deltaY: -160, deltaX: 0 });
      await sleep(90);
    }
    await sleep(900);
    const afterZoom = await cdp.evaluate('window.__sphere.getDebugInfo()');
    report.zoom = {
      beforeZ: beforeZoom.cameraZ,
      afterZ: afterZoom.cameraZ,
      zoomedIn: afterZoom.cameraZ < beforeZoom.cameraZ,
    };
    await cdp.screenshot('04-zoomed');

    // ── pinch zoom (touch) ───────────────────────────────────────
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const pinchBefore = await cdp.evaluate('window.__sphere.getDebugInfo().cameraZ');
    const touch = (type, points) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((p) => ({ x: p[0], y: p[1], radiusX: 2, radiusY: 2, force: 1, id: p[2] })),
      });

    await touch('touchStart', [[640, 480, 0], [960, 480, 1]]);
    for (let i = 1; i <= 8; i += 1) {
      await touch('touchMove', [[640 - i * 12, 480, 0], [960 + i * 12, 480, 1]]);
      await sleep(20);
    }
    await touch('touchEnd', []);
    await sleep(800);
    const pinchAfter = await cdp.evaluate('window.__sphere.getDebugInfo().cameraZ');
    report.pinch = { beforeZ: pinchBefore, afterZ: pinchAfter, zoomedIn: pinchAfter < pinchBefore };
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });

    // ── click a photograph → viewer ──────────────────────────────
    const points = [[800, 500], [742, 452], [858, 548], [700, 520], [900, 470], [800, 430], [640, 500]];
    let opened = false;
    for (const [x, y] of points) {
      await cdp.mouse('mouseMoved', x, y);
      await sleep(120);
      await cdp.mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
      await cdp.mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
      await sleep(700);
      opened = await cdp.evaluate("document.querySelector('.viewer')?.classList.contains('is-open') ?? false");
      if (opened) {
        report.clickPoint = [x, y];
        break;
      }
    }
    report.viewerOpened = opened;

    if (opened) {
      await sleep(700);
      report.viewer = await cdp.evaluate(`(() => {
        const img = document.querySelector('.viewer__img');
        return {
          src: img.getAttribute('src'),
          natural: [img.naturalWidth, img.naturalHeight],
          counter: document.querySelector('.viewer__counter').textContent,
          closeLabel: document.querySelector('.viewer__close').getAttribute('aria-label'),
          prevLabel: document.querySelector('.viewer__prev').getAttribute('aria-label'),
          nextLabel: document.querySelector('.viewer__next').getAttribute('aria-label'),
          introHidden: document.getElementById('app').classList.contains('is-viewing'),
          spherePaused: window.__sphere.getDebugInfo().drawCalls,
        };
      })()`);
      await cdp.screenshot('05-viewer');

      const firstSrc = await cdp.evaluate("document.querySelector('.viewer__img').getAttribute('src')");
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await sleep(800);
      const nextSrc = await cdp.evaluate("document.querySelector('.viewer__img').getAttribute('src')");
      report.arrowRight = {
        changed: firstSrc !== nextSrc,
        counter: await cdp.evaluate("document.querySelector('.viewer__counter').textContent"),
        hiResLoaded: await cdp.evaluate("document.querySelector('.viewer__img').naturalWidth > 500"),
      };
      await cdp.screenshot('06-viewer-next');

      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
      await sleep(600);
      report.arrowLeftBack = (await cdp.evaluate("document.querySelector('.viewer__img').getAttribute('src')")) === firstSrc;

      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(900);
      report.closed = await cdp.evaluate(`({
        open: document.querySelector('.viewer').classList.contains('is-open'),
        introVisible: !document.getElementById('app').classList.contains('is-viewing'),
      })`);
      await cdp.screenshot('07-closed');

      // the sphere must resume animating after closing
      const r1 = await cdp.evaluate('window.__sphere.getDebugInfo()');
      await sleep(700);
      const r2 = await cdp.evaluate('window.__sphere.getDebugInfo()');
      report.resumed = JSON.stringify(r1.rotation) !== JSON.stringify(r2.rotation);
    }

    report.final = await cdp.evaluate('window.__sphere.getDebugInfo()');
    report.consoleErrors = await cdp.evaluate('window.__errors ?? null');
    report.errors = [];
  } catch (error) {
    report.fatal = String(error?.stack ?? error);
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    chrome.kill();
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}

main();
