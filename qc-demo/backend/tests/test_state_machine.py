import pytest

from app.services.inspection_judge import format_fail_reason, judge_aw
from app.services.state_machine import can_transition, next_status


def test_register_in_creates_drying():
    assert can_transition(None, "register_in")
    assert next_status(None, "register_in") == "drying"


def test_drying_to_pending():
    assert next_status("drying", "register_out") == "pending"


def test_register_out_creates_pending():
    assert can_transition(None, "register_out")
    assert next_status(None, "register_out") == "pending"


def test_pending_to_inspecting():
    assert can_transition("pending", "start_inspection")
    assert next_status("pending", "start_inspection") == "inspecting"


def test_inspecting_to_passed():
    assert next_status("inspecting", "submit_pass") == "passed"


def test_inspecting_to_hold():
    assert next_status("inspecting", "submit_fail") == "hold"


def test_hold_disposition_flow():
    assert next_status("hold", "start_disposition") == "disposing"
    assert next_status("disposing", "complete_disposition") == "closed"


def test_invalid_transition_raises():
    with pytest.raises(ValueError):
        next_status("passed", "start_inspection")


def test_judge_aw_closed_interval_pass():
    assert judge_aw(0.65, 0.65, 0.75) == "pass"
    assert judge_aw(0.75, 0.65, 0.75) == "pass"


def test_judge_aw_fail():
    assert judge_aw(0.90, 0.65, 0.75) == "fail"
    assert judge_aw(0.60, 0.65, 0.75) == "fail"


def test_format_fail_reason_high():
    assert "above upper limit" in format_fail_reason(0.90, 0.65, 0.75)


def test_format_fail_reason_low():
    assert "below lower limit" in format_fail_reason(0.60, 0.65, 0.75)
