# AUDIT_FIXES.md — Neon Race V3 Audit Topilmalari va Tuzatishlar Hisoboti

Ushbu hujjat `D:\neon-race` monorepo loyihasida o‘tkazilgan texnik audit topilmalari, ularning ildiz sabablari, kiritilgan minimal va xavfsiz tuzatishlar hamda tekshiruv usullarini bayon qiladi.

---

## 1. P1 — Resurslarni To‘liq va Xavfsiz Tozalash (`GameEngine.dispose()`)

### Muammolar va Ildiz Sabablar
1. **Faqat `Mesh` obyektlarini yig‘ish**: `GameEngine.cleanupInternal()` sahnadagi resurslarni `isMeshObject(obj)` orqali yig‘gan. Natijada `THREE.Points` (`Smoke`, `ExhaustSmoke`), `THREE.LineSegments` (`CrashParticles`, oyna/fara darzlari) va `THREE.Sprite` (yon gabarit chiroqlari) materiallari hamda geometriya/teksturalari to‘liq qamrab olinmagan.
2. **Material tekstura map’lari va `ShaderMaterial` uniform teksturalari**: Material ichidagi barcha tekstura map xususiyatlari (`map`, `roughnessMap`, `emissiveMap` va b.) hamda `ShaderMaterial.uniforms` ichidagi teksturalar (`Smoke.mat.uniforms.map.value`) tizimli ravishda treking qilinmagan.
3. **PMREM `WebGLRenderTarget` egaligi**: `pmrem.fromScene(...)` qaytargan `WebGLRenderTarget` obyektining faqat `.texture` qismi saqlanib, render target’ning o‘zi alohida `dispose()` qilinmagan. Shuningdek, Three.js `r128` ichidagi `PMREMGenerator` `scene.background === null` bo‘lganda o‘zining modul-ichki `backgroundBox` geometriyasini chizib, `renderer.info.memory.geometries` hisoblagichida `1` ta geometriya qoldirgan.
4. **Three.js `r128` `Sprite` umumiy geometriyasi**: Default `new THREE.Sprite()` global umumiy `_geometry` obyektini ulashadi. Uni ko‘r-ko‘rona `dispose()` qilish boshqa `Sprite`’larga ta’sir qilishi, umuman tozalamaslik esa `renderer.info.memory.geometries` hisoblagichida qolib ketishiga olib kelgan.
5. **`window.carLab` closure va global token egaligi**: `window.carLab` obyektiga egalik tokeni tekshirilmasdan yozilgan va o‘chirilgan; eski engine `dispose()` bo‘lganda yangi engine’ning `window.carLab` obyektini o‘chirib yuborishi yoki closure orqali eski engine’ni xotirada ushlab qolishi mumkin bo‘lgan.
6. **Xatoga chidamlilik (`try/finally` / error-resilient cleanup) va og‘ir havolalar**: Bitta resursning `dispose()` metodida xato chiqsa, qolgan tozalash bosqichlari to‘xtab qolishi mumkin edi; `car`, `world`, `smoke` kabi og‘ir maydonlar `null` qilinmagan.

### Kiritilgan Tuzatishlar
- **`web/src/game/rendering/resourceTracker.ts` (`ResourceTracker`)**:
  - `Mesh`, `InstancedMesh`, `Points`, `Line`, `LineSegments`, `Sprite`, material massivlari, barcha standart tekstura map’lari va `ShaderMaterial.uniforms` ichidagi teksturalarni `Set` asosida yagona marta ro‘yxatga oladi va `dispose()` qiladi.
  - Default `THREE.Sprite` umumiy geometriyasini avtomatik `markExternal()` qiladi va hech qachon buzmaydi; `GameEngine.init()` esa avtomobilning 4 ta `Sprite` chirog‘iga engine-ga xos klonlangan geometriya (`ownsGeometry = true`) biriktiradi.
  - `trackRenderTarget(rt)` PMREM `WebGLRenderTarget` obyektini ro‘yxatga oladi va uning ichki `.texture` obyektini ikki marta `dispose()` qilishdan himoyalaydi.
  - Har bir resursning `dispose()` chaqiruvi `try/catch` orqali bajariladi: bitta resurs xato otsayam, qolgan barcha resurslar tozalanib bo‘lgach xato qayta ko‘tariladi.
- **`web/src/game/GameEngine.ts`**:
  - `init()` davomida sahnadan uziladigan konus va kuzov qismlari (`instanceCones`, `mergeRigidMeshes`, `optimizeCarMeshes`, `BreakawayParts`) oldindan va `cleanupInternal()` ichida `this.resources.captureTree(...)` orqali qamrab olinadi.
  - `carLabToken` orqali `window.carLab` faqat joriy engine’ga tegishli bo‘lsagina o‘chiriladi (`if (window.carLab === this.carLabToken) delete window.carLab`).
  - `cleanupInternal()` barcha bosqichlarni (`RAF`, `toastTimer`, `input.detach()`, `cameraCtrl.detach()`, `audio.dispose()`, `resizeObserver.disconnect()`, DOM listenerlar, `resources.dispose()`, `scene.clear()`, `renderer.dispose()`) alohida `safeRun` bloklarida bajaradi va barcha og‘ir havolalarni (`car`, `world`, `smoke`, `engineVapor`, `exhaust`, `skids`, `parts`, `damage`, `crashParticles`, `glassShards`, `metalShards`, `quality`, `envs`, `envTargets`) `null` qiladi.
- **`web/src/game/audio/soundEngine.ts` va `web/src/game/camera/cameraController.ts`**:
  - `SoundEngine.dispose()` barcha oscillator va node’larni xavfsiz to‘xtatib uzadi, `ctx.close()` promise’ini `waitForClose()` orqali кузатиш imkonini beradi.
  - `CameraController.detach()` aktiv drag va pointer capture (`releasePointerCapture`) holatini to‘liq yakunlaydi hamda `lostpointercapture` hodisasini tinglaydi.

---

## 2. P1 — Klaviatura, UI Fokus va Canvas Fokusini Ajratish

### Muammolar va Ildiz Sabablar
1. **Tor `isInteractiveTarget` tekshiruvi**: Oldingi `isInteractiveTarget` faqat `target.tagName === 'BUTTON'` yoki `INPUT`/`SELECT`/`TEXTAREA` ni tekshirgan. `<button>` ichidagi `<kbd>`, `<span>`, `<svg>` bosilganda yoki fokus `<button>` da turganda `Space` bosilsa, o‘yin qo‘l tormozini (`hb = 1`) yoqib yuborgan va `preventDefault()` tufayli tugmaning standart klaviatura faollashuvini buzgan.
2. **Majburiy `.blur()`**: `GameToolbar.tsx` tugma bosilganda `e.currentTarget.blur()` chaqirib, klaviatura (`Tab`) foydalanuvchisining fokusini majburan yo‘qotgan.
3. **Yopishib qoladigan tugmalar (`Stuck keys`)**: Haydash tugmasi (`W`) bosib turilganda fokus `<button>` yoki `<input>` ga o‘tsa (`focusin`), oynadan chiqilsa (`blur`) yoki sahifa yashirilsa (`visibilitychange`), tugma holati (`up = 1`) osilib qolgan.
4. **Canvas fokusining yo‘qligi**: `#gl` canvas elementida `tabIndex={0}` bo‘lmagani sababli Start (`#go`) bosilganda yoki canvas’ga klik qilinganda fokus canvas’ga o‘tmagan.

### Kiritilgan Tuzatishlar
- **`web/src/game/input/inputController.ts`**:
  - `isInteractiveTarget(target, activeElement)` endi `Element.closest()` va ota elementlar zanjiri orqali `button, input, textarea, select, option, dialog, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="switch"], [role="tab"], [contenteditable=""], [contenteditable="true"]` elementlarini hamda `document.activeElement` ni tekshiradi.
  - Fokus interaktiv UI elementda bo‘lganda `keydown`/`keyup` o‘yin boshqaruvini (`Space`, `WASD`, hotkey’lar) ishga tushirmaydi va `preventDefault()` chaqirmaydi (`Space`/`Enter` tugmani tabiiy faollashtiradi).
  - `window.focusin` (interaktiv elementga fokus o‘tganda), `window.blur` va `document.visibilitychange` (`document.hidden`) hodisalarida `releaseAllInputs()` barcha bosib turilgan tugmalarni darhol `0` ga tushiradi.
- **`web/src/components/GameToolbar.tsx`, `StartScreen.tsx`, `TouchControls.tsx`, `GameEngine.ts`**:
  - `GameToolbar.tsx` ichidagi majburiy `.blur()` olib tashlandi; `:focus-visible` uslubi `game.css` ga qo‘shildi.
  - `#gl` canvas `tabIndex = 0` oldi; `#go` (Start) tugmasi bosilganda va `#gl` canvas’ga `pointerdown` qilinganda `focusCanvas()` fokusni `#gl` ga o‘tkazadi.
  - `TouchControls.tsx` da `onPointerCancel` va `onLostPointerCapture` qo‘shildi.

---

## 3. P2 — Hujjatlar va Node.js Versiya Mosligi

### Muammolar va Ildiz Sabablar
- `README_UZ.md` da bir nechta tugmalar (`X` vs `V`, `H` vs `B`, `P` vs `Esc`, `Z` vs `Y` `0.25×`) va `localStorage` kalitlari koddan farq qilgan.
- `package.json` da `"engines": { "node": ">=22.0.0" }` yozilgan bo‘lsa-da, `node --test tests/*.test.ts` Node 22 da `--experimental-strip-types` bayrog‘isiz ishlamaydi (Node 24 da esa bevosita ishlaydi).

### Kiritilgan Tuzatishlar
- Root `package.json`, `web/package.json` va `backend/package.json` fayllarida `"engines": { "node": ">=24.0.0", "npm": ">=11.0.0" }` bir xil qilib belgilandi.
- `README_UZ.md` va `MIGRATION.md` haqiqiy kod konstantalari (`5` oldinga uzatma + `R`, `5` kamera, `8` bo‘yoq rangi, barcha hotkey’lar va `7` ta `localStorage` kaliti) bilan 100% moslashtirildi.

---

## 4. P1/P2 — Haqiqiy Xulq-atvor va Real Browser E2E Testlari

- **`web/tests/engine.test.ts`**:
  - Headless unit testlar haqiqiy vazifasiga mos nomlandi (`Headless GameEngine ...`).
  - `ResourceTracker` (`Mesh`, `InstancedMesh`, `Points`, `LineSegments`, `Sprite`, texture maps, shader uniform textures, shared `Sprite` geometry himoyasi), PMREM `WebGLRenderTarget` (`texture` ikki marta `dispose()` bo‘lmasligi va xatoga chidamlilik), `window.carLab` token egaligi va `InputController` fokus ajratish uchun alohida unit testlar qo‘shildi.
- **`backend/tests/server.test.ts`**:
  - Test boshlanishida (`before()`) har doim `web/dist` tozalanib, `viteBuild` orqali joriy manbadan yangidan yig‘iladi.
  - Faqat `index.html` emas, balki build ichidagi barcha `.html`, `.css` va `.js` fayllar o‘qilib, tashqi `http://`, `https://`, `//`, `ws://`, `wss://` havolalar va CDN manzillar yo‘qligi tekshiriladi.
- **`web/tests/e2e.test.ts`**:
  - Playwright + lokal Chromium (`--use-angle=swiftshader --enable-webgl`) yordamida 3 ta haqiqiy browser E2E testi qo‘shildi:
    1. **E2E 1 — Offline va Render**: Tashqi tarmoq bloklangan holda sahifa yuklanishi, `#gl`, `#cluster`, `#gmeter` canvas’lari, WebGL draw call’lar, haydash va Crash Test (`V`) hamda desktop/mobil skrinshotlar.
    2. **E2E 2 — Fokus va Klaviatura (6 ta ssenariy)**: Toolbar `<button>` da `Space` va `Enter`, `#gl` canvas’da `Space` qo‘l tormozi, `<input>` ichida `W` yozish, `W` bosib turilganda fokus `<button>` ga o‘tishi (`stuck key` bo‘lmasligi), `#go` Start bosilganda fokus `#gl` ga o‘tishi.
    3. **E2E 3 — 5× `<StrictMode>` Lifecycle va GPU Cleanup**: 5 marta `<StrictMode><GameViewport /></StrictMode>` mount → start → Crash Test → unmount sikli; har sikl yakunida `glCanvasCount === 0`, `window.carLab === undefined`, `engine.isDisposed() === true`, `renderer.info.memory.geometries === 0`, `renderer.info.memory.textures === 0`, `activeRafs === 0` va `AudioContext.state === 'closed'`.

---

## 5. Qolgan Cheklovlar

- Vite production build vaqtida Three.js (`r128`) kutubxonasi bitta asosiy bundle ichida yig‘ilgani sababli JS chunk hajmi `~846 kB` (`gzip ~237 kB`). Bu lokal va offline ishlash uchun maqbul bo‘lib, o‘yin funksionalligiga ta’sir qilmaydi.
- Headless Chromium muhitida WebGL SwiftShader dasturiy rasterizatori orqali tekshiriladi; haqiqiy diskret/integratsiyalashgan GPU’da FPS va sifat profili (`AdaptiveQuality`) yanada yuqori ishlaydi.

---

## 6. Tekshirish Buyruqlari

```powershell
npm run typecheck
npm run lint
npm run build
npm test
npm run test:e2e
npm run verify
```
