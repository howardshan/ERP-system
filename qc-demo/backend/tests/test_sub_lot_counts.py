from app.helpers import build_sub_lot_counts


def test_pending_includes_inspecting():
    counts = build_sub_lot_counts([("pending", 1), ("inspecting", 1), ("passed", 2), ("hold", 1)])
    assert counts["total"] == 5
    assert counts["pending"] == 2
    assert counts["passed"] == 2
    assert counts["hold"] == 1
