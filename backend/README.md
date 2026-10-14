# Neon Race — Backend (`backend/`)

Ushbu papka loyihaning backend qismini o‘z ichiga oladi:

- **Hozirgi holat**: Lokal `http://127.0.0.1:4173` manzilida `web/dist/` production build fayllarini va `/health` endpointini qattiq xavfsizlik sarlavhalari (`CSP`, `X-Content-Type-Options`, path traversal himoyasi) bilan uzatuvchi Node.js server (`src/index.mjs`).
- **Kelajakdagi bosqich**: Rust + Tokio + Axum asosidagi multiplayer / lobby / WebSocket backend serveri aynan shu `backend/` papkasi ichida (`Cargo.toml`, `src/main.rs`) joylashadi.
