from app.services.event_display import quality_event_summary


def test_inspection_failed_summary():
    s = quality_event_summary(
        "inspection_failed_hold",
        {"aw": 0.9, "limits": [0.65, 0.75]},
        "LOT-DEMO-001-D02",
    )
    assert "LOT-DEMO-001-D02" in s
    assert "Hold" in s
    assert "above upper limit" in s


def test_inspection_passed_summary():
    s = quality_event_summary(
        "inspection_passed",
        {"aw": 0.7, "limits": [0.65, 0.75]},
        "LOT-DEMO-001-D01",
    )
    assert "Inspection passed" in s
    assert "0.7" in s


def test_disposition_summary():
    s = quality_event_summary("disposition_completed", {"type": "rework", "remark": "Rework cycle 1"}, "D01")
    assert "Rework" in s
