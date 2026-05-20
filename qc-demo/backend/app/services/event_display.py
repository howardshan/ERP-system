"""Human-readable summaries for qc.quality_event rows."""

from app.services.inspection_judge import format_fail_reason

DISP_LABELS = {
    "rework": "返烘",
    "grind": "粉碎回线",
    "scrap": "报废",
    "concession": "让步",
}


def quality_event_summary(event_type: str, payload: dict, sub_lot_code: str | None = None) -> str:
    prefix = f"{sub_lot_code} · " if sub_lot_code else ""
    p = payload or {}

    if event_type == "check_in":
        code = p.get("sub_lot_code") or sub_lot_code or "子批"
        return f"{prefix}登记进房（{code}）"

    if event_type == "check_out":
        return f"{prefix}登记出房，进入待检队列"

    if event_type in ("inspection_passed", "inspection_failed_hold"):
        aw = p.get("aw")
        limits = p.get("limits")
        aw_text = f"水活 Aw {aw}" if aw is not None else "检验"
        if limits and len(limits) >= 2:
            lo, hi = float(limits[0]), float(limits[1])
            range_text = f"（标准 [{lo}, {hi}]）"
            if event_type == "inspection_passed":
                return f"{prefix}检验合格：{aw_text}{range_text}"
            if aw is not None:
                reason = format_fail_reason(float(aw), lo, hi)
                return f"{prefix}检验不合格，进入 Hold：{reason}"
            return f"{prefix}检验不合格，进入 Hold{range_text}"
        if event_type == "inspection_passed":
            return f"{prefix}检验合格：{aw_text}"
        return f"{prefix}检验不合格，进入 Hold：{aw_text}"

    if event_type == "disposition_completed":
        dtype = p.get("type", "")
        label = DISP_LABELS.get(dtype, dtype or "处置")
        remark = (p.get("remark") or "").strip()
        base = f"{prefix}处置完成：{label}"
        return f"{base}（{remark}）" if remark else base

    return f"{prefix}{event_type}"
