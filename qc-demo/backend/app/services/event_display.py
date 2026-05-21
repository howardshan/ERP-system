"""Human-readable summaries for qc.quality_event rows."""

from app.services.inspection_judge import format_fail_reason

DISP_LABELS = {
    "rework": "Rework",
    "grind": "Grind & re-line",
    "scrap": "Scrap",
    "concession": "Concession",
}


def quality_event_summary(event_type: str, payload: dict, sub_lot_code: str | None = None) -> str:
    prefix = f"{sub_lot_code} · " if sub_lot_code else ""
    p = payload or {}

    if event_type == "check_in":
        code = p.get("sub_lot_code") or sub_lot_code or "sub-lot"
        return f"{prefix}Checked in to dryer ({code})"

    if event_type == "check_out":
        return f"{prefix}Checked out of dryer — pending inspection"

    if event_type in ("inspection_passed", "inspection_failed_hold"):
        aw = p.get("aw")
        limits = p.get("limits")
        aw_text = f"Water Activity (Aw) {aw}" if aw is not None else "Inspection"
        if limits and len(limits) >= 2:
            lo, hi = float(limits[0]), float(limits[1])
            range_text = f" (spec [{lo}, {hi}])"
            if event_type == "inspection_passed":
                return f"{prefix}Inspection passed: {aw_text}{range_text}"
            if aw is not None:
                reason = format_fail_reason(float(aw), lo, hi)
                return f"{prefix}Inspection failed — Hold: {reason}"
            return f"{prefix}Inspection failed — Hold{range_text}"
        if event_type == "inspection_passed":
            return f"{prefix}Inspection passed: {aw_text}"
        return f"{prefix}Inspection failed — Hold: {aw_text}"

    if event_type == "disposition_completed":
        dtype = p.get("type", "")
        label = DISP_LABELS.get(dtype, dtype or "Disposition")
        remark = (p.get("remark") or "").strip()
        base = f"{prefix}Disposition completed: {label}"
        return f"{base} ({remark})" if remark else base

    return f"{prefix}{event_type}"
