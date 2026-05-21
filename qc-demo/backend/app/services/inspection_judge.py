"""Water activity pass/fail — closed interval [lower, upper] (§8.3)."""


def judge_aw(value: float, lower: float, upper: float) -> str:
    if lower <= value <= upper:
        return "pass"
    return "fail"


def format_fail_reason(value: float, lower: float, upper: float, item_name: str = "Water Activity (Aw)") -> str:
    if value > upper:
        return f"{item_name} {value} above upper limit {upper} (spec [{lower}, {upper}])"
    if value < lower:
        return f"{item_name} {value} below lower limit {lower} (spec [{lower}, {upper}])"
    return f"{item_name} {value} outside spec [{lower}, {upper}]"
