# SmartAg Ops Advisor — Improvement Plan

Based on the documents in `docs/` (Master Document, MRD v3.2, PRD v4.2, Epics & Stories, Prompt Document, QA prompts) and a read of the code as of commit `165d5bb`.

## Where the project stands

| PRD delivery step | Status in code |
|---|---|
| S0 audit and data-mode decision | Partly done: one 173-row Tamil Nadu tomato CSV (24 Oct 2026); its unit and Dindigul coverage are not confirmed yet |
| S1 decision engine and tests | **Done**: `backend/app/services/decision_engine.py` (Decimal maths, 7 states, exclusion reasons), with tests AT-01 to AT-18 plus AT-09b in `backend/tests/test_decision_engine.py` |
| S2 API and guest token | **Missing**: no `POST /api/decision/compare` and no `POST /api/auth/guest`; the engine is only called from `scripts/decision_demo.py` |
| S3 Compare page, data badge, demo mode | **Missing**: no Compare page, no "Sample data" badge, no demo mode that hides the Master App routes |
| S4 README, test checklist, backup recording | **Missing**: the README covers the full app, not the demo path |

The main gap: the PRD's core product (the guest per-crate comparison) is built and tested as a library, but nothing calls it yet. Users can't see or use it. The QA prompt P5 calls this a **BLOCKER**.

Other gaps the docs themselves point out:
- No versioned DB migrations (`create_all` plus hand-written ALTERs in `main.py`, one path SQLite-only).
- No frontend test or lint script, and no CI.
- Secrets were pasted into chat (Gemini, Neon, Mailtrap, data.gov.in) and need rotating.
- The rate limiter is in memory, so each worker has its own limits.
- Newer UI messages exist only in English.
- Two briefs conflict: an old `CLAUDE.md` (guest-only app, endpoints `/api/options` and `/api/compare`) and the PRD (`/api/decision/compare`).

---

## Phase 1: Ship the PRD demo path (highest priority)

Goal: a guest can open the app, enter a batch, and see one of the 7 result states with the exact PRD messages.

1. **Settle the API contract.** Pick one endpoint name: PRD `POST /api/decision/compare` or QA-P5 `POST /api/compare` + `GET /api/options`. Update the QA prompt or the PRD so they match, and delete or update the stale `CLAUDE.md`.
2. **Data tables (PRD §6).** Add `regions`, a `type` and `enabled` on markets (`wholesale | uzhavar_sandhai | unknown`), `unit_conversions` (kg 1, quintal 100, tonne 1000, crate 14), `price_records` (unique on market+crop+date+variety+grade+source, with `is_sample`, `run_id`, `raw_ref`), and `ingestion_runs` (SUCCESS / EMPTY / ERROR). Keep these separate from the existing `mandi_prices` and `market_prices`.
3. **Seed script.** Load the 8-record PRD sample: Oddanchatram, Dindigul, Palani (rankable); Dindigul Uzhavar Sandhai; Vedasandur (different date); Batlagundu (stale); Nilakottai (unit unclear); Natham (invalid price). Optionally load the 24 Oct snapshot, but only after its unit and coverage are confirmed. Add a `data_mode` config value (`sample | snapshot`) and a `demo_as_of` date.
4. **Router `backend/app/routers/decision.py`.**
   - `GET` options returns the enabled crop–market pairs and the data badge.
   - `POST` compare does: Pydantic validation → load records through a source adapter → `decision_engine.compare()` → JSON with state, message, winner (null unless RANKED), lead, tie band, cards, exclusions, and costs not included.
   - A DB or network failure maps to `SOURCE_ERROR`; zero rows maps to `EMPTY`.
5. **Guest token.** `POST /api/auth/guest` issues a short-lived token scoped to the decision endpoints only, rate-limited, and storing no personal data.
6. **Compare page (`frontend/src/pages/Compare.jsx`).** One page in PRD order: data badge → inputs → decision box → Harvest Cover panel → market cards → excluded markets with reasons → assumptions strip.
   - Rupees in Indian digit grouping, rounded only for display.
   - Status in words, not colour alone.
   - Blank trip cost is not the same as zero: zero needs a "no cost" tick.
   - No horizontal scroll at 375 px.
7. **Demo mode.** A `VITE_DEMO_MODE` flag: `/` goes to Compare, Master App routes and nav are hidden, and the badge shows on every screen (AT-15). Make sure no hidden defaults (`TRANSPORT_RATE_PER_KM`, the 35 km/h ETA) reach the result.
8. **API tests.** Add router-level pytest tests (FastAPI `TestClient` on SQLite) that cover all 7 states and check `winner` is null outside RANKED. These cover QA P5 steps 0–4.

**Done when** (PRD definition of done): a stranger runs it from the README in under 5 minutes, every price shows source, date, unit and type, all 18 ATs pass, and no invalid data produces a winner.

## Phase 2: Engineering hygiene

1. **Alembic migrations.** Baseline the current schema, then move `migrate_schema()` and `migrate_user_vehicle_fields()` out of `main.py` into migrations. Remove the SQLite-only SQL path.
2. **CI (GitHub Actions)** on each push: `pytest`, `python -m compileall`, `npm ci && npm run build`, plus a secrets scan (gitleaks or `git grep` for keys, which QA P6 requires).
3. **Frontend quality.** Add `lint` (ESLint) and `test` (Vitest + React Testing Library) scripts. Start with the Compare page and `passwordPolicy.js`.
4. **Backend test coverage** beyond the engine: auth lockout, admin OTP, role and ownership checks, user removal (QA P2 cases a–h), reports summary (QA P3), document upload limits.
5. **Pin and tidy dependencies.** Add `google-genai` and any other imports `requirements.txt` misses. Split dev dependencies (`pytest`) into `requirements-dev.txt`.

## Phase 3: Security and operations

1. **Rotate every secret** listed in Prompt Document §7 (Gemini, Neon, Mailtrap, data.gov.in), update Render, and revoke the old ones. Change the default admin password.
2. **Shared rate limiter** (Redis, or a DB-backed limiter) before running more than one worker.
3. **Move uploaded documents** out of database blobs into object storage with signed URLs, or at least back them up encrypted.
4. **Render cold start.** Add a health-check ping or a paid instance before the demo, and record the cold-start time (QA P4).
5. **Add security headers on the frontend host** (Render static site headers config), matching `SECURITY.md`.

## Phase 4: Product improvements (after the demo, per MRD "Should" and "Later")

1. **Tamil UI (MR-12 / FR-17).** Externalise the Compare page strings, then get a native review before release. Regenerate `translations.js` so the English-only P26 and P28 messages are covered too.
2. **FR-18 Copy result as text**, so a farmer can share the result over WhatsApp, which they already use.
3. **FR-22 break-even line and FR-23 calculation log** ("show the working" for each card).
4. **Data coverage.** Switch to `MANDI_SOURCE=api` with a daily scheduled pull for Dindigul-district markets, and show "not reported" for markets with no data instead of hiding them.
5. **Merge the two price concepts carefully.** Use the decision engine's unit conversion in the Master App's market finder, so per-kg and per-quintal prices are never mixed (Master Doc §13).
6. **Pilot validation (MRD §6).** Interview 5 growers. Targets: 4 of 5 can explain the ranking, 3 of 5 would check the per-crate answer before paying for picking.
7. **Later (MR-13 / MR-14):** verified route ETA, alerts, and a native or PWA app for background GPS.

## Suggested order

Phase 1 steps 1→8 first: these are the demo blockers. Then Phase 3.1 (secret rotation; urgent and small). Then Phase 2, then the rest of Phase 3, then Phase 4.
