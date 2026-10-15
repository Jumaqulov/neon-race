import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from '@playwright/test';
import { build as viteBuild, createServer as createViteServer, type ViteDevServer } from 'vite';
import { createLocalServer, DIST, REPO_ROOT, WEB_ROOT } from '../../backend/src/index.mjs';

const EVIDENCE_DIR = path.join(REPO_ROOT, 'evidence');

async function waitFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let i = 0;
        const step = () => {
          if (++i >= n) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    count,
  );
}

async function resolveChromiumExecutable(): Promise<string | undefined> {
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(localAppData, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

let prodServer: Server;
let prodPort = 0;
let prodBaseUrl = '';
let viteServer: ViteDevServer;
let viteBaseUrl = '';
let browser: Browser;

before(async () => {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  // 1. Always build fresh production bundle from current source
  await fs.rm(DIST, { recursive: true, force: true });
  await viteBuild({ root: WEB_ROOT, logLevel: 'silent' });
  // viteBuild sets process.env.NODE_ENV = 'production'; restore 'development' so StrictMode double-invokes effects
  process.env.NODE_ENV = 'development';

  // 2. Start production static server on an ephemeral loopback port
  prodServer = createLocalServer(DIST);
  await new Promise<void>((resolve, reject) => {
    prodServer.once('error', reject);
    prodServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = prodServer.address();
  if (!addr || typeof addr !== 'object') {
    throw new Error('Failed to bind production test server');
  }
  prodPort = addr.port;
  prodBaseUrl = `http://127.0.0.1:${prodPort}`;

  // 3. Start Vite dev server on an ephemeral loopback port for direct StrictMode lifecycle mounting
  viteServer = await createViteServer({
    root: WEB_ROOT,
    mode: 'development',
    logLevel: 'silent',
    optimizeDeps: {
      force: true,
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
    plugins: [
      {
        name: 'e2e-lifecycle-bridge',
        transform(_code, id) {
          if (id.replace(/\\/g, '/').endsWith('/src/main.tsx')) {
            return `
import { StrictMode, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { GameViewport } from './components/GameViewport.tsx';
import { GameEngine } from './game/GameEngine.ts';
import { SoundEngine } from './game/audio/soundEngine.ts';
import './styles/game.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root topilmadi.');
}

const initialRoot = createRoot(rootEl);
initialRoot.render(
  createElement(StrictMode, null, createElement(App))
);

window.__e2eBridge = {
  unmountInitialRoot: () => initialRoot.unmount(),
  StrictMode,
  createElement,
  createRoot,
  GameViewport,
  GameEngine,
  SoundEngine,
};
`;
          }
          return null;
        },
      },
    ],
  });
  await viteServer.listen();
  const viteAddr = viteServer.httpServer?.address();
  if (!viteAddr || typeof viteAddr !== 'object') {
    throw new Error('Failed to bind Vite test server');
  }
  viteBaseUrl = `http://127.0.0.1:${viteAddr.port}`;

  // 4. Launch real Chromium browser with WebGL enabled
  const executablePath = await resolveChromiumExecutable();
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
});

after(async () => {
  if (browser) {
    await browser.close();
  }
  if (viteServer) {
    await viteServer.close();
  }
  if (prodServer) {
    await new Promise<void>((resolve) => {
      prodServer.close(() => resolve());
      prodServer.closeAllConnections();
    });
  }
});

test('E2E 1: Fresh production build runs offline with zero external network requests, zero console errors, and complete gameplay flow (Start -> Drive -> Steer -> Brake -> Camera -> Crash -> Repair -> Pause/Resume)', async () => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
  });

  const externalRequests: string[] = [];
  const allowedOrigin = new URL(prodBaseUrl).origin;

  await context.route('**/*', async (route) => {
    const reqUrl = route.request().url();
    if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:')) {
      await route.continue();
      return;
    }
    const parsed = new URL(reqUrl);
    if (parsed.origin !== allowedOrigin) {
      externalRequests.push(reqUrl);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  try {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText || 'failed'})`);
    });

    await page.goto(prodBaseUrl, { waitUntil: 'networkidle' });
    assert.equal(await page.title(), 'Neon Race · V3 Local');
    await page.waitForSelector('#gl');
    await page.waitForFunction(
      () => Boolean(window.carLab && window.carLab.rendererInfo.calls > 0 && window.carLab.rendererInfo.triangles > 0),
      undefined,
      { timeout: 5000 },
    );

    // Verify WebGL canvas is non-blank and rendering
    const initialRender = await page.evaluate(() => {
      const glCanvas = document.getElementById('gl') as HTMLCanvasElement | null;
      return {
        hasCanvas: Boolean(glCanvas && glCanvas.width > 0 && glCanvas.height > 0),
        width: glCanvas?.width ?? 0,
        height: glCanvas?.height ?? 0,
        calls: window.carLab?.rendererInfo.calls ?? 0,
        triangles: window.carLab?.rendererInfo.triangles ?? 0,
      };
    });
    assert.equal(initialRender.hasCanvas, true);
    assert(initialRender.calls > 0 && initialRender.triangles > 0, 'WebGL renderer must draw non-empty scene');

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'after-start-desktop.png') });

    // 1. Start the game by clicking #go and wait until splash hides and #gl receives focus
    await page.locator('#go').click();
    await page.waitForFunction(
      () =>
        Boolean(
          document.getElementById('splash')?.classList.contains('hide') &&
            document.activeElement?.id === 'gl',
        ),
      undefined,
      { timeout: 5000 },
    );
    const splashHidden = await page.locator('#splash').evaluate((el) => el.classList.contains('hide'));
    assert.equal(splashHidden, true, 'Splash overlay must hide after clicking Start');

    // Capture deterministic driving baseline screenshot right after reset
    await page.keyboard.press('KeyR');
    await page.waitForFunction(
      () => {
        const phys = window.carLab?.physics();
        return Boolean(phys && Math.abs(phys.speed) < 0.05 && Math.abs(phys.x - -172) < 0.1);
      },
      undefined,
      { timeout: 3000 },
    );
    await waitFrames(page, 1);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'after-driving-desktop.png') });

    // 2. Throttle (KeyW) + Steer (KeyA) + Brake (KeyS) using state-based waits
    const pose0 = await page.evaluate(() => window.carLab!.physics());
    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      (startX: number) => {
        const p = window.carLab?.physics();
        return Boolean(p && p.speed > 5 && p.x > startX + 0.5);
      },
      pose0.x,
      { timeout: 5000 },
    );
    await page.keyboard.down('KeyA');
    await page.waitForFunction(
      (startHeading: number) => {
        const p = window.carLab?.physics();
        return Boolean(p && Math.abs(p.heading - startHeading) > 0.02);
      },
      pose0.heading,
      { timeout: 5000 },
    );
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW');
    const poseDriven = await page.evaluate(() => window.carLab!.physics());
    assert(
      poseDriven.speed > 4,
      `Expected car to accelerate above 4 km/h, got ${poseDriven.speed.toFixed(2)} km/h`,
    );
    assert(poseDriven.x > pose0.x + 0.25, `Expected forward X displacement (got ${poseDriven.x - pose0.x})`);
    assert(Math.abs(poseDriven.heading - pose0.heading) > 0.01, 'Expected steering to change heading');

    // Brake with KeyS and wait until speed measurably drops
    await page.keyboard.down('KeyS');
    await page.waitForFunction(
      (prevSpeed: number) => {
        const p = window.carLab?.physics();
        return Boolean(p && p.speed < prevSpeed - 1.0);
      },
      poseDriven.speed,
      { timeout: 5000 },
    );
    await page.keyboard.up('KeyS');
    const poseBraked = await page.evaluate(() => window.carLab!.physics());
    assert(poseBraked.speed < poseDriven.speed, 'Expected braking to reduce vehicle speed');

    // 3. Camera cycling (KeyC)
    const camBefore = await page.locator('button.tb[data-key="KeyC"] .v').textContent();
    await page.keyboard.press('KeyC');
    await page.waitForFunction(
      (prevCam: string | null) =>
        document.querySelector('button.tb[data-key="KeyC"] .v')?.textContent !== prevCam,
      camBefore,
      { timeout: 3000 },
    );
    const camAfter = await page.locator('button.tb[data-key="KeyC"] .v').textContent();
    assert.notEqual(camAfter, camBefore, 'Expected KeyC to change active camera');

    // 4. In-game Crash Test (KeyV) -> wait for actual wall contact and mesh deformation
    await page.keyboard.press('KeyV');
    await page.waitForFunction(
      () => {
        const snap = window.carLab?.snapshot();
        const cond = document.getElementById('condition')?.textContent;
        return Boolean(snap && snap.contacts >= 1 && snap.displaced > 0 && cond && cond !== '100%');
      },
      undefined,
      { timeout: 6000 },
    );
    await waitFrames(page, 1);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'after-crash-desktop.png') });

    const damageAfterCrash = await page.evaluate(() => ({
      snap: window.carLab!.snapshot(),
      conditionText: document.getElementById('condition')?.textContent,
    }));
    assert(damageAfterCrash.snap && damageAfterCrash.snap.contacts >= 1, 'Crash test must record wall contact');
    assert(damageAfterCrash.snap.displaced > 0, 'Crash test must deform body vertices');
    assert.notEqual(damageAfterCrash.conditionText, '100%', 'Condition percentage must drop after wall crash');

    // 5. Repair (KeyF) -> wait for full restoration state
    await page.keyboard.press('KeyF');
    await page.waitForFunction(
      () => {
        const snap = window.carLab?.snapshot();
        const cond = document.getElementById('condition')?.textContent;
        const lamps = document.getElementById('headlamp-count')?.textContent;
        return Boolean(snap && snap.displaced === 0 && cond === '100%' && lamps === '4 / 4');
      },
      undefined,
      { timeout: 3000 },
    );
    const damageAfterRepair = await page.evaluate(() => ({
      snap: window.carLab!.snapshot(),
      conditionText: document.getElementById('condition')?.textContent,
      headlampsText: document.getElementById('headlamp-count')?.textContent,
    }));
    assert.equal(damageAfterRepair.snap?.displaced, 0, 'Repair must restore all displaced vertices');
    assert.equal(damageAfterRepair.conditionText, '100%');
    assert.equal(damageAfterRepair.headlampsText, '4 / 4');

    // 6. Pause and Resume (Escape)
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => Boolean(document.getElementById('pauseflag')?.classList.contains('show')),
      undefined,
      { timeout: 3000 },
    );
    const isPaused = await page.locator('#pauseflag').evaluate((el) => el.classList.contains('show'));
    assert.equal(isPaused, true, 'Escape must pause the game and show pause banner');

    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => !document.getElementById('pauseflag')?.classList.contains('show'),
      undefined,
      { timeout: 3000 },
    );
    const isResumed = await page.locator('#pauseflag').evaluate((el) => !el.classList.contains('show'));
    assert.equal(isResumed, true, 'Second Escape must resume the game');

    // 7. Mobile viewport verification (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => {
        const gl = document.getElementById('gl') as HTMLCanvasElement | null;
        return Boolean(gl && gl.clientWidth === 390 && gl.clientHeight === 844);
      },
      undefined,
      { timeout: 3000 },
    );
    await waitFrames(page, 1);
    const mobileViewportState = await page.evaluate(() => {
      const gl = document.getElementById('gl') as HTMLCanvasElement | null;
      return {
        canvasWidth: gl?.clientWidth ?? 0,
        canvasHeight: gl?.clientHeight ?? 0,
        toolbarVisible: Boolean(document.getElementById('toolbar')),
      };
    });
    assert.equal(mobileViewportState.canvasWidth, 390);
    assert.equal(mobileViewportState.canvasHeight, 844);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'after-mobile.png') });

    assert.deepEqual(externalRequests, [], 'Zero external network requests allowed');
    assert.deepEqual(failedRequests, [], 'Zero failed network requests allowed');
    assert.deepEqual(pageErrors, [], 'Zero uncaught page errors allowed');
    assert.deepEqual(consoleErrors, [], 'Zero console errors allowed');
  } finally {
    await context.close();
  }
});

test('E2E 2: Keyboard and UI focus separation in real browser (all 6 required focus & input scenarios)', async () => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  try {
    const page = await context.newPage();
    await page.goto(prodBaseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#gl');

    // Scenario 6: Clicking Start (#go) starts game and returns focus to #gl canvas for driving
    await page.locator('#go').click();
    await page.waitForFunction(() => document.activeElement?.id === 'gl', undefined, { timeout: 3000 });
    const activeAfterStart = await page.evaluate(() => document.activeElement?.id);
    assert.equal(activeAfterStart, 'gl', 'Focus must move to #gl canvas after clicking Start');

    // Scenario 1: Focused toolbar button + Space -> exactly 1 click, handbrake stays false
    const tcsBtn = page.locator('button.tb[data-key="KeyT"]');
    await page.evaluate(() => {
      const btn = document.querySelector('button.tb[data-key="KeyT"]');
      (window as unknown as { __tcsClicks: number }).__tcsClicks = 0;
      btn?.addEventListener('click', () => {
        (window as unknown as { __tcsClicks: number }).__tcsClicks++;
      });
    });

    await tcsBtn.focus();
    const tcsInitial = await tcsBtn.locator('.v').textContent();
    await page.keyboard.down('Space');
    await waitFrames(page, 2);
    const buttonSpaceState = await page.evaluate(() => ({
      activeKey: document.activeElement?.getAttribute('data-key'),
      hb: window.carLab!.physics().hb,
    }));
    assert.equal(buttonSpaceState.activeKey, 'KeyT');
    assert.equal(buttonSpaceState.hb, false, 'Focused toolbar button + Space must NOT engage handbrake');
    await page.keyboard.up('Space');
    await page.waitForFunction(
      () => (window as unknown as { __tcsClicks: number }).__tcsClicks === 1,
      undefined,
      { timeout: 3000 },
    );

    const scenario1Result = await page.evaluate(() => ({
      clicks: (window as unknown as { __tcsClicks: number }).__tcsClicks,
      tcsVal: document.querySelector('button.tb[data-key="KeyT"] .v')?.textContent,
      activeKey: document.activeElement?.getAttribute('data-key'),
      hbDuringSpace: false,
    }));
    assert.equal(scenario1Result.clicks, 1, 'Focused toolbar button + Space must fire click once');
    assert.notEqual(scenario1Result.tcsVal, tcsInitial, 'Focused toolbar button + Space must toggle TCS');
    assert.equal(scenario1Result.activeKey, 'KeyT', 'Button must retain focus for keyboard navigation');

    // Scenario 2: Same focused toolbar button + Enter -> 1 activation
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => (window as unknown as { __tcsClicks: number }).__tcsClicks === 2,
      undefined,
      { timeout: 3000 },
    );
    const scenario2Result = await page.evaluate(() => ({
      clicks: (window as unknown as { __tcsClicks: number }).__tcsClicks,
      tcsVal: document.querySelector('button.tb[data-key="KeyT"] .v')?.textContent,
    }));
    assert.equal(scenario2Result.clicks, 2, 'Same focused toolbar button + Enter must activate once');
    assert.equal(scenario2Result.tcsVal, tcsInitial, 'Second activation must toggle TCS back');

    // Scenario 3: Game canvas (#gl) focused + Space -> handbrake engages on keydown and clears on keyup
    await page.locator('#gl').click({ position: { x: 640, y: 360 } });
    await page.waitForFunction(() => document.activeElement?.id === 'gl', undefined, { timeout: 3000 });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'gl');

    await page.keyboard.down('Space');
    await page.waitForFunction(() => window.carLab?.physics().hb === true, undefined, { timeout: 3000 });
    const hbWhileHeldOnCanvas = await page.evaluate(() => window.carLab!.physics().hb);
    assert.equal(hbWhileHeldOnCanvas, true, 'Space on focused #gl canvas must engage handbrake (hb === true)');
    await page.keyboard.up('Space');
    await page.waitForFunction(() => window.carLab?.physics().hb === false, undefined, { timeout: 3000 });
    const hbAfterReleaseOnCanvas = await page.evaluate(() => window.carLab!.physics().hb);
    assert.equal(hbAfterReleaseOnCanvas, false, 'Releasing Space on #gl canvas must clear handbrake (hb === false)');
    const speedBeforeHb = hbWhileHeldOnCanvas;
    const speedDuringHb = hbAfterReleaseOnCanvas;

    // Reset car to standstill for Scenarios 4 and 5
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => Math.abs(window.carLab?.physics().speed ?? 1) < 0.05, undefined, { timeout: 3000 });

    // Scenario 4: Typing 'w' into an <input> enters text and does NOT engage throttle
    await page.evaluate(() => {
      const inp = document.createElement('input');
      inp.id = 'test-search-input';
      inp.type = 'text';
      document.body.appendChild(inp);
      inp.focus();
    });
    await page.keyboard.press('KeyW');
    await waitFrames(page, 2);
    const scenario4Result = await page.evaluate(() => {
      const inp = document.getElementById('test-search-input') as HTMLInputElement;
      return {
        value: inp.value,
        speed: window.carLab!.physics().speed,
        rpm: window.carLab!.physics().rpm,
      };
    });
    assert.equal(scenario4Result.value.toLowerCase(), 'w', 'Typing W in input must insert character');
    assert(scenario4Result.speed < 0.05, 'Typing W in input must NOT accelerate the car');

    // Scenario 5: Holding W on canvas, shifting focus to <input>, then keyup -> throttle does not stay stuck
    await page.locator('#gl').focus();
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => (window.carLab?.physics().rpm ?? 0) > 1500, undefined, { timeout: 5000 });
    const rpmWhileHeld = await page.evaluate(() => window.carLab!.physics().rpm);
    assert(rpmWhileHeld > 1100, 'Holding W on canvas must raise engine RPM');

    // Shift focus to input while W is still held, then release W
    await page.evaluate(() => {
      const inp = document.getElementById('test-search-input') as HTMLInputElement;
      inp.focus();
    });
    await page.keyboard.up('KeyW');
    await page.waitForFunction(
      (peakRpm: number) => (window.carLab?.physics().rpm ?? peakRpm) < peakRpm - 300,
      rpmWhileHeld,
      { timeout: 5000 },
    );
    const rpmAfterFocusShiftRelease = await page.evaluate(() => window.carLab!.physics().rpm);
    assert(
      rpmAfterFocusShiftRelease < rpmWhileHeld,
      `Throttle must not stay stuck after focus change + keyup (RPM=${rpmAfterFocusShiftRelease} vs ${rpmWhileHeld})`,
    );

    const inputResultsReport = {
      capturedAt: new Date().toISOString(),
      scenario1_focusedButtonSpace: scenario1Result,
      scenario2_focusedButtonEnter: scenario2Result,
      scenario3_canvasSpaceHandbrake: { speedBeforeHb, speedDuringHb },
      scenario4_inputTypingW: scenario4Result,
      scenario5_focusShiftWhileHoldingW: { rpmWhileHeld, rpmAfterFocusShiftRelease },
      scenario6_startFocusesCanvas: { activeAfterStart },
    };
    await fs.writeFile(
      path.join(EVIDENCE_DIR, 'input-browser-results.json'),
      JSON.stringify(inputResultsReport, null, 2),
      'utf8',
    );
  } finally {
    await context.close();
  }
});

test('E2E 3: Real React StrictMode + WebGL GameViewport 5x mount -> run -> crash -> unmount lifecycle and audio init error cleanup probe', async () => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  try {
    const page = await context.newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    // Instrument RAF and AudioContext at page init to verify zero leaked loops or unclosed AudioContexts
    await page.addInitScript(() => {
      const activeRafs = new Set<number>();
      const origRaf = window.requestAnimationFrame.bind(window);
      const origCaf = window.cancelAnimationFrame.bind(window);

      window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
        const id = origRaf((time) => {
          activeRafs.delete(id);
          cb(time);
        });
        activeRafs.add(id);
        return id;
      };
      window.cancelAnimationFrame = (id: number): void => {
        activeRafs.delete(id);
        origCaf(id);
      };

      const audioContexts: AudioContext[] = [];
      let closeCallsCount = 0;
      const OrigAC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (OrigAC) {
        const origClose = OrigAC.prototype.close;
        OrigAC.prototype.close = function (this: AudioContext) {
          closeCallsCount++;
          return origClose.call(this);
        };
        const WrappedAC = function (this: unknown, options?: AudioContextOptions) {
          const instance = new OrigAC(options);
          audioContexts.push(instance);
          return instance;
        } as unknown as typeof AudioContext;
        WrappedAC.prototype = OrigAC.prototype;
        window.AudioContext = WrappedAC;
      }

      (window as unknown as { __lifecycleProbe: unknown }).__lifecycleProbe = {
        getActiveRafCount: () => activeRafs.size,
        getAudioStates: () => audioContexts.map((c) => c.state),
        getCloseCallsCount: () => closeCallsCount,
      };
    });

    await page.goto(viteBaseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#gl');

    // Execute 5 full StrictMode mount -> start (WebGL + Audio) -> crash wall impact -> unmount cycles
    const probeReport = await page.evaluate(async () => {
      interface BridgeSoundEngine {
        ctx: AudioContext | null;
        init(soundEnabled: boolean): boolean;
        waitForClose(): Promise<void>;
        dispose(): void;
        isDisposed(): boolean;
      }

      interface BridgeEngine {
        start(): void;
        toggleKey(code: string): void;
        isDisposed(): boolean;
        isLoopActive(): boolean;
        getMemoryInfo(): { geometries: number; textures: number };
        resources: {
          counts(): { geometries: number; materials: number; textures: number; renderTargets: number };
        };
        audio: BridgeSoundEngine;
      }

      const bridge = (window as unknown as {
        __e2eBridge: {
          unmountInitialRoot: () => void;
          StrictMode: unknown;
          createElement: (...args: unknown[]) => unknown;
          createRoot: (el: HTMLElement) => { render: (node: unknown) => void; unmount: () => void };
          GameViewport: unknown;
          GameEngine: new () => BridgeEngine;
          SoundEngine: new () => BridgeSoundEngine;
        };
      }).__e2eBridge;

      // Unmount initial root cleanly so we control the 5 StrictMode cycles deterministically
      bridge.unmountInitialRoot();
      const rootEl = document.getElementById('root')!;
      rootEl.innerHTML = '';
      await new Promise((r) => setTimeout(r, 80));

      const probe = (window as unknown as {
        __lifecycleProbe: {
          getActiveRafCount: () => number;
          getAudioStates: () => string[];
          getCloseCallsCount: () => number;
        };
      }).__lifecycleProbe;

      // 1. Verify real-browser SoundEngine partial init failure closes AudioContext immediately
      const closeCallsBeforeFailureTest = probe.getCloseCallsCount();
      const origCreateWaveShaper = AudioContext.prototype.createWaveShaper;
      AudioContext.prototype.createWaveShaper = function () {
        throw new Error('Injected real-browser createWaveShaper failure');
      };
      let audioInitFailureProbe: {
        initResult: boolean;
        ctxAfterFailure: boolean;
        closeCallsDelta: number;
        statesAfterWaitForClose: string[];
        disposed: boolean;
      };
      try {
        const failedSound = new bridge.SoundEngine();
        const initResult = failedSound.init(true);
        const ctxAfterFailure = failedSound.ctx !== null;
        await failedSound.waitForClose();
        failedSound.dispose();
        await failedSound.waitForClose();
        audioInitFailureProbe = {
          initResult,
          ctxAfterFailure,
          closeCallsDelta: probe.getCloseCallsCount() - closeCallsBeforeFailureTest,
          statesAfterWaitForClose: probe.getAudioStates(),
          disposed: failedSound.isDisposed(),
        };
      } finally {
        AudioContext.prototype.createWaveShaper = origCreateWaveShaper;
      }

      const waitUntil = async (predicate: () => boolean, label: string, timeoutMs = 15000): Promise<void> => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          if (predicate()) return;
          await new Promise<void>((r) => setTimeout(r, 25));
        }
        throw new Error(`Timed out after ${timeoutMs}ms waiting for condition: ${label}`);
      };

      const cycles: Array<{
        cycle: number;
        totalCreatedDuringStrictModeMount: number;
        activeDuringRun: number;
        glCanvasCountDuringRun: number;
        crashContactsBeforeDispose: number;
        crashDisplacedBeforeDispose: number;
        rendererInfoBeforeDispose: { calls: number; triangles: number; geometries: number; textures: number };
        trackedResourcesBeforeDispose: { geometries: number; materials: number; textures: number; renderTargets: number };
        trackedResourcesAfterDispose: { geometries: number; materials: number; textures: number; renderTargets: number };
        rendererMemoryAfterDispose: { geometries: number; textures: number };
        engineIsDisposed: boolean;
        activeAfterUnmount: number;
        activeRafsAfterUnmount: number;
        glCanvasCountAfterUnmount: number;
        carLabAfterUnmount: boolean;
        audioClosedAfterUnmount: boolean;
      }> = [];

      for (let i = 1; i <= 5; i++) {
        const host = document.createElement('div');
        rootEl.appendChild(host);

        const createdEngines: BridgeEngine[] = [];
        let currentReadyEngine: BridgeEngine | null = null;

        const root = bridge.createRoot(host);
        root.render(
          bridge.createElement(
            bridge.StrictMode,
            null,
            bridge.createElement(bridge.GameViewport, {
              createEngine: () => {
                const eng = new bridge.GameEngine();
                createdEngines.push(eng);
                return eng;
              },
              onEngineReady: (eng: BridgeEngine) => {
                currentReadyEngine = eng;
              },
            }),
          ),
        );

        // Wait until StrictMode mount->unmount->remount settles and active engine renders
        await waitUntil(
          () =>
            Boolean(
              currentReadyEngine &&
                !currentReadyEngine.isDisposed() &&
                currentReadyEngine.isLoopActive() &&
                window.carLab &&
                window.carLab.rendererInfo.calls > 0,
            ),
          `cycle ${i} StrictMode mount and initial WebGL render`,
          15000,
        );

        const activeEnginesDuringRun = createdEngines.filter((e) => !e.isDisposed() && e.isLoopActive());
        const glCanvasCountDuringRun = host.querySelectorAll('canvas#gl').length;

        // Start the active engine (including Web Audio), trigger 80 km/h crash test (KeyV),
        // and wait until actual wall contact and mesh deformation occur before unmount!
        const readyEngine = currentReadyEngine as BridgeEngine | null;
        if (!readyEngine) {
          throw new Error(`Cycle ${i}: GameEngine did not become ready`);
        }
        readyEngine.start();
        readyEngine.toggleKey('KeyV');

        await waitUntil(
          () => {
            const snap = window.carLab?.snapshot();
            return Boolean(snap && snap.contacts >= 1 && snap.displaced > 0);
          },
          `cycle ${i} crash test wall contact and deformation`,
          15000,
        );

        const crashSnap = window.carLab?.snapshot();
        const crashContactsBeforeDispose = crashSnap?.contacts ?? 0;
        const crashDisplacedBeforeDispose = crashSnap?.displaced ?? 0;

        const rendererInfoBeforeDispose = window.carLab
          ? { ...window.carLab.rendererInfo }
          : { calls: 0, triangles: 0, geometries: 0, textures: 0 };
        const trackedResourcesBeforeDispose = readyEngine.resources.counts();

        // Unmount StrictMode tree
        root.unmount();
        await readyEngine.audio.waitForClose();
        await new Promise((r) => setTimeout(r, 40));

        const trackedResourcesAfterDispose = readyEngine.resources.counts();
        const rendererMemoryAfterDispose = readyEngine.getMemoryInfo();
        const engineIsDisposed = readyEngine.isDisposed();
        const activeAfterUnmount = createdEngines.filter((e) => !e.isDisposed() || e.isLoopActive()).length;
        const activeRafsAfterUnmount = probe.getActiveRafCount();
        const glCanvasCountAfterUnmount = host.querySelectorAll('canvas#gl').length;
        const carLabAfterUnmount = window.carLab !== undefined;
        const audioClosedAfterUnmount = readyEngine.audio.isDisposed();

        host.remove();

        cycles.push({
          cycle: i,
          totalCreatedDuringStrictModeMount: createdEngines.length,
          activeDuringRun: activeEnginesDuringRun.length,
          glCanvasCountDuringRun,
          crashContactsBeforeDispose,
          crashDisplacedBeforeDispose,
          rendererInfoBeforeDispose,
          trackedResourcesBeforeDispose,
          trackedResourcesAfterDispose,
          rendererMemoryAfterDispose,
          engineIsDisposed,
          activeAfterUnmount,
          activeRafsAfterUnmount,
          glCanvasCountAfterUnmount,
          carLabAfterUnmount,
          audioClosedAfterUnmount,
        });
      }

      return {
        capturedAt: new Date().toISOString(),
        audioInitFailureProbe,
        cycles,
        finalAudioStates: probe.getAudioStates(),
      };
    });

    await fs.writeFile(
      path.join(EVIDENCE_DIR, 'cleanup-probe.json'),
      JSON.stringify({ ...probeReport, consoleErrors, pageErrors }, null, 2),
      'utf8',
    );

    assert.equal(consoleErrors.length, 0, `Unexpected console.error during lifecycle probe: ${consoleErrors.join('; ')}`);
    assert.equal(pageErrors.length, 0, `Unexpected pageerror during lifecycle probe: ${pageErrors.join('; ')}`);

    // Verify real-browser SoundEngine partial init failure probe
    assert.equal(probeReport.audioInitFailureProbe.initResult, false, 'Failed SoundEngine.init must return false');
    assert.equal(probeReport.audioInitFailureProbe.ctxAfterFailure, false, 'Failed SoundEngine.init must clear ctx');
    assert.equal(
      probeReport.audioInitFailureProbe.closeCallsDelta,
      1,
      'Failed SoundEngine.init must call AudioContext.close() exactly once',
    );
    assert(
      probeReport.audioInitFailureProbe.statesAfterWaitForClose.every((s) => s === 'closed'),
      'AudioContext created during failed SoundEngine.init must transition to closed',
    );

    assert.equal(probeReport.cycles.length, 5);
    for (const c of probeReport.cycles) {
      assert(
        c.totalCreatedDuringStrictModeMount >= 2,
        `Cycle ${c.cycle}: StrictMode must exercise mount->unmount->remount (created=${c.totalCreatedDuringStrictModeMount})`,
      );
      assert.equal(c.activeDuringRun, 1, `Cycle ${c.cycle}: Exactly 1 active engine allowed during run`);
      assert.equal(c.glCanvasCountDuringRun, 1, `Cycle ${c.cycle}: Exactly 1 WebGL #gl canvas allowed during run`);
      assert(c.crashContactsBeforeDispose >= 1, `Cycle ${c.cycle}: Crash test must record wall contact before unmount`);
      assert(c.crashDisplacedBeforeDispose > 0, `Cycle ${c.cycle}: Crash test must deform vertices before unmount`);
      assert(c.trackedResourcesBeforeDispose.geometries > 20, `Cycle ${c.cycle}: Expected tracked geometries > 20`);
      assert(c.trackedResourcesBeforeDispose.materials > 15, `Cycle ${c.cycle}: Expected tracked materials > 15`);
      assert(c.trackedResourcesBeforeDispose.textures > 10, `Cycle ${c.cycle}: Expected tracked textures > 10`);
      assert(c.trackedResourcesBeforeDispose.renderTargets >= 2, `Cycle ${c.cycle}: Expected PMREM render targets >= 2`);
      assert.deepEqual(
        c.trackedResourcesAfterDispose,
        { geometries: 0, materials: 0, textures: 0, renderTargets: 0 },
        `Cycle ${c.cycle}: All tracked GPU resources must be drained on dispose()`,
      );
      assert.deepEqual(
        c.rendererMemoryAfterDispose,
        { geometries: 0, textures: 0 },
        `Cycle ${c.cycle}: renderer.info.memory.geometries and textures must be 0 after dispose()`,
      );
      assert.equal(c.engineIsDisposed, true, `Cycle ${c.cycle}: engine.isDisposed() must be true after unmount`);
      assert.equal(c.activeAfterUnmount, 0, `Cycle ${c.cycle}: Zero active engines allowed after unmount`);
      assert.equal(c.activeRafsAfterUnmount, 0, `Cycle ${c.cycle}: Zero active RAF callbacks allowed after unmount`);
      assert.equal(c.glCanvasCountAfterUnmount, 0, `Cycle ${c.cycle}: WebGL #gl canvas must be removed on unmount`);
      assert.equal(c.carLabAfterUnmount, false, `Cycle ${c.cycle}: window.carLab must be cleaned up on unmount`);
      assert.equal(c.audioClosedAfterUnmount, true, `Cycle ${c.cycle}: SoundEngine must be disposed on unmount`);
    }

    for (const state of probeReport.finalAudioStates) {
      assert.equal(state, 'closed', 'Every created AudioContext must be closed after unmount');
    }
  } finally {
    await context.close();
  }
});
