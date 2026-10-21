"""Idempotent demo seed for the SmartAg Ops Advisor MVP.

The seed writes normal database rows so every screen is backed by real API data.
Market prices are explicitly labelled with their source and observation time.
"""

from datetime import date, datetime, timedelta

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.operations import Booking, CropStock, Market, MarketPrice, Notification, Truck
from app.models.user import User

DEMO_USERS = [
    {
        "email": "admin@example.com",
        "phone": "9000000000",
        "full_name": "Platform Admin",
        "role": "admin",
        "password": "Admin123",
        "location": "Chennai, Tamil Nadu",
    },
    {
        "email": "farmer@smartag.in",
        "phone": "9876543210",
        "full_name": "Ravi Kumar",
        "role": "farmer",
        "password": "Farmer123",
        "location": "Theni, Tamil Nadu",
    },
    {
        "email": "operator@smartag.in",
        "phone": "9876500001",
        "full_name": "Murugan Transport",
        "role": "truck_operator",
        "password": "Operator123",
        "location": "Theni, Tamil Nadu",
    },
    {
        "email": "manager@smartag.in",
        "phone": "9876500002",
        "full_name": "Kavitha S",
        "role": "market_manager",
        "password": "Manager123",
        "location": "Madurai, Tamil Nadu",
    },
    {
        "email": "fpo@smartag.in",
        "phone": "9876500003",
        "full_name": "Theni Farmer Producer Co.",
        "role": "fpo",
        "password": "Fpo12345",
        "location": "Theni, Tamil Nadu",
    },
    {
        "email": "buyer@smartag.in",
        "phone": "9876500004",
        "full_name": "FreshMart Buyers",
        "role": "buyer",
        "password": "Buyer123",
        "location": "Chennai, Tamil Nadu",
    },
]

MARKETS = [
    ("Theni Mandi", "Theni", 9.9312, 77.5001, 12, 22, 48, 18, 16),
    ("Madurai Central Market", "Madurai", 9.9252, 78.1198, 72, 20, 47, 20, 17),
    ("Dindigul Market", "Dindigul", 10.3673, 77.9803, 68, 21, 45, 17, 15),
    ("Nagercoil Market", "Kanyakumari", 8.1833, 77.4119, 95, 19, 44, 16, 14),
    ("Kumbakonam Mandi", "Thanjavur", 10.9601, 79.3845, 160, 23, 49, 18, 18),
    ("Tiruvarur Mandi", "Tiruvarur", 10.7716, 79.6368, 175, 18, 43, 15, 13),
]

TRUCKS = [
    ("TRK-102", "Open body", 2500, 2500, "Theni", "Madurai", 26, 500, True),
    ("TRK-087", "Container", 3500, 3500, "Theni", "Dindigul", 30, 700, False),
    ("TRK-045", "Mini truck", 1800, 1800, "Theni", "Theni", 24, 400, True),
    ("TRK-211", "Open body", 4000, 4000, "Madurai", "Theni", 28, 550, False),
    ("TRK-156", "Container", 5000, 5000, "Dindigul", "Madurai", 32, 800, False),
    ("TRK-303", "Mini truck", 1500, 1500, "Theni", "Nagercoil", 25, 450, True),
    ("TRK-318", "Open body", 3000, 3000, "Theni", "Kumbakonam", 29, 600, False),
    ("TRK-402", "Container", 4500, 4500, "Tiruvarur", "Theni", 31, 750, False),
    ("TRK-455", "Mini truck", 2000, 2000, "Theni", "Madurai", 23, 420, True),
    ("TRK-510", "Open body", 3500, 3500, "Madurai", "Dindigul", 27, 520, False),
    ("TRK-611", "Container", 5500, 5500, "Theni", "Chennai", 34, 900, False),
    ("TRK-720", "Mini truck", 1200, 1200, "Theni", "Theni", 22, 350, True),
]


def _ensure_user(db, data: dict) -> User:
    user = db.query(User).filter(User.email == data["email"]).first()
    if user:
        if not user.full_name:
            user.full_name = data["full_name"]
        if not user.phone:
            user.phone = data["phone"]
        if not user.location:
            user.location = data["location"]
        return user
    user = User(
        email=data["email"],
        phone=data["phone"],
        full_name=data["full_name"],
        role=data["role"],
        location=data["location"],
        hashed_password=hash_password(data["password"]),
    )
    db.add(user)
    db.flush()
    return user


def seed_demo_data() -> None:
    if not settings.SEED_DEMO_DATA:
        return

    db = SessionLocal()
    try:
        users: dict[str, User] = {}
        for item in DEMO_USERS:
            users[item["role"]] = _ensure_user(db, item)
        farmer = users["farmer"]
        operator = users["truck_operator"]

        if db.query(Market).count() == 0:
            for name, district, lat, lng, distance, tomato, chilli, brinjal, onion in MARKETS:
                db.add(
                    Market(
                        name=name,
                        district=district,
                        state="Tamil Nadu",
                        latitude=lat,
                        longitude=lng,
                        distance_km=distance,
                    )
                )
            db.flush()

        markets = db.query(Market).order_by(Market.id.asc()).all()

        if db.query(MarketPrice).count() == 0:
            now = datetime.utcnow()
            for index, market in enumerate(markets):
                if index >= len(MARKETS):
                    break
                _, _, _, _, _, tomato, chilli, brinjal, onion = MARKETS[index]
                crop_base = {
                    "Tomato": tomato,
                    "Chilli": chilli,
                    "Brinjal": brinjal,
                    "Onion": onion,
                }
                for crop_name, latest_price in crop_base.items():
                    # One older record gives the UI a real trend comparison.
                    db.add(
                        MarketPrice(
                            market_id=market.id,
                            crop_name=crop_name,
                            price_per_kg=round(latest_price - 0.8, 2),
                            source="SmartAg demo seed · manager-entered",
                            observed_at=now - timedelta(hours=30 + index * 2),
                            created_by=users["market_manager"].id,
                        )
                    )
                    # Two markets intentionally carry older data so stale flags are visible.
                    hours_ago = 52 if market.name in {"Nagercoil Market", "Tiruvarur Mandi"} else 1 + index
                    db.add(
                        MarketPrice(
                            market_id=market.id,
                            crop_name=crop_name,
                            price_per_kg=latest_price,
                            source="SmartAg demo seed · manager-entered",
                            observed_at=now - timedelta(hours=hours_ago),
                            created_by=users["market_manager"].id,
                        )
                    )

        if db.query(Truck).count() == 0:
            for index, (vehicle, truck_type, capacity, available, route_from, route_to, rate, fare, seat) in enumerate(TRUCKS):
                status = "available"
                db.add(
                    Truck(
                        operator_id=operator.id,
                        vehicle_number=vehicle,
                        truck_type=truck_type,
                        capacity_kg=capacity,
                        available_capacity_kg=available,
                        route_from=route_from,
                        route_to=route_to,
                        available_from=date.today() + timedelta(days=index % 3),
                        price_per_km=rate,
                        base_fare=fare,
                        status=status,
                        has_passenger_seat=seat,
                        last_location=f"{route_from}, Tamil Nadu",
                        last_lat=9.9312 if route_from == "Theni" else 9.9252,
                        last_lng=77.5001 if route_from == "Theni" else 78.1198,
                        last_reported_at=datetime.utcnow() - timedelta(minutes=20 + index),
                    )
                )
            db.flush()

        crops = db.query(CropStock).filter(CropStock.owner_id == farmer.id).all()
        if not crops:
            crops = [
                CropStock(
                    owner_id=farmer.id,
                    crop_name="Tomato",
                    variety="Hybrid",
                    quantity_kg=1000,
                    unit="kg",
                    grade="A",
                    harvest_date=date.today() - timedelta(days=9),
                    pickup_location="Theni, Tamil Nadu",
                    notes="Sorted and packed in crates.",
                    cost_per_kg=12,
                    status="available",
                ),
                CropStock(
                    owner_id=farmer.id,
                    crop_name="Chilli",
                    variety="Guntur",
                    quantity_kg=1500,
                    unit="kg",
                    grade="B",
                    harvest_date=date.today() - timedelta(days=11),
                    pickup_location="Theni, Tamil Nadu",
                    notes="Sun-dried, moisture checked.",
                    cost_per_kg=30,
                    status="available",
                ),
                CropStock(
                    owner_id=farmer.id,
                    crop_name="Brinjal",
                    variety="Local",
                    quantity_kg=2000,
                    unit="kg",
                    grade="A",
                    harvest_date=date.today() - timedelta(days=8),
                    pickup_location="Theni, Tamil Nadu",
                    notes="Fresh harvest, morning pickup preferred.",
                    cost_per_kg=9,
                    status="available",
                ),
            ]
            db.add_all(crops)
            db.flush()

        truck_rows = db.query(Truck).order_by(Truck.id.asc()).all()
        if db.query(Booking).count() == 0 and len(truck_rows) >= 3:
            from app.routers.markets import build_comparison

            tomato = next((crop for crop in crops if crop.crop_name == "Tomato"), crops[0])
            chilli = next((crop for crop in crops if crop.crop_name == "Chilli"), crops[0])
            brinjal = next((crop for crop in crops if crop.crop_name == "Brinjal"), crops[-1])
            theni = next((market for market in markets if market.name == "Theni Mandi"), markets[0])
            madurai = next((market for market in markets if market.name == "Madurai Central Market"), markets[0])
            dindigul = next((market for market in markets if market.name == "Dindigul Market"), markets[0])

            active_truck = truck_rows[0]
            active_truck.status = "on_trip"
            active_truck.available_capacity_kg = max(0, active_truck.capacity_kg - 1000)
            active_truck.last_lat = 9.956
            active_truck.last_lng = 77.535
            active_truck.last_location = "Theni bypass road"
            active_truck.last_reported_at = datetime.utcnow() - timedelta(minutes=12)

            tomato_comparison = build_comparison(db, tomato.crop_name, 1000, tomato.cost_per_kg)
            tomato_option = next(
                (option for option in tomato_comparison.options if option.market_id == theni.id),
                None,
            )
            in_transit = Booking(
                farmer_id=farmer.id,
                truck_id=active_truck.id,
                crop_id=tomato.id,
                market_id=theni.id,
                quantity_kg=1000,
                pickup_location=tomato.pickup_location,
                destination=theni.name,
                pickup_at=datetime.utcnow() - timedelta(hours=4),
                accompanied=False,
                status="in_transit",
                distance_km=theni.distance_km,
                eta_minutes=theni.eta_minutes,
                estimated_transport_cost=round(active_truck.base_fare + theni.distance_km * active_truck.price_per_km, 2),
                estimated_net_proceeds=(
                    tomato_option.breakdown.net_proceeds if tomato_option else None
                ),
                notes="Driver will call before arrival.",
                location_consent=True,
                last_lat=9.956,
                last_lng=77.535,
                last_reported_at=datetime.utcnow() - timedelta(minutes=12),
            )
            db.add(in_transit)

            delivered_truck = truck_rows[1]
            chilli_comparison = build_comparison(db, chilli.crop_name, 1500, chilli.cost_per_kg)
            chilli_option = next(
                (option for option in chilli_comparison.options if option.market_id == madurai.id),
                None,
            )
            delivered = Booking(
                farmer_id=farmer.id,
                truck_id=delivered_truck.id,
                crop_id=chilli.id,
                market_id=madurai.id,
                quantity_kg=1500,
                pickup_location=chilli.pickup_location,
                destination=madurai.name,
                pickup_at=datetime.utcnow() - timedelta(days=3),
                accompanied=False,
                status="delivered",
                distance_km=madurai.distance_km,
                eta_minutes=madurai.eta_minutes,
                estimated_transport_cost=round(delivered_truck.base_fare + madurai.distance_km * delivered_truck.price_per_km, 2),
                estimated_net_proceeds=(
                    chilli_option.breakdown.net_proceeds if chilli_option else None
                ),
                notes="Completed trip.",
                actual_sold_quantity_kg=1500,
                actual_price_per_kg=47,
                actual_expenses=2550,
                delivered_at=datetime.utcnow() - timedelta(days=2),
                location_consent=False,
            )
            db.add(delivered)

            requested_truck = truck_rows[2]
            brinjal_comparison = build_comparison(db, brinjal.crop_name, 2000, brinjal.cost_per_kg)
            brinjal_option = next(
                (option for option in brinjal_comparison.options if option.market_id == dindigul.id),
                None,
            )
            db.add(
                Booking(
                    farmer_id=farmer.id,
                    truck_id=requested_truck.id,
                    crop_id=brinjal.id,
                    market_id=dindigul.id,
                    quantity_kg=2000,
                    pickup_location=brinjal.pickup_location,
                    destination=dindigul.name,
                    pickup_at=datetime.utcnow() + timedelta(days=1, hours=3),
                    accompanied=False,
                    status="requested",
                    distance_km=dindigul.distance_km,
                    eta_minutes=dindigul.eta_minutes,
                    estimated_transport_cost=round(requested_truck.base_fare + dindigul.distance_km * requested_truck.price_per_km, 2),
                    estimated_net_proceeds=(
                        brinjal_option.breakdown.net_proceeds if brinjal_option else None
                    ),
                    notes="Please confirm pickup time.",
                )
            )
            db.flush()

            db.add_all(
                [
                    Notification(
                        user_id=farmer.id,
                        title="Truck TRK-102 is in transit",
                        message="Your tomato shipment to Theni Mandi is on the way. Live location is shared by the driver.",
                        link="/tracking",
                    ),
                    Notification(
                        user_id=farmer.id,
                        title="Delivery recorded",
                        message="Chilli delivery to Madurai Central Market was completed. Actual expenses have been saved.",
                        link="/bookings",
                    ),
                    Notification(
                        user_id=farmer.id,
                        title="Fresh market prices available",
                        message="New tomato and chilli prices were added by the market price manager.",
                        link="/market-prices",
                    ),
                    Notification(
                        user_id=operator.id,
                        title="New truck booking request",
                        message="Ravi Kumar requested TRK-045 for 2,000 kg brinjal to Dindigul Market.",
                        link="/bookings",
                    ),
                ]
            )

        db.commit()
    finally:
        db.close()
