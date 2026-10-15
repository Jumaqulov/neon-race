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
├── STAGE_3_1.md          # 3.1-etap: Neon Circuit lokal poyga arxitekturasi va hisoboti
├── web/                  # React + TypeScript + Vite + Three.js (r128) frontend
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   │   └── race/     # RaceHud, RaceResults, ModeSelect
│   │   ├── game/
│   │   │   ├── race/     # trackDefinition, checkpointSystem, boostSystem, raceSession
│   │   │   └── world/    # provingGround, neonCircuit, worldBuilder
│   │   ├── shared/
│   │   ├── storage/
│   │   └── styles/
│   └── tests/
│       ├── physics.test.ts
│       ├── engine.test.ts
│       ├── race.test.ts
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

## 4. O‘yin rejimlari (`Poyga — Neon Circuit` va `Poligon`)

Ilova ishga tushganda asosiy menyuda ikki rejimdan birini tanlash mumkin:

1. **Poyga — Neon Circuit (`neon_circuit`)**:
   - Kechki sanoat hududidagi ~760 m yopiq halqa trassa (`yo‘l kengligi = 14 m`), neon sanoat tunneli (`balandligi = 7.5 m`), start/finish arkasi, konteynerlar va omborxonalar.
   - **Oqim**: `Ready` (`Poygani boshlash`) → `3–2–1–BOSHLANDI!` countdown → **3 aylana** × **10 ta ketma-ket checkpoint** → `RaceResults` yakuniy natijalar oynasi (`Qayta poyga` / `Menyuga qaytish`).
   - **Boost tizimi**: Trassada 4 ta neon boost pickup pad mavjud. Pad ustidan o‘tganda 1 slotli boost zaxirasi `TAYYOR` holatiga o‘tadi. `E` (yoki mobil ekranda `BOOST`) bosilganda `2.0 s` davomida `+6.0 m/s²` qo‘shimcha tezlanish beradi (`maxBoostSpeed = 60.0 m/s`). Boost pad’lar har yangi aylanada qayta tiklanadi.
   - **Trassaga qaytarish (`R`)**: Mashinani oxirgi o‘tilgan checkpoint’ga qaytaradi, shikastlanishni ta’mirlaydi, umumiy vaqtga **`+5.0 s` jarima** qo‘shadi va joriy boost’ni tozalaydi.
   - **Adolatli poyga siyosati**: Poyga rejimida Poligon sinov tugmalari (`F` bepul ta’mirlash, `V` 80 km/h crash test, `Y` slow-motion, `I` inspect kamera va `N` kun/tun) bloklangan.

2. **Poligon — Erkin haydash va avtomobil sinovi (`proving_ground`)**:
   - Barcha asl V3 imkoniyatlari: konusli slalom, drift hisoblagich, `V` (`80 km/h` crash test), `F` (`Repair`), `I` (`Inspect` kamera), `Y` (`0.25×` slow-motion) va to‘liq fizika telemetriyasi.

---

## 5. Klaviatura, Sichqoncha, Touch va Gamepad boshqaruvi

Barcha tugmalar `web/src/game/GameEngine.ts`, `web/src/game/input/inputController.ts` va `web/src/components/` dagi haqiqiy kodga to‘liq mos:

- **Harakat**:
  - `W` / `ArrowUp`: Gaz (Throttle)
  - `S` / `ArrowDown`: Tormoz / Orqaga yurish (Brake / Reverse)
  - `A` / `D` yoki `ArrowLeft` / `ArrowRight`: Rul boshqaruvi (Steer Left / Right)
  - `Space`: Qo‘l tormozi (Handbrake) — faqat fokus canvas/body’da bo‘lganda ishlaydi; fokus toolbar tugmasida bo‘lsa, tugmaning standart `Space`/`Enter` bosilishini buzmaydi.
  - `E`: **Boost** faollashtirish *(faqat `Poyga — Neon Circuit` rejimida, boost yig‘ilganda)*
- **Kamera va ko‘rish (5 ta kamera: `Chase`, `Far chase`, `Hood`, `Orbit`, `Inspect`)**:
  - `C`: Kamerani navbat bilan almashtirish (`Poligon`da `0..4`, `Poyga`da `0..3` haydash kameralari)
  - `I`: Inspect (`cam = 4`) erkin orbita rejimiga o‘tish yoki undan chiqish *(faqat `Poligon` rejimida)*
- **Yoritish va chiroqlar**:
  - `L`: Old faralar (Headlights)
  - `O`: Yon gabarit chiroqlari (Side marker lights)
  - `Z`: Chap burilish ko‘rsatkichi (Left indicator)
  - `X`: O‘ng burilish ko‘rsatkichi (Right indicator)
  - `B`: Avariya chiroqlari (Hazards)
  - `N`: Kun / Tun mavzusi (Day / Night — *faqat `Poligon` rejimida; `Neon Circuit` kechki rejimda ishlaydi*)
- **Shikastlanish, sinov va fizika**:
  - `V`: Crash Test — `80 km/h` devorga urilish sinovi *(faqat `Poligon` rejimida)*
  - `F`: Avtomobil kuzovi, oynalari, faralari va g‘ildiraklarini to‘liq ta’mirlash *(faqat `Poligon` rejimida)*
  - `R`: `Poligon`da boshlang‘ich nuqtaga qaytarish (`Reset`); `Poyga`da oxirgi checkpoint’ga qaytarish (`+5s` jarima bilan)
  - `T`: Traction Control (`TCS`) yoqish / o‘chirish
- **Grafika, rang, ovoz va vaqt**:
  - `P`: Kuzov bo‘yoq rangini almashtirish (8 ta rang)
  - `G`: Grafika sifatini almashtirish (`Auto` → `High` → `Medium` → `Low`)
  - `Q`: Dinamik soyalarni (`Shadows`) yoqish / o‘chirish
  - `Y`: Slow-Motion (`0.25×` sekinlashtirilgan fizika vaqti — *faqat `Poligon` rejimida*)
  - `M`: Ovozni yoqish / o‘chirish (`Mute / Unmute`)
  - `U`: Tezlik birligini almashtirish (`KM/H` ↔ `MPH`)
  - `H`: Yordam oynasini (`Help`) ochish / yopish
  - `Escape`: Pauza (`Pause` / `Resume`)
- **Uzatmalar qutisi (Transmission)**:
  - Avtomatik: 5 ta oldinga uzatma (`1`–`5`, nisbatlar `[2.95, 1.95, 1.42, 1.10, 0.87]`), `N` (neytral) va `R` (orqaga uzatma, `reverse: 3.1`, `final: 3.7`).
- **Sensorli ekran va Gamepad**:
  - Mobil / touch ekranlarda `TouchControls` paneli (`Poyga` rejimida qo‘shimcha `BOOST` tugmasi bilan) va standart HTML5 Gamepad API to‘liq ishlaydi.

---

## 6. Offline ishlash va `localStorage` kalitlari

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
