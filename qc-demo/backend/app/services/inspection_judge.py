"""Water activity pass/fail — closed interval [lower, upper] (§8.3)."""


def judge_aw(value: float, lower: float, upper: float) -> str:
    if lower <= value <= upper:
        return "pass"
    return "fail"


def format_fail_reason(value: float, lower: float, upper: float, item_name: str = "水活 Aw") -> str:
    if value > upper:
        return f"{item_name} {value}，高于合格上限 {upper}（标准 [{lower}, {upper}]）"
    if value < lower:
        return f"{item_name} {value}，低于合格下限 {lower}（标准 [{lower}, {upper}]）"
    return f"{item_name} {value}，未在合格范围 [{lower}, {upper}] 内"
