# 3.1-ETAP — NEON CIRCUIT: ISHLAYDIGAN LOKAL POYGA HISOBOTI

Ushbu hujjat **Neon Race** loyihasining `3.1-etap` (`feature/neon-circuit` branch) doirasida amalga oshirilgan **Poyga — Neon Circuit** lokal poyga rejimining arxitekturasi, geometrik va fizik yechimlari hamda tekshiruv natijalarini bayon qiladi.

---

## 1. Umumiy arxitektura va modullar ajratilishi

O‘yin mantig‘i (sof TypeScript hisob-kitob modullari), Three.js 3D sahna ob’ektlari va React UI komponentlari bir-biridan qat’iy ajratilgan:

- **`web/src/game/race/trackDefinition.ts`**:
  - Trassa markaziy chizig‘i (`Catmull-Rom` yopiq splayn, `280` ta teng masofali diskret nuqta), umumiy uzunligi **`~759.6 m`**, yo‘l kengligi **`14.0 m`** (`halfWidth = 7.0 m`).
  - Yagona haqiqiy manba (`Single Source of Truth`): asfalt, bordyur, beton/neon to‘siq segmentlari (`BarrierSegment`), start/finish darvozasi, `10` ta checkpoint darvozasi, `4` ta boost pad va xavfsiz respawn nuqtalari aynan shu ta’rifdan hosil qilinadi.
- **`web/src/game/race/checkpointSystem.ts`**:
  - Chekli kenglikdagi (`finite-width`) darvoza kesmasi (`A -> B`) va avtomobil harakat kesmasi (`P0(prevX, prevY) -> P1(x, y)`) kesishishiga asoslangan deterministik tekshiruv.
  - Bitta fizika qadamida ikki darvozadan o‘tilganda kesishish parametrining o‘sish tartibi (`t in [0, 1]`) bo‘yicha ketma-ket qayta ishlaydi.
  - Yo‘l koridoridan tashqarida o‘tishni, teskari yo‘nalishda (`dot <= 0`) kesib o‘tishni va darvoza chizig‘ida old-orqaga tebranishni (`oscillation`) rad etadi.
  - Teskari haydashni (`isWrongWay`) `0.65 s` davomida `forwardDot < -0.35` va tezlik `> 2.5 m/s` bo‘lganda aniqlaydi.
- **`web/src/game/race/boostSystem.ts`**:
  - 1 slotli boost zaxirasi: `empty` (`BO‘SH`), `ready` (`TAYYOR`), `active` (`FAOLLASHGAN`).
  - Segment-doira kesishishi (`segmentCircleMinDistSq`) orqali yuqori tezlikda ham boost pad’ni o‘tkazib yubormasdan ushlaydi.
  - Slot `ready` yoki `active` bo‘lganda boshqa pad ustidan o‘tilsa, u pad behuda sarflanmaydi.
  - Har yangi aylana boshlanganda (`onNewLap()`) barcha `4` ta boost pad qayta tiklanadi.
- **`web/src/game/race/raceSession.ts`**:
  - Poyga holat mashinasi (`ready` → `countdown` → `racing` ↔ `paused` → `finished`).
  - `120 Hz` qat’iy fizika qadami (`STEP = 1 / 120 s`) asosida ishlovchi `rawTotalTime`, `currentLapTime`, `penaltyTime`, `lapTimes`, `bestLapTime` va `finalTime`.
- **`web/src/game/world/neonCircuit.ts`**:
  - Kechki sanoat hududi 3D sahnasi: nam asfalt, qizil-oq va cyan-to‘q-ko‘k bordyurlar, neon chiziqli beton devorlar, start/finish gantry arkasi (svetofor bilan), sanoat neon tunneli (`s = 470..600 m`, `balandligi = 7.5 m`), `InstancedMesh` yuk konteynerlari, omborxonalar, burilish chevron belgilari, checkpoint ustunlari va aylanuvchi boost halqalari.
  - Barcha geometriya, material va teksturalar `ResourceTracker` orqali ro‘yxatga olingan (`dispose()` da 0 qoldiq).
- **React UI komponentlari**:
  - `web/src/components/ModeSelect.tsx` va `web/src/components/StartScreen.tsx`: Asosiy menyuda **`Poyga — Neon Circuit`** va **`Poligon`** rejimlarini tanlash.
  - `web/src/components/race/RaceHud.tsx`: `AYLANA 1/3`, `CHECKPOINT X/10`, vaqtlar, `BOOST` indikatori, tezlik, kuzov holati, countdown va ogohlantirish bannerlari.
  - `web/src/components/race/RaceResults.tsx`: 3-aylana tugaganda ochiladigan yakuniy natijalar oynasi (`Qayta poyga` va `Menyuga qaytish`).

---

## 2. Fizika va kolliziya integratsiyasi

- **`CarPhysics.step` (`web/src/game/physics/carPhysics.ts`)**:
  - `GameInput` ga ixtiyoriy `boostAccel` va `boostMaxSpeed` maydonlari qo‘shildi (standart qiymati `0`, shuning uchun `Poligon` rejimida fizika bitma-bit o‘zgarishsiz qoladi).
  - `boostAccel > 0` bo‘lganda va tormoz/qo‘l tormozi bosilmaganda shassi bo‘ylama tezlanishiga (`ax`) qo‘shimcha tezlanish (`+6.0 m/s²`, `2.0 s` davomida, `maxBoostSpeed = 60.0 m/s` cheklovi bilan) qo‘shiladi.
- **Uzluksiz devor kolliziyasi (`web/src/game/physics/collisions.ts`)**:
  - Egri trassa devorlari uchun `collideBarrierSegments` funksiyasi qo‘shildi. Avtomobilning 4 ta burchagi va 2 ta yon o‘rta nuqtasi trassaning chap/o‘ng `BarrierSegment` kesmalariga nisbatan tekshiriladi; burchakli urilishda sirpanish (`sliding`) va energiya so‘nishi mavjud `applyImpulse` va `damage` tizimi bilan to‘liq ishlaydi.

---

## 3. Adolatli poyga va tugmalar siyosati

| Tugma | `Poyga — Neon Circuit` rejimida | `Poligon` rejimida |
|---|---|---|
| `W / A / S / D`, `Arrows`, `Space` | Ishlaydi (`countdown` va `finished` da bloklanadi) | Ishlaydi |
| `E` / Touch `BOOST` | Boost `TAYYOR` bo‘lganda `2.0 s` ga faollashtiradi | O‘chirilgan |
| `R` | Oxirgi checkpoint’ga qaytaradi + ta’mirlaydi + **`+5s` jarima** | Boshlang‘ich nuqtaga bepul `Reset` |
| `C` | Haydash kameralari (`0..3`: `Chase`, `Far chase`, `Hood`, `Orbit`) | Barcha kameralar (`0..4`, `Inspect` bilan) |
| `F` (`Repair`), `V` (`Crash Test`), `Y` (`Slow-Mo`), `I` (`Inspect`), `N` (`Day/Night`) | **Bloklangan** (adolatli poyga uchun) | To‘liq ishlaydi |
| `Escape` | Poyga, countdown va boost taymerlarini pauza qiladi / davom ettiradi | Pauza / davom ettirish |

---

## 4. Testlar va sifat nazorati

- **Unit va Integratsiya testlari (`web/tests/race.test.ts`, `physics.test.ts`, `engine.test.ts`, `backend/tests/server.test.ts`)**:
  - Jami **52 ta** unit/integratsiya/server testi (`41` ta web + `11` ta backend), jumladan `race.test.ts` ichidagi 13 ta stsenariy (countdown lock, start/finish initial crossing, sequential checkpoints, single-step multi-gate `t` ordering, reverse/skip/oscillation rejection, 3-lap completion & timer freeze, boost pickup/inventory/lap-restore, 2.0s boost speed/distance gain, brake/handbrake boost cancellation, `KeyR` respawn `+5s` penalty & segment rebase, Race vs Poligon hotkey policy, 30/60/144 FPS determinism, va haqiqiy fizika orqali 3 aylanalik avtopilot poygasi).
- **Real Browser E2E testlari (`web/tests/e2e.test.ts`)**:
  - Jami **4 ta** yirik Chromium + WebGL E2E sinovi (`E2E 1` offline Poligon oqimi, `E2E 2` klaviatura/fokus ajratilishi, `E2E 3` React `StrictMode` 5× mount/crash/unmount resurs va AudioContext tozaligi, `E2E 4` Stage 3.1 `Neon Circuit` to‘liq 3 aylanalik poyga oqimi va mobil viewport tekshiruvlari).
