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
├── .gitignore            # Node, Vite dist va kelajakdagi Rust target/ uchun ignore qoidalari
├── START-LOCAL.cmd       # Windows'da lokal production serverni tez ishga tushirish
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
│       └── engine.test.ts
├── backend/              # Lokal server (kelajakda Rust + Tokio + Axum backend)
│   ├── package.json
│   ├── README.md
│   ├── src/
│   │   ├── index.mjs
│   │   └── index.d.mts
│   └── tests/
│       └── server.test.ts
└── original/             # Asl V3 HTML zaxira nusxasi
    └── muscle-car-v3.html
```

---

## 2. Talab qilinadigan muhit

- **Operatsion tizim**: Windows 10/11 (PowerShell)
- **Node.js**: `>=22` (joriy muhitda `v24.11.1` sinovdan o‘tgan)
- **npm**: `11.x` (`11.6.2`)
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

### Testlar, Typecheck va Lint
```powershell
npm test
npm run typecheck
npm run lint
```

---

## 4. Klaviatura, Sichqoncha, Touch va Gamepad boshqaruvi

- **Harakat**: `W` / `↑` (Gaz), `S` / `↓` (Tormoz / Orqaga), `A` / `D` yoki `←` / `→` (Rul), `Space` (Qo‘l tormozi)
- **Kamera va ko‘rish**: `C` (Kamera almashtirish), `I` (Inspect orbit rejimi), sichqoncha bilan surish va g‘ildirakcha orqali yaqinlashtirish (`zoom`), ikki marta bosish (`double-click` — kamerani markazlash)
- **Avtomobil tizimlari**: `L` (Faralar), `H` (Avariya chiroqlari), `T` (TCS), `M` (Ovoz yoqish/o‘chirish)
- **Shikastlanish va sinov**: `F` (Ta’mirlash), `R` (Reset), `X` (Crash Test — old tomonga kuchli zarba)
- **Vaqt va rejim**: `P` (Pauza), `Z` (Slow-Mo `0.28x`)
- **Sensorli ekran va Gamepad**: Touch tugmalari va standart Gamepad API to‘liq ishlaydi.

---

## 5. Offline ishlash va `localStorage` eslatmasi

- **100% Offline**: Barcha skriptlar, CSS va Three.js (`0.128.0`) lokal paketlangan, tashqi CDN ishlatilmaydi.
- **`localStorage` kalitlari**: `musclecar.paint`, `musclecar.tod`, `musclecar.cam`, `musclecar.tcs`, `musclecar.lights`, `musclecar.hazards`, `musclecar.muted`, `musclecar.quality`, `musclecar.inspect`, `musclecar.bestDrift`.
