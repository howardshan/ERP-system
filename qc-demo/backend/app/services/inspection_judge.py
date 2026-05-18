"""Water activity pass/fail — closed interval [lower, upper] (§8.3)."""


def judge_aw(value: float, lower: float, upper: float) -> str:
    if lower <= value <= upper:
        return "pass"
    return "fail"
