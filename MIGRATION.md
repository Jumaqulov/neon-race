# MIGRATION.md — Monorepo (`web/` + `backend/`) va React + TypeScript + Vite Arxitekturasi

Ushbu hujjat `D:\neon-race` loyihasining yagona Git repozitoriy (monorepo) ichida **`web/`** (React + TypeScript + Vite) va **`backend/`** (Node.js lokal server, kelajakda Rust + Tokio + Axum) tuzilmasiga o‘tkazilganini hamda audit natijasida mustahkamlangan qismlarini tavsiflaydi.

---

## 1. Monorepo arxitekturasi (`D:\neon-race`)

Repozitoriy ildizida (`D:\neon-race\package.json`) npm workspaces (`["web", "backend"]`) va `"engines": { "node": ">=24.0.0", "npm": ">=11.0.0" }` talabi ishlatiladi:

- **`web/`** (`@neon-race/web`):
  - React 19 + TypeScript (`strict: true`) + Vite 6 + Three.js (`0.128.0`) asosidagi frontend ilova.
  - Fizika (`120 Hz` fixed timestep), 3D sahna, kuzov deformatsiyasi, zarrachalar, Web Audio sintezatori va React UI komponentlari shu yerda joylashgan.
  - `web/tests/` ichida:
    - `physics.test.ts` — 20 ta deterministik avtomobil fizikasi, to‘qnashuv va deformatsiya testi;
    - `engine.test.ts` — 8 ta headless `GameEngine`, `ResourceTracker`, PMREM `WebGLRenderTarget`, `window.carLab` token egaligi, `InputController` fokus ajratish, `SoundEngine` yarim tayyorlangan audio xatosini tozalash va `localStorage` sinxronizatsiyasi testi;
    - `e2e.test.ts` — 3 ta haqiqiy Chromium (Playwright + WebGL) E2E testi (offline tarmoq izolyatsiyasi, 6 ta fokus/klaviatura ssenariysi, hamda 5 marta React `<StrictMode>` mount → run → crash → unmount va audio xato tozalash sikli).
- **`backend/`** (`@neon-race/backend`):
  - `backend/src/index.mjs` — `web/dist/` production build fayllarini `127.0.0.1:4173` da xavfsizlik sarlavhalari (`CSP`, `X-Content-Type-Options`, symlink va path traversal himoyasi) bilan uzatuvchi lokal server hamda `/health` endpointi.
  - `backend/tests/server.test.ts` — 11 ta HTTP, xavfsizlik va fresh build asosidagi offline bundle (`HTML` + barcha `CSS`/`JS` assetlar) testi.
- **`original/`**:
  - `original/muscle-car-v3.html` — dastlabki V3 monolit HTML fayli (zaxira va taqqoslash manbasi sifatida o‘zgarishsiz saqlangan).

---

## 2. Modullar xaritasi (`web/src/` va `backend/src/`)

| Asl qism | Yangi monorepo yo‘li | Mas’uliyati |
| :--- | :--- | :--- |
| Umumiy konstantalar va turlar | `web/src/shared/types.ts` | `PAINTS` (8 ta), `CAMS` (5 ta), `START_POSE`, `ARENA`, `GameInput`, `GameSettings`, `DamageState`, `GameSnapshot`, `GameCommand` |
| `localStorage` sozlamalari | `web/src/storage/settingsStore.ts` | `store`, `loadInitialSettings` (`musclecar.cam`, `musclecar.tcs`, `musclecar.shadowsV3`, `musclecar.sound`, `musclecar.mph`, `musclecar.paint`, `musclecar.best`) |
| Avtomobil fizikasi (120 Hz, 5 uzatma + R) | `web/src/game/physics/carPhysics.ts` | `CarPhysics` (`gears: [2.95, 1.95, 1.42, 1.10, 0.87]`, `reverse: 3.1`, `final: 3.7`), `clamp`, `lerp`, `smooth` |
| To‘qnashuvlar va Grid | `web/src/game/physics/collisions.ts` | `ColliderGrid`, `collideCircle`, `collide` |
| Deformatsiya matematikasi | `web/src/game/damage/deformation.ts` | `impactWeight`, `impactDisplacement`, `makeCrushHit` |
| Kuzov shikastlanishi | `web/src/game/damage/vehicleDamage.ts` | `tessellateDamageGeometry`, `VehicleDamage` |
| Bo‘laklar va uchqunlar | `web/src/game/damage/debris.ts` | `CrashParticles`, `LensDebris`, `BreakawayParts`, `MetalDebris` |
| 3D avtomobil modeli | `web/src/game/vehicle/muscleCar.ts` | `createMuscleCar`, `optimizeCarMeshes`, `setFixtureFracture` |
| 3D dunyo va konuslar | `web/src/game/world/worldBuilder.ts` | `buildWorld`, `resetCone`, `updateCones`, `instanceCones`, `syncConeInstances` |
| Zarrachalar (iz, tutun) | `web/src/game/effects/particles.ts` | `SkidMarks`, `Smoke`, `exhaustProfile`, `ExhaustSmoke` |
| Shader, osmon va batching | `web/src/game/rendering/batching.ts` | `THEMES`, `makeSkyMaterial`, `applySkyTheme`, `detailTexture`, `mergeRigidMeshes` |
| GPU resurslar trekeri | `web/src/game/rendering/resourceTracker.ts` | `ResourceTracker` (`Mesh`, `InstancedMesh`, `Points`, `LineSegments`, `Sprite`, texture maps, shader uniforms, PMREM `WebGLRenderTarget`) |
| Adaptiv sifat | `web/src/game/rendering/adaptiveQuality.ts` | `QUALITY_PROFILES`, `AdaptiveQuality` |
| Spidometr va G-metr canvas | `web/src/game/rendering/gauges.ts` | `GaugeRenderer` (`#cluster` va `#gmeter`, 30 Hz) |
| Web Audio sintezatori | `web/src/game/audio/soundEngine.ts` | `SoundEngine`, `cleanupResources()` (`init()` xatosida ham `AudioContext.close()`), `waitForClose()` va idempotent `dispose()` |
| Klaviatura/sichqoncha/gamepad | `web/src/game/input/inputController.ts` | `InputController`, `isInteractiveTarget`, `focusin`/`blur`/`visibilitychange` input reset |
| Kamera va Inspect orbit | `web/src/game/camera/cameraController.ts` | `CameraController`, pointer capture tozalash, `wrapAngle` |
| O‘yin dvigateli | `web/src/game/GameEngine.ts` | `GameEngine` (`init`, `start`, `pause`, `resume`, `resize`, `dispose`, `focusCanvas`, `getSnapshot`, `subscribe`, `dispatch`) |
| React UI qatlami | `web/src/app/App.tsx`, `web/src/components/*` | `GameViewport`, `GameToolbar`, `GameHud`, `StartScreen`, `TouchControls` |
| Lokal backend server | `backend/src/index.mjs` | `createLocalServer`, `/health`, `127.0.0.1:4173` |

---

## 3. Kelajakdagi Rust + Axum va Rust + Rapier + WASM integratsiya nuqtalari

1. **Rust + Tokio + Axum Backend (`backend/`)**:
   - `backend/` papkasi alohida ajratilgani sababli, keyingi bosqichda `backend/Cargo.toml` va `backend/src/main.rs` yaratilib, Axum serveri shu yerda yoziladi.
   - `web/src/game/GameEngine.ts` ichidagi `dispatch(cmd: GameCommand)` va `getSnapshot(): GameSnapshot` turlari WebSocket / WebTransport xabarlariga to‘g‘ridan-to‘g‘ri mos keladi.
2. **Rust + Rapier + WebAssembly Fizika**:
   - Fizika va to‘qnashuv modullari `web/src/game/physics/` ichida rendering va React’dan to‘liq ajratilgan. Kelajakda WASM fizika adapteri `CarPhysics` interfeysini buzmasdan ulanadi.
