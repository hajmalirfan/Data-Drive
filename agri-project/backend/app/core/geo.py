"""Real-world locations and road routes.

- Geocoding: OpenStreetMap Nominatim (max 1 request/second, identified User-Agent,
  results cached in `geocode_cache`).
- Routing: OSRM single routes (the multi-point table service returned inconsistent
  distances in testing, so every pair is routed on its own and cached in `route_cache`).
"""
import logging
import re
import threading
import time
from math import asin, cos, radians, sin, sqrt

import httpx

from app.core.database import SessionLocal
from app.models.geo import GeocodeCache, RouteCache

logger = logging.getLogger("smartag.geo")

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OSRM_URL = "https://router.project-osrm.org/route/v1/driving/{o_lng},{o_lat};{d_lng},{d_lat}"
USER_AGENT = "SmartAgOpsAdvisor/1.0 (farm market finder)"
# A market found further than this from its district centre is a same-name place elsewhere.
MAX_MARKET_FROM_DISTRICT_KM = 80

_nominatim_lock = threading.Lock()
_last_nominatim = 0.0
_locate_lock = threading.Lock()


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    lat1, lng1, lat2, lng2 = map(radians, (lat1, lng1, lat2, lng2))
    a = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371.0 * asin(sqrt(a))


# ---- Geocoding ----------------------------------------------------------------
def _nominatim(query: str) -> dict | None:
    """One rate-limited Nominatim lookup (India only)."""
    global _last_nominatim
    with _nominatim_lock:
        wait = 1.1 - (time.monotonic() - _last_nominatim)
        if wait > 0:
            time.sleep(wait)
        try:
            response = httpx.get(
                NOMINATIM_URL,
                params={"q": query, "format": "jsonv2", "limit": 1, "countrycodes": "in"},
                headers={"User-Agent": USER_AGENT},
                timeout=20.0,
            )
            response.raise_for_status()
            results = response.json()
        finally:
            _last_nominatim = time.monotonic()
    return results[0] if results else None


def geocode(db, query: str) -> tuple[float, float, str] | None:
    """(lat, lng, display_name) for a place, using the cache first."""
    key = re.sub(r"\s+", " ", query.strip().lower())[:300]
    if not key:
        return None
    cached = db.get(GeocodeCache, key)
    if cached is not None:
        if cached.latitude is None:
            return None
        return cached.latitude, cached.longitude, cached.display_name or query
    try:
        hit = _nominatim(query)
    except (httpx.HTTPError, ValueError):
        logger.warning("Geocoding failed for %r", query)
        return None  # network problem: do not cache, try again next time
    entry = GeocodeCache(
        query=key,
        latitude=float(hit["lat"]) if hit else None,
        longitude=float(hit["lon"]) if hit else None,
        display_name=(hit or {}).get("display_name", "")[:500] or None,
    )
    db.merge(entry)
    db.commit()
    return (entry.latitude, entry.longitude, entry.display_name or query) if hit else None


_NOISE = re.compile(r"\(.*?\)|\b(apmc|rm|market|uzhavar sandhai|mandi|regulated)\b", re.IGNORECASE)


def clean_market_name(market: str) -> str:
    return re.sub(r"\s+", " ", _NOISE.sub(" ", market)).strip(" ,.-") or market


def locate_market(db, state: str, district: str, market: str, allow_lookup: bool = True):
    """(lat, lng, precision) — precision is "market" or "district". None if unknown.

    With allow_lookup=False only cached results are used (for fast page loads).
    """
    def lookup(query):
        key = re.sub(r"\s+", " ", query.strip().lower())[:300]
        cached = db.get(GeocodeCache, key)
        if cached is None:
            return "pending" if not allow_lookup else geocode(db, query)
        return (cached.latitude, cached.longitude, cached.display_name) if cached.latitude is not None else None

    district_point = lookup(f"{district}, {state}, India")
    market_point = lookup(f"{clean_market_name(market)}, {district}, {state}, India")
    if "pending" in (district_point, market_point):
        return "pending"
    if market_point and (
        not district_point
        or haversine_km(market_point[0], market_point[1], district_point[0], district_point[1]) <= MAX_MARKET_FROM_DISTRICT_KM
    ):
        return market_point[0], market_point[1], "market"
    # Same-name place elsewhere, or not found: use the district centre (shown as approximate).
    if district_point:
        return district_point[0], district_point[1], "district"
    return None


def _key(query: str) -> str:
    return re.sub(r"\s+", " ", query.strip().lower())[:300]


def locate_markets_cached(db, markets: list[tuple[str, str, str]]) -> dict:
    """Cache-only locations for many markets in ONE query (the database is remote).

    Returns {(state, district, market): (lat, lng, precision) | "pending" | None}.
    """
    queries = {}
    for state, district, market in markets:
        queries[(state, district, market)] = (
            _key(f"{district}, {state}, India"),
            _key(f"{clean_market_name(market)}, {district}, {state}, India"),
        )
    keys = {k for pair in queries.values() for k in pair}
    rows = db.query(GeocodeCache).filter(GeocodeCache.query.in_(keys)).all() if keys else []
    cache = {row.query: row for row in rows}

    result = {}
    for item, (district_key, market_key) in queries.items():
        if district_key not in cache or market_key not in cache:
            result[item] = "pending"
            continue
        d, m = cache[district_key], cache[market_key]
        if m.latitude is not None and (
            d.latitude is None
            or haversine_km(m.latitude, m.longitude, d.latitude, d.longitude) <= MAX_MARKET_FROM_DISTRICT_KM
        ):
            result[item] = (m.latitude, m.longitude, "market")
        elif d.latitude is not None:
            result[item] = (d.latitude, d.longitude, "district")
        else:
            result[item] = None
    return result


def cached_routes(db, o_lat: float, o_lng: float, points: list[tuple[float, float]]) -> dict:
    """{dest_key: (km, minutes)} for already-routed pairs, in one query."""
    origin_key = _point_key(o_lat, o_lng)
    dest_keys = {_point_key(lat, lng) for lat, lng in points}
    if not dest_keys:
        return {}
    rows = db.query(RouteCache).filter(RouteCache.origin_key == origin_key, RouteCache.dest_key.in_(dest_keys)).all()
    return {row.dest_key: (row.distance_km, row.duration_min) for row in rows}


def locate_all_markets(markets: list[tuple[str, str, str]]) -> None:
    """Background: geocode every market not yet cached (1 request/second)."""
    if not _locate_lock.acquire(blocking=False):
        return
    db = SessionLocal()
    try:
        done = 0
        known = locate_markets_cached(db, markets)
        for item in markets:
            if known.get(item) == "pending":
                locate_market(db, *item, allow_lookup=True)
                done += 1
        if done:
            logger.info("Located %s mandi markets on OpenStreetMap", done)
    except Exception:
        logger.exception("Background market geocoding failed")
    finally:
        db.close()
        _locate_lock.release()


def start_locating(markets: list[tuple[str, str, str]]) -> None:
    if markets and not _locate_lock.locked():
        threading.Thread(target=locate_all_markets, args=(markets,), daemon=True).start()


def locating() -> bool:
    return _locate_lock.locked()


# ---- Routing ------------------------------------------------------------------
def _point_key(lat: float, lng: float) -> str:
    return f"{lat:.3f},{lng:.3f}"


def road_route(db, o_lat: float, o_lng: float, d_lat: float, d_lng: float) -> tuple[float, float] | None:
    """(road km, drive minutes) between two points, cached. None if routing is unavailable."""
    origin_key, dest_key = _point_key(o_lat, o_lng), _point_key(d_lat, d_lng)
    cached = db.query(RouteCache).filter_by(origin_key=origin_key, dest_key=dest_key).first()
    if cached:
        return cached.distance_km, cached.duration_min
    url = OSRM_URL.format(o_lat=o_lat, o_lng=o_lng, d_lat=d_lat, d_lng=d_lng)
    try:
        response = httpx.get(url, params={"overview": "false"}, headers={"User-Agent": USER_AGENT}, timeout=20.0)
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    if body.get("code") != "Ok" or not body.get("routes"):
        return None
    route = body["routes"][0]
    km, minutes = round(route["distance"] / 1000, 1), round(route["duration"] / 60, 1)
    try:
        db.add(RouteCache(origin_key=origin_key, dest_key=dest_key, distance_km=km, duration_min=minutes))
        db.commit()
    except Exception:
        db.rollback()  # another request cached the same pair first
    return km, minutes


def route_geometry(o_lat: float, o_lng: float, d_lat: float, d_lng: float) -> list[list[float]] | None:
    """Road path as [[lat, lng], ...] for drawing on the map."""
    url = OSRM_URL.format(o_lat=o_lat, o_lng=o_lng, d_lat=d_lat, d_lng=d_lng)
    try:
        response = httpx.get(
            url, params={"overview": "simplified", "geometries": "geojson"},
            headers={"User-Agent": USER_AGENT}, timeout=20.0,
        )
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    if body.get("code") != "Ok" or not body.get("routes"):
        return None
    return [[lat, lng] for lng, lat in body["routes"][0]["geometry"]["coordinates"]]
