# Neon Race — V3 Monorepo (`web/` + `backend/`)

Ushbu repozitoriy **Muscle Car Proving Ground — V3** o‘yinining yagona monorepo tuzilmasi bo‘lib, frontend (`web/`) va backend (`backend/`) qismlarini bitta Git repozitoriy ichida birlashtiradi.

---

## 1. Loyiha tuzilmasi

```text
D:\neon-race/
├── package.json          # Monorepo asosiy skriptlari va npm workspaces (web, backend)
├── package-lock.json     # Yagona lockfile
├── tsconfig.json         # Umumiy TypeScript strict konfiguratsiyasi
├── eslint.config.mjs     # Umumiy ESLint konfiguratsiyasi
├── .gitignore            # Node, Vite dist, evidence/ va kelajakdagi Rust target/ uchun ignore qoidalari
├── START-LOCAL.cmd       # Windows'da lokal production serverni tez ishga tushirish
├── README_UZ.md          # O‘zbek tilidagi qo‘llanma
├── MIGRATION.md          # Arxitektura va modullar xaritasi
├── AUDIT_FIXES.md        # Audit topilmalari, ildiz sabablar va tuzatishlar hisoboti
├── web/                  # React + TypeScript + Vite + Three.js (r128) frontend
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── game/
│   │   ├── shared/
│   │   ├── storage/
│   │   └── styles/
│   └── tests/
│       ├── physics.test.ts
│       ├── engine.test.ts
│       └── e2e.test.ts
├── backend/              # Lokal server (kelajakda Rust + Tokio + Axum backend)
│   ├── package.json
│   ├── README.md
│   ├── src/
│   │   ├── index.mjs
│   │   └── index.d.mts
│   └── tests/
│       └── server.test.ts
└── original/             # Asl V3 HTML zaxira nusxasi (o‘zgartirilmagan)
    └── muscle-car-v3.html
```

---

## 2. Talab qilinadigan muhit

- **Operatsion tizim**: Windows 10/11 (PowerShell)
- **Node.js**: `>=24.0.0` (joriy muhitda `v24.11.1` sinovdan o‘tgan; `node --test` TypeScript test fayllarini qo‘shimcha eksperimental bayroqlarsiz bevosita bajarishi uchun Node 24+ talab etiladi)
- **npm**: `>=11.0.0` (`11.6.2`)
- **Brauzer**: WebGL va Web Audio API qo‘llab-quvvatlovchi zamonaviy brauzer (Chrome, Edge, Firefox)

---

## 3. O‘rnatish va ishga tushirish (`D:\neon-race` ildiz papkasidan)

Barcha buyruqlarni asosiy `D:\neon-race` papkasidan bajarishingiz mumkin:

### Paketlarni o‘rnatish
```powershell
npm install --ignore-scripts --no-audit --no-fund
```

### Development (ishlab chiqish) rejimida ishga tushirish (`web/`)
```powershell
npm run dev
```
- **Manzil**: `http://127.0.0.1:5173`
- Faqat lokal (`127.0.0.1`) interfeysga bog‘lanadi (`strictPort: true`).

### Production build yig‘ish (`web/dist/`)
```powershell
npm run build
```
- TypeScript qat’iy (`strict`) tekshiruvidan o‘tkazadi va `web/dist/` papkasiga statik bundle yig‘adi.

### Production build’ni lokal backend serverda ishga tushirish (`backend/`)
```powershell
npm start
```
- **Manzil**: `http://127.0.0.1:4173`
- **Health endpoint**: `http://127.0.0.1:4173/health`

### Testlar, E2E, Typecheck va Lint
```powershell
npm run typecheck
npm run lint
npm run build
npm test
npm run test:e2e
npm run verify
```

---

## 4. Klaviatura, Sichqoncha, Touch va Gamepad boshqaruvi

Barcha tugmalar `web/src/game/GameEngine.ts`, `web/src/game/input/inputController.ts` va `web/src/components/` dagi haqiqiy kodga to‘liq mos:

- **Harakat**:
  - `W` / `ArrowUp`: Gaz (Throttle)
  - `S` / `ArrowDown`: Tormoz / Orqaga yurish (Brake / Reverse)
  - `A` / `D` yoki `ArrowLeft` / `ArrowRight`: Rul boshqaruvi (Steer Left / Right)
  - `Space`: Qo‘l tormozi (Handbrake) — faqat fokus canvas/body’da bo‘lganda ishlaydi; fokus toolbar tugmasida bo‘lsa, tugmaning standart `Space`/`Enter` bosilishini buzmaydi.
- **Kamera va ko‘rish (5 ta kamera: `Chase`, `Far chase`, `Hood`, `Orbit`, `Inspect`)**:
  - `C`: Kamerani navbat bilan almashtirish (`0..4`)
  - `I`: Inspect (`cam = 4`) erkin orbita rejimiga o‘tish yoki undan chiqish (sichqoncha bilan surish, g‘ildirakcha bilan `zoom`, ikki marta bosish / `double-click` bilan kamerani markazlash)
- **Yoritish va chiroqlar**:
  - `L`: Old faralar (Headlights)
  - `O`: Yon gabarit chiroqlari (Side marker lights)
  - `Z`: Chap burilish ko‘rsatkichi (Left indicator)
  - `X`: O‘ng burilish ko‘rsatkichi (Right indicator)
  - `B`: Avariya chiroqlari (Hazards)
  - `N`: Kun / Tun mavzusi (Day / Night)
- **Shikastlanish, sinov va fizika**:
  - `V`: Crash Test — avtomobilning old qismiga sinov zarbasini berish (`speed: 19 m/s`)
  - `F`: Avtomobil kuzovi, oynalari, faralari va g‘ildiraklarini to‘liq ta’mirlash (`Repair`)
  - `R`: Avtomobil va konuslarni boshlang‘ich holatga qaytarish (`Reset`)
  - `T`: Traction Control (`TCS`) yoqish / o‘chirish
- **Grafika, rang, ovoz va vaqt**:
  - `P`: Kuzov bo‘yoq rangini almashtirish (8 ta rang: `Candy red`, `Grabber blue`, `Highland green`, `School-bus yellow`, `Competition orange`, `Plum crazy`, `Tuxedo black`, `Wimbledon white`)
  - `G`: Grafika sifatini almashtirish (`Auto` → `High` → `Medium` → `Low`)
  - `Q`: Dinamik soyalarni (`Shadows`) yoqish / o‘chirish
  - `Y`: Slow-Motion (`0.25×` sekinlashtirilgan fizika vaqti)
  - `M`: Ovozni yoqish / o‘chirish (`Mute / Unmute`)
  - `U`: Tezlik birligini almashtirish (`KM/H` ↔ `MPH`)
  - `H`: Yordam oynasini (`Help`) ochish / yopish
  - `Escape`: Pauza (`Pause` / `Resume`)
- **Uzatmalar qutisi (Transmission)**:
  - Avtomatik: 5 ta oldinga uzatma (`1`–`5`, nisbatlar `[3.10, 2.05, 1.43, 1.10, 0.88]`), `N` (neytral) va `R` (orqaga uzatma).
- **Sensorli ekran va Gamepad**:
  - Mobil / touch ekranlarda `TouchControls` paneli va standart HTML5 Gamepad API to‘liq ishlaydi.

---

## 5. Offline ishlash va `localStorage` kalitlari

- **100% Offline**: Barcha skriptlar, CSS va Three.js (`0.128.0`) lokal paketlangan, hech qanday tashqi CDN yoki tarmoq so‘rovlari ishlatilmaydi.
- **Haqiqiy `localStorage` kalitlari (`web/src/storage/settingsStore.ts`)**:
  - `musclecar.cam` — tanlangan kamera indeksi (`0..4`)
  - `musclecar.tcs` — Traction Control holati (`true` / `false`)
  - `musclecar.shadowsV3` — soyalar holati (`true` / `false`)
  - `musclecar.sound` — ovoz holati (`true` / `false`)
  - `musclecar.mph` — tezlik birligi (`true` = MPH, `false` = KM/H)
  - `musclecar.paint` — tanlangan bo‘yoq rangi (`number`, hex)
  - `musclecar.best` — eng yaxshi drift balli (`number`)
  - *(Izoh: `night`, `lights`, `markers` va `quality` qiymatlari joriy sessiya davomida `GameSettings` ichida saqlanadi, `localStorage` ga yozilmaydi).*
