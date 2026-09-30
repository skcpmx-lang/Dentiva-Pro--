# Dentiva Pro — RBAC Matrix

## 1. Permission Catalog (58 permissions)

`patient.` view · create · edit · archive · delete · export
`appointment.` view · create · edit · delete
`queue.` view · manage
`visit.` view · create · edit · delete
`chart.` view · edit
`treatment.` view · manage
`prescription.` view · create · edit · void · print
`attachment.` view · upload · delete
`referral.` view · create · edit · delete
`invoice.` view · create · edit · void · delete · print
`payment.` view · create · void · delete · export
`financial.` view · export
`accounting.` view · manage · export
`inventory.` view · manage
`supplier.` view · manage
`staff.` view · manage
`user.` view · manage
`role.` view · manage
`audit.` view
`backup.` view · create · restore · schedule
`settings.` view · manage
`report.` view · export
`business.` delete
`notification.` view

## 2. Default Role Matrix (✔ = granted)

| Permission | Owner | Administrator | Dentist | Receptionist | Assistant | Accountant | Inventory Staff |
|---|---|---|---|---|---|---|---|
| patient.view | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| patient.create/edit | ✔ | ✔ | ✔ | ✔ | — | — | — |
| patient.archive | ✔ | ✔ | — | — | — | — | — |
| patient.delete (permanent) | ✔ | — | — | — | — | — | — |
| patient.export | ✔ | ✔ | — | — | — | — | — |
| appointment.view | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| appointment.create/edit | ✔ | ✔ | ✔ | ✔ | — | — | — |
| appointment.delete | ✔ | ✔ | — | ✔ | — | — | — |
| queue.view / manage | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| visit.view | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| visit.create/edit | ✔ | ✔ | ✔ | — | — | — | — |
| visit.delete | ✔ | ✔ | — | — | — | — | — |
| chart.view | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| chart.edit | ✔ | ✔ | ✔ | — | — | — | — |
| treatment.view | ✔ | ✔ | ✔ | — | ✔ | — | — |
| treatment.manage | ✔ | ✔ | ✔ | — | — | — | — |
| prescription.view | ✔ | ✔ | ✔ | — | ✔ | — | — |
| prescription.create/edit | ✔ | ✔ | ✔ | — | — | — | — |
| prescription.void | ✔ | ✔ | ✔ | — | — | — | — |
| prescription.print | ✔ | ✔ | ✔ | — | — | — | — |
| attachment.view/upload | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| attachment.delete | ✔ | ✔ | ✔ | — | — | — | — |
| referral.view | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| referral.create/edit | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| referral.delete | ✔ | ✔ | — | — | — | — | — |
| invoice.view | ✔ | ✔ | — | ✔ | — | ✔ | — |
| invoice.create / print | ✔ | ✔ | — | ✔ | — | ✔ | — |
| invoice.edit | ✔ | ✔ | — | ✔ | — | — | — |
| invoice.void | ✔ | ✔ | — | — | — | — | — |
| invoice.delete | ✔ | — | — | — | — | — | — |
| payment.view | ✔ | ✔ | — | ✔ | — | ✔ | — |
| payment.create | ✔ | ✔ | — | ✔ | — | ✔ | — |
| payment.void | ✔ | ✔ | — | — | — | ✔ | — |
| payment.delete | ✔ | — | — | — | — | — | — |
| payment.export | ✔ | ✔ | — | — | — | ✔ | — |
| financial.view / export | ✔ | ✔ | — | — | — | ✔ | — |
| accounting.view / manage / export | ✔ | ✔ | — | — | — | ✔ | — |
| inventory.view / manage | ✔ | ✔ | — | — | — | — | ✔ |
| supplier.view / manage | ✔ | ✔ | — | — | — | — | ✔ |
| staff.view | ✔ | ✔ | — | — | — | ✔ | — |
| staff.manage | ✔ | ✔ | — | — | — | — | — |
| user.view | ✔ | ✔ | — | — | — | — | — |
| user.manage | ✔ | ✔ | — | — | — | — | — |
| role.view | ✔ | ✔ | — | — | — | — | — |
| role.manage | ✔ | ✔ | — | — | — | — | — |
| audit.view | ✔ | ✔ | — | — | — | — | — |
| backup.view / create / schedule | ✔ | ✔ | — | — | — | — | — |
| backup.restore | ✔ | ✔ | — | — | — | — | — |
| settings.view | ✔ | ✔ | ✔ | — | — | — | — |
| settings.manage | ✔ | ✔ | — | — | — | — | — |
| report.view | ✔ | ✔ | ✔ | — | — | ✔ | — |
| report.export | ✔ | ✔ | — | — | — | ✔ | — |
| business.delete | ✔ | — | — | — | — | — | — |
| notification.view | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

Custom roles: admin builds any permission set (Settings → Users & Security → Roles). Guards: a user cannot deactivate their own account or drop their own `user.manage`; the last active `user.manage` holder cannot be demoted; system roles' core grants (Owner) are not editable.

## 3. Enforcement Points (all in trusted main process)

1. **IPC router** — every channel declares `permission` (or `public` / `authed`); checked before handler execution. Locked sessions reject everything except `auth.unlock`.
2. **Query-level filtering** — search, reports, dashboards, notifications, patient-profile financial blocks re-check `financial.view` / module permissions per query, so leakage by composition is impossible.
3. **Destructive routes** — additionally require typed-confirmation payloads (`confirm: "DELETE"`, restore confirmation, etc.) validated server-side.
4. UI menu/button visibility is a convenience layer only — never a control.

## 4. Verification (see TEST_PLAN.md)

- Automated: for each of the 7 default roles × representative allow/deny action set, integration tests call the **service layer directly** (bypassing all UI) and assert allow/deny. Direct-invocation bypass tests assert the router rejects unauthorized calls even when the renderer would never show the button.
- Financial leakage tests: search/reports/dashboard/profiles queried as low-privilege users must not contain financial entities.
