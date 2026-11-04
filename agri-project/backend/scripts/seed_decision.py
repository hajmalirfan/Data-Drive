"""Load the PRD sample prices for the market comparison.

Run from agri-project/backend:  python -m scripts.seed_decision
Safe to run more than once: existing sample rows are left as they are.
"""
from app.core.database import Base, SessionLocal, engine
from app.models import decision  # noqa: F401 - register tables
from app.services.decision_seed import seed_sample

if __name__ == "__main__":
    Base.metadata.create_all(bind=engine, tables=[
        decision.Region.__table__, decision.DecisionMarket.__table__, decision.UnitConversion.__table__,
        decision.MarketCrop.__table__, decision.IngestionRun.__table__, decision.PriceRecord.__table__,
    ])
    with SessionLocal() as db:
        added = seed_sample(db)
    print(f"Sample seed: {added} price rows added." if added else "Sample seed already present; nothing added.")
