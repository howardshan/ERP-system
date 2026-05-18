"""Drying sub-lot status transitions (Demo plan §8.2)."""

from typing import Final

VALID_STATUSES: Final[frozenset[str]] = frozenset(
    {"pending", "inspecting", "passed", "hold", "disposing", "closed"}
)

# (current_status, event) -> next_status
TRANSITIONS: Final[dict[tuple[str, str], str]] = {
    ("pending", "start_inspection"): "inspecting",
    ("inspecting", "submit_pass"): "passed",
    ("inspecting", "submit_fail"): "hold",
    ("hold", "start_disposition"): "disposing",
    ("disposing", "complete_disposition"): "closed",
}

# Allow creating sub-lot directly as pending from registration
CREATE_EVENTS: Final[frozenset[str]] = frozenset({"register_out"})


def can_transition(current: str | None, event: str) -> bool:
    if current is None:
        return event in CREATE_EVENTS
    if current not in VALID_STATUSES:
        return False
    return (current, event) in TRANSITIONS


def next_status(current: str | None, event: str) -> str:
    if current is None and event == "register_out":
        return "pending"
    key = (current, event)
    if key not in TRANSITIONS:
        raise ValueError(f"Invalid transition: {current!r} + {event!r}")
    return TRANSITIONS[key]
