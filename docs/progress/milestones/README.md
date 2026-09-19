# Milestone snapshots

This directory holds one archived snapshot per completed milestone, written at the moment the
milestone is declared complete (AD-014, rule 7). A snapshot is distinct from the live
`docs/progress/WORKLOG.md`: the work log keeps growing and interleaves every milestone, while a
snapshot freezes one milestone's final shape in a single file that never changes afterwards. Files
are named `m0.md`, `m1.md`, `m2.md` and so on, one per milestone, matching the `Mx` identifiers
used in work-log entry headings. A snapshot records the milestone's tasks and each task's final
status, the verification results that justified calling it complete, any deviations from the plan
in `docs/milestones/build-plan.md`, and the commit SHA at which the milestone was considered
complete.
