"""Unit tests for the shared-trip fare split (spec: shared truck trips, section 4)."""
import pytest

from app.services.trip_pooling import split_fare


def test_single_member_pays_full_fare():
    assert split_fare(1800.0, {7: 300.0}) == {7: 1800.0}


def test_unequal_loads_split_by_kg():
    assert split_fare(1800.0, {1: 300.0, 2: 600.0}) == {1: 600.0, 2: 1200.0}


def test_rounding_sums_exactly_to_fare():
    shares = split_fare(1000.0, {1: 100.0, 2: 100.0, 3: 100.0})
    assert round(sum(shares.values()), 2) == 1000.0
    assert sorted(shares.values()) == [333.33, 333.33, 333.34]
    # The rounding remainder goes to the largest load, lowest id on a tie.
    assert shares[1] == 333.34


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
