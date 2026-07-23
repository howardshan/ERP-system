# VII. Expected Benefits (v3.0)

> This section corresponds to "VII. Expected Benefits" of `NPIC-QC-Proposal-EN-Phase2-v3.0`.

## Summary Table

| Benefit | Impact |
|---|---|
| Eliminate manual Excel daily reports | ~2 hours/day of data-entry saved per supervisor; production visibility in real time |
| Real-time cart-level data | An accurate, time-stamped record is generated the moment each cart is completed — no after-the-fact backfilling |
| Work-order-level raw-material usage tracking | Actual usage attributed accurately per work order; cross-work-order material mixing distortion eliminated |
| Accurate cart count & timing tracking | Actual cart count = registered cart count; under-reporting eliminated; 100% output-registration accuracy |
| Post-production waiting-time logging | Accumulated waiting-time data provides a basis for future process optimization |
| No manual entry of workstation & labor hours | Workstation and labor-hour data captured automatically, replacing paper/Excel manual entry |
| Employee cart-level productivity | Automatically and accurately computed per employee × cart — finer-grained, more objective, real time |
| Work-order-level real-time production tracking | Each work order's progress is visible in real time, supporting more accurate monitoring and planning |
| No manual filling of per-cart records & reports | Line workers no longer manually fill in per-cart records and statistical reports |

## Detailed Explanations

**7.1 Eliminate manual Excel daily reports**
Today, each supervisor manually consolidates the shift's production in Excel and compiles a daily report. Once the system is live, the report is generated automatically from real-time shop-floor capture, with no manual entry. At roughly **2 hours/day** per supervisor, across **10 supervisors × 22 working days**, this saves about **440 labor-hours/month (≈2.5 FTE)**; the daily report shifts from "available next day" to "available in real time."

**7.2 Real-time cart-level data**
Each cart generates a time-stamped record the moment it is completed — no after-the-fact reconstruction from memory. Backfilling approaches **0**; **per-cart traceability reaches 100%**, with time stamps accurate to the minute.

**7.3 Work-order-level raw-material usage tracking**
Actual issuance and consumption are recorded **per work order**. Current pain point: material from one work order is often used on another, so actual usage cannot be attributed accurately. Binding material to the work order eliminates the distortion caused by **cross-work-order material mixing**, allowing each order's **actual usage / yield** to be computed accurately — supporting cost accounting and over-consumption detection. 〔If a baseline can be provided (share of work orders affected by mixing, or usage variance), an exact figure can be given.〕

**7.4 Accurate cart count & timing tracking**
Each cart's actual output quantity plus its start/finish timestamps are captured in real time. Current pain point: employees may **deliberately omit or under-report carts**, so the actual number produced does not match the registered number. With real-time counting the two match. **Actual cart count = registered cart count**, under-reporting drops to zero, output-registration accuracy rises to 100%, and an **average takt time (minutes/cart)** can be derived for capacity estimation and scheduling. 〔If a current under-reporting rate is available, the "recovered real output" can be quantified.〕

**7.5 Post-production waiting-time logging**
The **waiting time after each cart finishes production** (e.g., waiting to enter the next step / the drying room) is recorded, building up data that provides a basis for **future process optimization and efficiency improvement**. The **average waiting time (minutes/cart)** can be measured and used as a quantified baseline and tracking metric for improvement.

**7.6 No manual entry of workstation & labor hours**
Workstation assignment and working hours are captured by the system, replacing paper/Excel manual entry. The labor-hour saving here is **already included in the 7.1 daily-report saving and is not double-counted**; the value lies in improved completeness and accuracy of the labor-hour / workstation data (eliminating missing and incorrect entries).

**7.7 Employee cart-level productivity**
Productivity is computed automatically and accurately per **employee × cart** (carts/shift, units/labor-hour) — finer-grained, more objective, and real-time than the current approach. Data granularity reaches "person × cart"; **productivity dispersion** across teams/individuals can be compared, supporting performance evaluation and staffing decisions. 〔An objective baseline already exists; this item makes the data "more accurate and more granular," not something created from nothing.〕

**7.8 Work-order-level real-time production tracking**
The production progress/status of **each work order** is tracked in real time, so planning and production directors can **monitor and plan more accurately** based on actual performance (scheduling, capacity, delivery dates). Work-order progress is visible in real time (100% coverage), shifting from "after-the-fact roll-up" to "real-time command," supporting more accurate scheduling and capacity decisions.

**7.9 No manual filling of per-cart records & reports (line workers)**
Today, line workers must manually fill in each cart's production record and statistical reports; once the system is live, data is captured in real time on the shop floor and workers no longer fill anything in manually. At **1 minute/cart × 6 carts/shift × 3 shifts/day × 40 production lines = 720 minutes/day (12 labor-hours/day)**, across **22 working days**, this saves about **264 labor-hours/month (≈1.5 FTE)**.
