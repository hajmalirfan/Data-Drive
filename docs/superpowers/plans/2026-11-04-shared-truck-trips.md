# Shared Truck Trips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Farmers going to the same market at the same time share one truck and split its fare by the kg each loads.

**Architecture:** Two new tables (`shared_trips`, `shared_trip_members`) link ordinary bookings into a trip. A FastAPI-free service (`trip_pooling.py`) owns the fare split and trip rules; a new router exposes them; `bookings.py` gets three small hooks (shared create helper, status recalculation, location fan-out). The frontend adds a Shared Trips page, a checkbox on the Trucks booking form and chips on the two booking lists.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2, pytest + TestClient on in-memory SQLite; React 18 + Vite, axios `api` client, `t()` i18n.

**Spec:** `docs/superpowers/specs/2026-11-04-shared-truck-trips-design.md`

## Global Constraints

- Branch `feature/shared-truck-trips`, cut from `origin/main`. Do not merge PR #1's branch into it.
- No new Python or npm dependencies.
- Existing tables are not altered; new tables come from `Base.metadata.create_all`.
- Trip fare formula is the existing one: `truck.base_fare + market.distance_km * truck.price_per_km`, rounded to 2 decimals, fixed on the trip when it opens.
- Share = `trip_fare × member kg ÷ total kg of active member bookings`; shares sum exactly to the fare.
- "Active" = `requested`, `accepted`, `assigned`, `picked_up`, `in_transit`. "Started" = any member booking in `picked_up`, `in_transit` or `delivered`.
- `estimated_net_proceeds` is never changed by pooling.
- The open-trips list never contains names or phone numbers. Trip detail shows first names only.
- Datetimes are compared as naive UTC, as `bookings.py` does (`datetime.utcnow()`); convert aware inputs with `.astimezone(timezone.utc).replace(tzinfo=None)`.
- All UI text goes through `t('key', [args])` with English in `src/i18n/messages.js`; pages use `ui-page` → `ui-toolbar` → `ui-alert` → `ui-card`; money is shown with the page's existing `inr()` style helper ("Rs 1,800").
- Backend tests run from `agri-project/backend` with `DATABASE_URL=sqlite:// .venv/Scripts/python -m pytest -q`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Joining with exactly the kg left** must succeed (boundary), and one kg more must fail with "Only N kg is free on this trip". → Task 3, `test_join_boundary`.
2. **Pickup time sent with an Indian offset** (`2026-11-20T06:00:00+05:30`) must be stored and compared as UTC, so a trip is not wrongly "past pickup" or still joinable for 5.5 hours. → Task 3, `test_offset_pickup_time`.
3. **A farmer who cancelled can join the same trip again**: "already a member" must only count active member bookings. → Task 4, `test_rejoin_after_cancel`.
4. **The opener's booking is rejected** while another member is active: the trip stays open and the other member pays the full fare. → Task 4, `test_opener_rejected_trip_continues`.
5. **Joining with someone else's crop stock** returns 403 from the shared create helper, as plain booking does. → Task 3, `test_join_with_foreign_crop`.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/models/pooling.py` (new) | `SharedTrip`, `SharedTripMember` models |
| `backend/app/services/trip_pooling.py` (new) | Status sets, fare split, trip rules, recalculation, notifications |
| `backend/app/schemas/pooling.py` (new) | Request/response models for the router |
| `backend/app/routers/shared_trips.py` (new) | `/api/shared-trips` endpoints |
| `backend/app/routers/bookings.py` (modify) | `_create_booking` helper, status hooks, location fan-out, trip fields in `booking_out` |
| `backend/app/schemas/operations.py` (modify) | Three optional fields on `BookingOut` |
| `backend/app/main.py` (modify) | Register `pooling` models and the router |
| `backend/tests/test_trip_pooling.py` (new) | `split_fare` unit tests |
| `backend/tests/test_shared_trips_api.py` (new) | API tests |
| `frontend/src/services/sharedTripService.js` (new) | API calls |
| `frontend/src/pages/SharedTrips.jsx` + `.css` (new) | Shared Trips page |
| `frontend/src/pages/Trucks.jsx`, `Bookings.jsx`, `BookingRequests.jsx` (modify) | Checkbox; chips |
| `frontend/src/App.jsx`, `components/AppShell.jsx` (modify) | Route, menu entry, title |
| `frontend/src/i18n/messages.js`, `translations.js`, `.translation-cache/*` (modify) | Text |
| `README.md` (modify) | Feature section and API rows |

---

### Task 1: Models and fare split

**Files:**
- Create: `agri-project/backend/app/models/pooling.py`, `agri-project/backend/app/services/trip_pooling.py`
- Modify: `agri-project/backend/app/main.py:8` (add `pooling` to the models import)
- Test: `agri-project/backend/tests/test_trip_pooling.py`

**Interfaces:**
- Produces:
  - `SharedTrip` (`__tablename__ = "shared_trips"`): columns exactly as spec §3; relationships `truck`, `market`, `opener` (User), `members` (list of `SharedTripMember`, `cascade="all, delete-orphan"`, ordered by `SharedTripMember.id`).
  - `SharedTripMember` (`"shared_trip_members"`): columns as spec §3; relationships `trip` and `booking = relationship("Booking", backref=backref("trip_membership", uselist=False))`.
  - In `trip_pooling.py`: `ACTIVE_STATUSES: set[str]`, `STARTED_STATUSES: set[str]` (values in Global Constraints), and `split_fare(fare: float, loads: dict[int, float]) -> dict[int, float]`.

- [ ] **Step 1: Write the failing tests** in `tests/test_trip_pooling.py`:

```python
from app.services.trip_pooling import split_fare
import pytest

def test_single_member_pays_full_fare():
    assert split_fare(1800.0, {7: 300.0}) == {7: 1800.0}

def test_unequal_loads_split_by_kg():
    assert split_fare(1800.0, {1: 300.0, 2: 600.0}) == {1: 600.0, 2: 1200.0}

def test_rounding_sums_exactly_to_fare():
    shares = split_fare(1000.0, {1: 100.0, 2: 100.0, 3: 100.0})
    assert round(sum(shares.values()), 2) == 1000.0
    assert sorted(shares.values()) == [333.33, 333.33, 333.34]
    assert shares[1] == 333.34  # remainder to the largest load, lowest id on a tie

def test_no_members_no_shares():
    assert split_fare(1800.0, {}) == {}

@pytest.mark.parametrize("kg", [0.0, -5.0])
def test_non_positive_kg_rejected(kg):
    with pytest.raises(ValueError):
        split_fare(1800.0, {1: kg})

def test_pooling_tables_registered():
    from app.core.database import Base
    import app.models.pooling  # noqa: F401
    assert {"shared_trips", "shared_trip_members"} <= set(Base.metadata.tables)
```

- [ ] **Step 2: Run** `DATABASE_URL=sqlite:// .venv/Scripts/python -m pytest tests/test_trip_pooling.py -q` — expected: FAIL (`ModuleNotFoundError: app.services.trip_pooling`).
- [ ] **Step 3: Implement** the two models and `split_fare` (compute each share as `round(fare * kg / total, 2)`, then add `round(fare - sum, 2)` to the largest load, lowest id on a tie). Add `pooling` to the `from app.models import ...` line in `main.py`.
- [ ] **Step 4: Run** the same command — expected: 7 passed. Then the whole suite — expected: all pass.
- [ ] **Step 5: Commit** `git add` the four files; message "Add shared trip models and fare split".

---

### Task 2: Shared booking helper and trip fields on bookings

**Files:**
- Modify: `agri-project/backend/app/routers/bookings.py:23-33,62-108,171-259`, `agri-project/backend/app/schemas/operations.py:222-252`
- Test: `agri-project/backend/tests/test_shared_trips_api.py` (create; fixture lives here and is reused by Tasks 3–4)

**Interfaces:**
- Consumes: `ACTIVE_STATUSES` from Task 1 (bookings.py imports it from `trip_pooling` and drops its local copy).
- Produces:
  - `_create_booking(db: Session, user: User, data: BookingCreate) -> Booking` in `bookings.py`: every check and field of today's `create_booking`, plus the two notifications; it calls `db.flush()` but **not** `db.commit()`. `create_booking` becomes: call helper, commit, refresh, return `booking_out`.
  - `trip_fare_for(truck: Truck, market: Market) -> float` in `trip_pooling.py`; `_create_booking` uses it for `estimated_transport_cost`.
  - `BookingOut` optional fields: `shared_trip_id: int | None = None`, `shared_trip_member_count: int | None = None`, `shared_trip_fare: float | None = None`, filled by `booking_out` from `booking.trip_membership` (count = active member bookings).
  - Test fixture `client` (TestClient on a bare `FastAPI()` with `bookings.router` and, once it exists, `shared_trips.router`; in-memory SQLite with `StaticPool`; tables `users, markets, market_prices, crop_stocks, trucks, bookings, booking_location_points, notifications, shared_trips, shared_trip_members`). Seed: farmers `a@example.com` "Arun Kumar", `b@example.com` "Bala Murugan", `c@example.com` "Chitra Devi"; operator `op@example.com` (`truck_operator`); one market "Palani" `distance_km=50`; one truck `TN57AB1234` capacity and available 1000 kg, `base_fare=500`, `price_per_km=26`, status `available`, operator `op`. Trip fare is therefore **Rs 1,800**. Helpers: `auth(email, role) -> dict` (Bearer header via `create_access_token({"sub": email, "role": role})`), `client.Session` (the sessionmaker, for direct DB edits), and `PICKUP = (datetime.utcnow() + timedelta(days=1)).isoformat()`.

- [ ] **Step 1: Write the failing test** `test_plain_booking_unchanged`: farmer A `POST /api/bookings` (truck, market, 300 kg, pickup "Ayakudi bus stand", destination "Palani", `PICKUP`) → 201, `estimated_transport_cost == 1800.0`, `shared_trip_id is None`, and two notifications exist (operator + farmer).
- [ ] **Step 2: Run** `... pytest tests/test_shared_trips_api.py -q` — expected: FAIL on `shared_trip_id` (KeyError).
- [ ] **Step 3: Implement** the helper, `trip_fare_for`, the import of `ACTIVE_STATUSES`, the three `BookingOut` fields and their filling in `booking_out`.
- [ ] **Step 4: Run** the file, then the whole suite — expected: all pass.
- [ ] **Step 5: Commit** "Share booking creation and expose trip fields on bookings".

---

### Task 3: Shared trips API — open, list, quote, join, detail, close

**Files:**
- Create: `agri-project/backend/app/schemas/pooling.py`, `agri-project/backend/app/routers/shared_trips.py`
- Modify: `agri-project/backend/app/services/trip_pooling.py`, `agri-project/backend/app/main.py` (include router)
- Test: `agri-project/backend/tests/test_shared_trips_api.py`

**Interfaces:**
- Consumes: `_create_booking`, `booking_out` (Task 2), `split_fare`, `trip_fare_for`, models (Task 1).
- Produces, in `trip_pooling.py`:
  - `active_members(db, trip) -> list[Booking]`
  - `is_started(trip) -> bool`
  - `space_left_kg(trip) -> float` — `trip.truck.available_capacity_kg` minus kg of member bookings in `requested`
  - `is_joinable(trip, now: datetime) -> str | None` — reasons in order `closed`, `started`, `past_pickup`, `full`, `truck_unavailable`
  - `recalculate(db, trip, quiet_booking_id: int | None = None) -> None` — no-op when started; writes shares; notifies each member whose share changed except `quiet_booking_id`, title "Shared trip share updated", message `f"Your transport share for the trip to {market} is now Rs {new:,.0f} (was Rs {old:,.0f})."`, link `/shared-trips`; closes the trip when no active member is left
  - `close_trip(trip) -> None` — sets `status="closed"`, `closed_at=datetime.utcnow()` if open
  - `trip_for_booking(booking) -> SharedTrip | None`
  - `first_name(user) -> str` — first word of `full_name`, else the part of `email` before `@`
- Schemas in `schemas/pooling.py`: `SharedTripOpen(BookingCreate)` + `pickup_point: str = Field(min_length=2, max_length=255)`; `SharedTripJoin(quantity_kg: float = Field(gt=0), crop_id: int | None = None, notes: str = Field(default="", max_length=2000))`; `SharedTripSummary(id, market_id, market_name, pickup_point, pickup_at, truck_type, capacity_kg, kg_booked, kg_free, member_count, trip_fare, status, is_member: bool)`; `SharedTripQuote(share, alone, saving)`; `SharedTripMemberOut(booking_id, first_name, quantity_kg, status, share)`; `SharedTripDetail(SharedTripSummary)` + `opener_id: int`, `members: list[SharedTripMemberOut]`; `SharedTripOpened(trip: SharedTripDetail, booking: BookingOut)`.
- Router `/api/shared-trips`, endpoints and errors exactly as spec §4. Join builds a `BookingCreate` from the trip (truck, market, `pickup_location=trip.pickup_point`, `destination=market.name`, `pickup_at=trip.pickup_at`) and the request, calls `_create_booking`, adds the member, calls `recalculate(db, trip, quiet_booking_id=new.id)`, commits. Check order on join: trip exists (404) → user already has an **active** member booking on it (409) → `is_joinable` (409) → kg ≤ `space_left_kg` (400) → `_create_booking`'s own checks. A member whose booking was cancelled or rejected may join again. Reason text for 409: `closed` "This trip is closed to new members", `started` "This trip has already started", `past_pickup` "The pickup time for this trip has passed", `full` "This trip has no space left", `truck_unavailable` "This truck is not available".

- [ ] **Step 1: Write the failing tests:**
  - `test_open_and_list_hides_names`: A opens (300 kg, `pickup_point` "Ayakudi bus stand") → 201, `trip.trip_fare == 1800.0`, `trip.member_count == 1`; B's `GET /api/shared-trips` has one trip with `kg_free == 700.0`, `is_member is False`, and the response text contains neither "Arun" nor a phone field.
  - `test_quote_matches_split`: B quotes 600 → `{"share": 1200.0, "alone": 1800.0, "saving": 600.0}`; B joins 600 → booking `estimated_transport_cost == 1200.0`; A's booking now 600.0; A has a notification containing "now Rs 600 (was Rs 1,800)"; B has no "share updated" notification.
  - `test_join_boundary`: with A at 300 kg still `requested`, B joins 701 → 400 "Only 700 kg is free on this trip" (`f"Only {kg:g} kg is free on this trip"`); B joins 700 → 201; C joins 1 → 409 "This trip has no space left".
  - `test_already_member`: A joins A's own trip → 409 "You are already on this trip".
  - `test_closed_and_past_pickup`: A closes → 200 `status == "closed"`; B joins → 409 "closed to new members". New trip with `pickup_at` set to yesterday via `client.Session` → 409 "pickup time ... has passed"; neither appears in B's list.
  - `test_close_by_non_opener`: B closes A's trip → 403.
  - `test_detail_permissions`: after B joins, B's detail lists first names `["Arun", "Bala"]` with shares `[600.0, 1200.0]`; operator gets 200; C gets 403.
  - `test_mine_lists_my_trips`: after A closes, A's `GET ?mine=true` returns the closed trip; C's returns `[]`.
  - `test_offset_pickup_time`: open with `pickup_at` = (now UTC + 3 h) written with `+05:30` offset → still joinable; open with (now UTC − 1 h) in `+05:30` → join gives `past_pickup`.
  - `test_join_with_foreign_crop`: a crop stock owned by C; B joins with its id → 403.
- [ ] **Step 2: Run** the file — expected: new tests FAIL with 404 (router not mounted).
- [ ] **Step 3: Implement** the service functions, schemas and router; mount the router in `main.py` and in the test fixture.
- [ ] **Step 4: Run** the file, then the whole suite — expected: all pass.
- [ ] **Step 5: Commit** "Add shared trips API".

---

### Task 4: Booking status hooks and location fan-out

**Files:**
- Modify: `agri-project/backend/app/routers/bookings.py:262-350,375-428`
- Test: `agri-project/backend/tests/test_shared_trips_api.py`

**Interfaces:**
- Consumes: `trip_for_booking`, `recalculate`, `close_trip`, `STARTED_STATUSES` (Task 3).
- Produces: `_apply_location(db, booking: Booking, data: BookingLocationUpdate, now: datetime) -> None` in `bookings.py` — today's consent / fix / trail-trim / clear logic for one booking, used for the requested booking and then for every other member booking of its trip whose status is `picked_up` or `in_transit`.
- In `update_booking_status`, after `booking.status = new_status` and before commit: if the booking is in a trip, `cancelled`/`rejected` → `recalculate(db, trip, quiet_booking_id=booking.id)`; a status in `STARTED_STATUSES` → `close_trip(trip)`.

- [ ] **Step 1: Write the failing tests:**
  - `test_cancel_recalculates`: A opens 300, B joins 600; B cancels → A's cost back to 1800.0 and A is notified; trip still open.
  - `test_opener_rejected_trip_continues`: A opens 300, B joins 600; operator rejects A → trip open, B's cost 1800.0.
  - `test_last_member_leaving_closes_trip`: A opens, A cancels → trip `status == "closed"`.
  - `test_pickup_closes_and_freezes`: A opens 300, B joins 600; operator accepts both and marks A `picked_up` → trip `status == "closed"`; B (still `accepted`) cancels → 200, and A's cost stays 600.0.
  - `test_rejoin_after_cancel`: B joins, cancels, joins again → 201.
  - `test_location_reaches_all_members`: both accepted and `picked_up`; operator `PATCH /api/bookings/{A}/location` with `consent=true, lat=10.45, lng=77.52` → B's `GET /api/bookings/{B}/track` returns `sharing == true` and one point at (10.45, 77.52); operator stops sharing on A → B's track has `sharing == false`.
- [ ] **Step 2: Run** the file — expected: these FAIL (costs unchanged, B's track empty).
- [ ] **Step 3: Implement** the hooks and `_apply_location`.
- [ ] **Step 4: Run** the file, then the whole suite — expected: all pass.
- [ ] **Step 5: Commit** "Recalculate shared trips on status changes and share location with all members".

---

### Task 5: Shared Trips page

**Files:**
- Create: `agri-project/frontend/src/services/sharedTripService.js`, `agri-project/frontend/src/pages/SharedTrips.jsx`, `agri-project/frontend/src/pages/SharedTrips.css`
- Modify: `agri-project/frontend/src/App.jsx:65-72` (route in the `NON_ADMIN_ROLES` layout), `agri-project/frontend/src/components/AppShell.jsx:18-30,41-56` (NAV after `/trucks`: `{ to: '/shared-trips', label: 'nav.sharedTrips', icon: 'route', roles: ['farmer'] }`; TITLES `'/shared-trips': ['title.sharedTrips', 'subtitle.sharedTrips']`), `agri-project/frontend/src/i18n/messages.js`

**Interfaces:**
- Consumes: the API from Task 3.
- Produces (`sharedTripService.js`, each returns `r.data`): `getSharedTrips(params)`, `getTripQuote(id, quantityKg)`, `openSharedTrip(payload)`, `joinSharedTrip(id, payload)`, `closeSharedTrip(id)`, `getSharedTrip(id)`.
- Page sections as spec §5. The quote request fires 400 ms after the last keystroke and only for kg > 0; a 400 from quote shows its `detail` under the field. Join success: notice `sharedTrips.joined`, reload both lists. Crop select lists the farmer's own crop stocks via the existing `getCrops` in `operationsService.js`.
- New English keys (exact copy): `nav.sharedTrips` "Shared Trips"; `title.sharedTrips` "Shared Trips"; `subtitle.sharedTrips` "Share a truck to market and split the fare"; `sharedTrips.heading` "Share a truck to market"; `sharedTrips.sub` "Join a trip going your way. The fare is split by the kg each farmer loads."; `sharedTrips.open` "Open trips"; `sharedTrips.mine` "My shared trips"; `sharedTrips.none` "No open trips right now. Open one from the Trucks page."; `sharedTrips.farmers` "<0> farmers"; `sharedTrips.free` "<0> free of <1>"; `sharedTrips.fare` "Trip fare <0>"; `sharedTrips.pickup` "Pickup at <0>"; `sharedTrips.join` "Join trip"; `sharedTrips.kg` "Your quantity (kg)"; `sharedTrips.crop` "Crop stock (optional)"; `sharedTrips.quote` "Your transport ≈ <0> (alone <1>), you save <2>"; `sharedTrips.joined` "You joined the trip. The truck operator will confirm your booking."; `sharedTrips.close` "Close to new joiners"; `sharedTrips.closed` "Closed"; `sharedTrips.yourShare` "Your share <0>"; `sharedTrips.loadError` "Could not load shared trips. Try again."

- [ ] **Step 1: Implement** the service, page, CSS, route, menu entry, title and keys.
- [ ] **Step 2: Run** `npm run build` in `agri-project/frontend` — expected: "built in", no errors (the existing chunk-size warning is fine).
- [ ] **Step 3: Commit** "Add Shared Trips page".

---

### Task 6: Open a trip from Trucks; chips on booking lists

**Files:**
- Modify: `agri-project/frontend/src/pages/Trucks.jsx:145-180` and its Book form markup, `agri-project/frontend/src/pages/Bookings.jsx:251-275`, `agri-project/frontend/src/pages/BookingRequests.jsx:153-165`, `agri-project/frontend/src/i18n/messages.js`

**Interfaces:**
- Consumes: `openSharedTrip` (Task 5); `BookingOut.shared_trip_*` fields (Task 2).
- Book form state gains `share: false` and `pickup_point: ''` (pre-filled from `pickup_location` until the user edits it). When `share` is true, submit validates `pickup_point.trim()` (error key `trucks.errPickupPoint`) and calls `openSharedTrip({...the existing payload, pickup_point})`, then navigates to `/shared-trips`; otherwise unchanged.
- Chips: `Bookings.jsx` shows `bookings.sharedChip` with `[member_count, inr(estimated_transport_cost), inr(shared_trip_fare)]` in the booking card; `BookingRequests.jsx` shows `bookings.sharedChipOperator` with `[member_count]` under the farmer name. Both render only when `shared_trip_id` is set.
- New keys: `trucks.shareTrip` "Open this trip to share with other farmers"; `trucks.pickupPoint` "Shared pickup point"; `trucks.errPickupPoint` "Enter where other farmers should bring their crates."; `bookings.sharedChip` "Shared trip · <0> farmers · your share <1> of <2>"; `bookings.sharedChipOperator` "Shared trip · <0> farmers".

- [ ] **Step 1: Implement** the form change, both chips and keys.
- [ ] **Step 2: Run** `npm run build` — expected: success.
- [ ] **Step 3: Commit** "Open shared trips from the Trucks page and mark shared bookings".

---

### Task 7: Translations, docs and end-to-end check

**Files:**
- Modify: `agri-project/frontend/src/i18n/translations.js`, `agri-project/frontend/.translation-cache/*.json`, `README.md`

- [ ] **Step 1: Regenerate** with `node scripts/generate-translations.mjs` in `agri-project/frontend`. Check with a small script that every new key is translated in all nine languages, `<0>`-style placeholders match English, and that no existing key's translation changed versus `git show HEAD:agri-project/frontend/src/i18n/translations.js`; restore any changed one from HEAD into the cache and re-run.
- [ ] **Step 2: Update README**: a "Shared Truck Trips" section after Features (what it does, the fare rule, the 300 kg + 600 kg example giving Rs 600 and Rs 1,200 of Rs 1,800) and six rows in the API table for `/api/shared-trips`.
- [ ] **Step 3: Run** the whole backend suite and `npm run build` — expected: all pass, build succeeds.
- [ ] **Step 4: Browser check** on local SQLite (`smartag-api` and the web launch config), with throwaway accounts recorded nowhere in chat: operator registers truck (capacity 1000, base 500, Rs 26/km) and a 50 km market exists; farmer A books it with "Open this trip to share" and 300 kg; farmer B sees the trip on Shared Trips, the quote for 600 kg reads Rs 1,200 (alone Rs 1,800), joins; A's Bookings chip reads "your share Rs 600 of Rs 1,800"; operator sees both requests with "Shared trip · 2 farmers" and accepts both. No console errors; no horizontal scroll at 375 px.
- [ ] **Step 5: Commit** "Translate shared trips and document them".
