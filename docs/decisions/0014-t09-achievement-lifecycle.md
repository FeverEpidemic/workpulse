# Decision 0014 T09 Achievement lifecycle

Date: 22 September 2026

Status: accepted for T09 implementation.

## Decision

T09 stores manual and Activity-derived achievements as canonical user-owned rows. A draft may be
standalone or linked to one owned Activity. A derived row receives its Activity context and exact
source excerpt/revision from the database while the Activity is locked; the browser cannot submit
those authoritative values. A partial unique index allows at most one derived row per Activity.

The lifecycle is `draft`, `confirmed`, and `dismissed`. Confirm is explicit and requires title,
contribution, outcome, exact achieved date, and CV bullet. A qualitative outcome is valid without a
metric or evidence. Dismissed rows must be reopened to draft before confirmation. A confirmed row can
be edited while remaining confirmed when the required fields remain valid. Confirmation makes the row
eligible for a future CV selection pool; it does not select or render it in the CV.

## Limits and provenance

The application and database use Unicode code-point limits: title 200, contribution/scope/outcome
5,000, CV bullet 2,000, source excerpt 10,000, 20 strict metrics, and 20 skill labels. Optional
empty text is stored as NULL. Metrics are strict objects with numeric value/unit requirements; no
zero fallback is generated. A blank CV bullet during Confirm is filled only by a deterministic join
of the user-provided contribution and outcome. The join never paraphrases, translates, truncates, or
adds a fact; an over-limit result is a validation error.

Deleting an Activity detaches its derived Achievement after preserving source excerpt and source
revision. Deleting a Project releases its project link while retaining work and Experience context.
Deleting an Experience clears context without deleting the Achievement. Direct table mutation is
revoked; narrow security-definer RPCs obtain the session owner and enforce expected revisions.

## Context and lock order

The final lock hierarchy is `Experience -> Project -> Activity -> Achievement -> achievement_skills`.
Multiple rows are locked by UUID ascending order. Project/Activity context propagation uses the same
transaction and the Activity context trigger updates derived Achievements without changing source
wording or status. Standalone Project context derives Experience from the Project. Detaching a
standalone Achievement preserves its current Experience.

Skill labels reuse the existing owner-scoped normalized `skills` table. Save resolves labels and
replaces joins atomically under the Achievement lock. Demonstrated count is a live
`COUNT(DISTINCT achievement_id)` over confirmed rows only; proficiency and readiness are not stored.

## Trace and deferred seams

This decision traces PRD R05/R06, Flow F02-F04, Screens S06-S10, and Database Schema §§1-3/6.
Evidence remains T10-T11, dashboard/timeline counts remain T12, AI remains T13-T14, import remains
T15-T17, and CV selection/invalidation/export remains T18-T22. T09 intentionally adds no worker,
Evidence count/filter, AI control, Add to CV action, or PDF behavior.

