# Shared Truck Trips — Design

Date: 4 Nov 2026
Status: approved in conversation, awaiting review of this written spec
Branch: `feature/shared-truck-trips` (from `main`, separate from PR #1)

## 1. Purpose

Small growers often send a part load to market. Today a farmer who books a truck pays the whole trip fare (`base_fare + distance × price_per_km`) even when other farmers' crops ride on the same truck: the system already lets several bookings share one truck's capacity, but it charges each of them the full fare. Shared Truck Trips lets growers going to the same market at the same time share one truck and split its fare by the weight each of them loads.

Success looks like this in a demo: farmer A opens a trip for 300 kg, farmer B joins with 600 kg, and both see their transport cost fall (A pays one third of the fare, B two thirds) without the truck operator doing anything new beyond accepting the two bookings.

Decisions taken during design:

| Question | Decision |
|---|---|
| Who starts a shared trip | A farmer, when booking a truck ("Open this trip to share") |
| How the fare is split | By kg actually loaded, recalculated when anyone joins or leaves |
| Where the truck picks up | One shared pickup point named by the opener |
| How it is stored | Two new tables; existing tables unchanged |

Out of scope: pickups at several farms, operator-posted scheduled runs, automatic matching of requests, payments between farmers, a trip-level "mark all picked up" for operators.

## 2. How it works

**Opening.** On the Trucks page the existing Book form gets a checkbox, "Open this trip to share with other farmers", and a "Shared pickup point" field that defaults to the pickup location. Submitting with the box ticked creates the farmer's normal booking and a shared trip around it.

**Finding and joining.** A new Shared Trips page lists open trips: market, date and time, pickup point, number of farmers, kg free and the trip fare. Joining asks for kg and, optionally, one of the farmer's crop stocks, and shows a live quote ("Your transport ≈ Rs 450 (alone Rs 1,800), you save Rs 1,350"). Joining creates an ordinary booking on the same truck, market, pickup point and pickup time. The truck operator accepts or rejects each booking as today, so the existing capacity check on acceptance still applies.

**Fare split.** The trip fare is computed once, when the trip opens, with the existing formula and stored on the trip, so an operator changing their prices later does not move anyone's share. Each member pays `trip_fare × member kg ÷ total kg of active member bookings`. "Active" means the booking's status is in the existing `ACTIVE_STATUSES` (requested, accepted, assigned, picked_up, in_transit). The split is recalculated when a member joins, cancels or is rejected, and written to each member booking's `estimated_transport_cost`. Members whose share changed get a notification ("Your transport share for the trip to Palani is now Rs 600 (was Rs 1,800)"). A member never pays more than the full fare.

`estimated_net_proceeds` is not changed: it comes from the market comparison, which uses a generic per-km rate rather than this truck's fare, so adjusting it would mix two different cost bases. The saving is shown directly instead (alone vs shared).

**Closing.** A trip takes no new members once any of these is true: the opener closes it, the pickup time has passed, no space is left, or any member booking has reached picked_up. When the first member booking is picked up, the fare is split one last time over members whose bookings were accepted (a booking still requested can no longer be accepted, because the truck is on its trip); after that, shares freeze, so delivered bookings keep their final share. If the opener cancels, or the opener's account is deleted, the trip continues for the other members; when no active member is left, it closes.

**Privacy.** The list of open trips shows counts and kg only, never names or phone numbers. Trip detail, with each member's first name, kg and share, is visible to members, the truck's operator and admins.

**Live tracking.** Location sharing stays per booking. When the operator sends a location fix (or stops sharing) on a booking that belongs to a shared trip, the same update is applied to every member booking of that trip whose status is picked_up or in_transit, so each farmer's Tracking page works without extra steps for the driver.

## 3. Data

Two new tables (created by `Base.metadata.create_all` on existing databases; no `ALTER TABLE`):

`shared_trips`

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| truck_id | FK trucks.id, RESTRICT | |
| market_id | FK markets.id, RESTRICT | |
| opener_id | FK users.id, CASCADE | |
| pickup_point | String(255) | |
| pickup_at | DateTime(tz) | Same value as every member booking's `pickup_at` |
| trip_fare | Float | Fixed at opening |
| status | String(16) | `open` or `closed` |
| created_at | DateTime(tz) | server default now |
| closed_at | DateTime(tz), nullable | |

`shared_trip_members`

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| trip_id | FK shared_trips.id, CASCADE, indexed | |
| booking_id | FK bookings.id, CASCADE, unique | A booking is in at most one trip |
| joined_at | DateTime(tz) | server default now |

Models go in a new `app/models/pooling.py`, registered in the `app.models` import list in `main.py`.

## 4. Backend

**`app/services/trip_pooling.py`** (no FastAPI imports):

- `split_fare(fare: float, loads: dict[int, float]) -> dict[int, float]` — pure. Shares are rounded to 2 decimals; the rounding remainder is added to the largest load (lowest booking id on a tie) so shares sum exactly to `fare`. Empty `loads` returns `{}`. Non-positive kg is rejected with `ValueError`.
- `active_members(db, trip) -> list[Booking]`
- `space_left_kg(trip) -> float` — `truck.available_capacity_kg` minus the kg of member bookings still `requested` (accepted bookings are already subtracted from the truck by the existing accept logic).
- `is_joinable(trip, now) -> str | None` — returns the reason a trip cannot be joined (`closed`, `started`, `past_pickup` when `pickup_at <= now`, `full` when no kg is left, `truck_unavailable` when the truck's status is not `available`) or `None`. Checked in that order.
- `recalculate(db, trip)` — applies `split_fare` to active members, writes `estimated_transport_cost`, notifies members whose share changed, and closes the trip when no active member remains. Does nothing once a member is picked up.
- `trip_for_booking(db, booking) -> SharedTrip | None`

**`app/routers/bookings.py`** (targeted changes):

- The body of `create_booking` moves into `_create_booking(db, user, data) -> Booking` so shared trips reuse its checks. `POST /api/bookings` keeps its exact behaviour.
- `update_booking_status`: after a member booking becomes cancelled or rejected, call `recalculate`; when one becomes picked_up, close its trip.
- `update_location`: after updating the booking, apply the same consent, fix and trail rules to the trip's other picked_up / in_transit member bookings.
- `BookingOut` gains three optional fields, `shared_trip_id`, `shared_trip_member_count` (active members) and `shared_trip_fare`, filled when the booking belongs to a trip; the Bookings page uses them with `estimated_transport_cost` (the member's share) for its chip.

**`app/routers/shared_trips.py`**, prefix `/api/shared-trips`, all endpoints `require_farmer` (farmer, marketer, admin) except the detail endpoint, which uses `get_current_user` plus a membership/operator/admin check:

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `` | `market_id` (optional); `mine=true` | Joinable trips: id, market, pickup point, pickup_at, truck type and capacity, kg booked, kg free, member count, trip fare, `is_member`. With `mine=true`: every trip (open or closed) where the user has a member booking, newest first. |
| GET | `/{id}/quote` | `quantity_kg` | `{share, alone, saving}` using `split_fare` with the new load added |
| POST | `` | booking fields + `pickup_point` | 201, the opener's booking and the trip |
| POST | `/{id}/join` | `quantity_kg`, `crop_id` (optional), `notes` | 201, the new booking |
| POST | `/{id}/close` | | The trip (opener or admin only) |
| GET | `/{id}` | | Trip with members' first names, kg, status and share |

Errors:

| Case | Status | Detail |
|---|---|---|
| Already a member | 409 | You are already on this trip |
| Not joinable | 409 | The reason from `is_joinable`, in words |
| kg above space left | 400 | Only N kg is free on this trip |
| Trip not found | 404 | |
| Detail requested by a non-member | 403 | |
| Close by someone other than the opener or admin | 403 | |

Schemas go in a new `app/schemas/pooling.py`.

## 5. Frontend

All new UI follows the existing patterns: `ui-page` → `ui-toolbar` → `ui-alert` → `ui-card`, the shared `api` client, and `t()` text keys.

- `services/sharedTripService.js`: `getSharedTrips`, `getTripQuote`, `openSharedTrip`, `joinSharedTrip`, `closeSharedTrip`, `getSharedTrip`.
- `pages/Trucks.jsx`: checkbox and shared pickup point field in the Book form; when ticked, submit calls `openSharedTrip` instead of `createBooking`.
- `pages/SharedTrips.jsx` (+ `SharedTrips.css`), route `/shared-trips` inside the non-admin `ProtectedLayout`, menu entry for farmers (same roles as the Trucks menu entry), with a `TITLES` entry:
  - **Open trips:** one card per trip with a space-left bar and a Join button that opens an inline form (kg, optional crop stock) with a live quote, fetched at most every 400 ms while typing.
  - **My shared trips:** members' first names, kg and shares; the opener also sees "Close to new joiners".
- `pages/Bookings.jsx` (farmers): a chip on bookings in a shared trip, "Shared trip · 3 farmers · your share Rs 450 of Rs 1,800".
- `pages/BookingRequests.jsx` (operators): the same chip, worded "Shared trip · 3 farmers", so the operator knows the requests belong together.
- New keys in `i18n/messages.js`, then `node scripts/generate-translations.mjs`, checking that `<0>` placeholders survive and that no existing translation changes.

## 6. Testing

Backend tests run with `DATABASE_URL=sqlite:// python -m pytest -q` in `agri-project/backend`, written before the code they cover.

`tests/test_trip_pooling.py` (unit):
- One member pays the whole fare.
- Equal and unequal loads (300 kg + 600 kg of Rs 1,800 → Rs 600 + Rs 1,200).
- Rounding: three equal loads of Rs 1,000 sum to exactly Rs 1,000.00.
- Empty loads → `{}`; zero or negative kg → `ValueError`.

`tests/test_shared_trips_api.py` (in-memory SQLite, two farmers, one operator, one truck, one market):
- Opening creates a booking and a trip; the list shows it without names.
- The quote equals the share actually written after joining.
- Joining updates both bookings' transport cost and notifies the opener.
- Cancelling or rejecting a member recalculates the others.
- Close, already-a-member, past pickup, full, and kg-above-space errors.
- A non-member gets 403 on trip detail.
- A location fix on one member booking appears on the other's track.
- Regression: plain `POST /api/bookings` still charges the full fare and is in no trip.

Then: the whole backend test suite passes, `npm run build` succeeds, and a browser check on the local SQLite setup with two throwaway farmer accounts and one operator account (open, join, both shares drop, operator accepts both).

## 7. Risks

- **Overbooking by simultaneous joins.** Two joins at the same moment can both pass the space check. The operator's accept step still enforces truck capacity, so the truck is never overloaded; the second farmer may be rejected.
- **Generated translations.** `translations.js` will conflict with PR #1 if both change it; re-running the generator after merging resolves it.
- **Pickup time comparisons** use UTC, as the existing booking code does.
