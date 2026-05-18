"""Drying sub-lot status transitions."""

from typing import Final

VALID_STATUSES: Final[frozenset[str]] = frozenset(
    {"drying", "pending", "inspecting", "passed", "hold", "disposing", "closed"}
)

TRANSITIONS: Final[dict[tuple[str, str], str]] = {
    ("drying", "register_out"): "pending",
    ("pending", "start_inspection"): "inspecting",
    ("inspecting", "submit_pass"): "passed",
    ("inspecting", "submit_fail"): "hold",
    ("hold", "start_disposition"): "disposing",
    ("disposing", "complete_disposition"): "closed",
}

CREATE_EVENTS: Final[frozenset[str]] = frozenset({"register_in", "register_out"})


def can_transition(current: str | None, event: str) -> bool:
    if current is None:
        return event in CREATE_EVENTS
    if current not in VALID_STATUSES:
        return False
    return (current, event) in TRANSITIONS


def next_status(current: str | None, event: str) -> str:
    if current is None:
        if event == "register_in":
            return "drying"
        if event == "register_out":
            return "pending"
    key = (current, event)
    if key not in TRANSITIONS:
        raise ValueError(f"Invalid transition: {current!r} + {event!r}")
    return TRANSITIONS[key]
