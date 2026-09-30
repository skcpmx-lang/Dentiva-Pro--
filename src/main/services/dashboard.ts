import type { AppContext, Actor } from '../core/context'
import type { DashboardData } from '@shared/ipc'
import type { AppointmentRow, QueueEntry } from '@shared/types'
import { actorCan } from '../core/context'
import { todayISO } from '@shared/dates'

export function dashboardGet(ctx: AppContext, actor: Actor): DashboardData {
  const today = todayISO(ctx.clock())
  const apptWhere = "a.appt_date = ? AND a.status NOT IN ('cancelled','rescheduled')"
  const appointmentsToday = (ctx.db.prepare(`
    SELECT a.*, p.full_name AS patientName, p.patient_code AS patientCode, p.phone AS patientPhone, d.full_name AS dentistName
    FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN dentists d ON d.id = a.dentist_id
    WHERE ${apptWhere} ORDER BY a.appt_time
  `).all(today) as Record<string, unknown>[]).map(mapAppt)
  const completedVisitsToday = (ctx.db.prepare('SELECT COUNT(*) AS c FROM visits WHERE visit_date = ?').get(today) as { c: number }).c
  const noShowsToday = (ctx.db.prepare("SELECT COUNT(*) AS c FROM appointments WHERE appt_date = ? AND status = 'no_show'").get(today) as { c: number }).c
  const newPatientsToday = (ctx.db.prepare('SELECT COUNT(*) AS c FROM patients WHERE registered_at = ?').get(today) as { c: number }).c

  const waitingQueue = (ctx.db.prepare(`
    SELECT q.*, p.full_name AS patientName, p.patient_code AS patientCode, d.full_name AS dentistName
    FROM queue_entries q JOIN patients p ON p.id = q.patient_id JOIN dentists d ON d.id = q.dentist_id
    WHERE q.queue_date = ? AND q.status IN ('waiting','called','in_treatment','billing') ORDER BY q.token_no
  `).all(today) as Record<string, unknown>[]).map(mapQueue)

  const upcomingFollowUps = (ctx.db.prepare(`
    SELECT v.id AS visitId, v.patient_id AS patientId, p.full_name AS patientName, v.follow_up_date AS followUpDate
    FROM visits v JOIN patients p ON p.id = v.patient_id
    WHERE v.follow_up_date >= ? ORDER BY v.follow_up_date LIMIT 10
  `).all(today) as { visitId: number; patientId: number; patientName: string; followUpDate: string }[])

  let lowStockCount = 0, outOfStockCount = 0, expiringCount = 0
  if (actorCan(actor, 'inventory.view')) {
    lowStockCount = (ctx.db.prepare(`
      SELECT COUNT(*) AS c FROM inventory_items i WHERE i.is_active = 1 AND i.reorder_threshold > 0 AND (
        SELECT COALESCE(SUM(qty_current),0) FROM inventory_batches b WHERE b.item_id = i.id AND b.status = 'active'
      ) > 0 AND (
        SELECT COALESCE(SUM(qty_current),0) FROM inventory_batches b WHERE b.item_id = i.id AND b.status = 'active'
      ) <= i.reorder_threshold
    `).get() as { c: number }).c
    outOfStockCount = (ctx.db.prepare(`
      SELECT COUNT(*) AS c FROM inventory_items i WHERE i.is_active = 1 AND (
        SELECT COALESCE(SUM(qty_current),0) FROM inventory_batches b WHERE b.item_id = i.id AND b.status = 'active'
      ) <= 0 AND EXISTS (SELECT 1 FROM inventory_batches b WHERE b.item_id = i.id)
    `).get() as { c: number }).c
    expiringCount = (ctx.db.prepare(`
      SELECT COUNT(*) AS c FROM inventory_batches b
      WHERE b.status = 'active' AND b.qty_current > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= date('now', '+30 days')
    `).get() as { c: number }).c
  }

  let financial: DashboardData['financial'] = null
  if (actorCan(actor, 'financial.view')) {
    const revenueToday = (ctx.db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'valid' AND payment_date = ?"
    ).get(today) as { s: number }).s
    const expensesToday = (ctx.db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS s FROM financial_transactions WHERE kind = 'expense' AND txn_date = ?"
    ).get(today) as { s: number }).s
    const outstandingTotal = (ctx.db.prepare(
      "SELECT COALESCE(SUM(due_amount),0) AS s FROM invoices WHERE status IN ('unpaid','partial')"
    ).get() as { s: number }).s
    const methodRows = ctx.db.prepare(
      "SELECT method, COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'valid' AND payment_date = ? GROUP BY method"
    ).all(today) as { method: string; s: number }[]
    const paymentsByMethod: Record<string, number> = {}
    for (const r of methodRows) paymentsByMethod[r.method] = r.s
    financial = { revenueToday, collectedToday: revenueToday, outstandingTotal, expensesToday, paymentsByMethod }
  }

  return {
    appointmentsToday,
    appointmentCountToday: appointmentsToday.length,
    completedVisitsToday,
    noShowsToday,
    newPatientsToday,
    waitingQueue,
    upcomingFollowUps,
    lowStockCount,
    outOfStockCount,
    expiringCount,
    financial
  }
}

function mapAppt(r: Record<string, unknown>): AppointmentRow {
  return {
    id: r.id as number,
    patientId: r.patient_id as number,
    dentistId: r.dentist_id as number,
    apptDate: r.appt_date as string,
    apptTime: r.appt_time as string,
    durationMinutes: (r.duration_minutes as number | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    status: r.status as AppointmentRow['status'],
    notes: (r.notes as string | null) ?? null,
    sourceAppointmentId: (r.source_appointment_id as number | null) ?? null,
    cancelledReason: (r.cancelled_reason as string | null) ?? null,
    patientName: r.patientName as string,
    patientCode: r.patientCode as string,
    patientPhone: (r.patientPhone as string | null) ?? null,
    dentistName: r.dentistName as string
  }
}

function mapQueue(r: Record<string, unknown>): QueueEntry {
  return {
    id: r.id as number,
    tokenNo: r.token_no as number,
    queueDate: r.queue_date as string,
    patientId: r.patient_id as number,
    appointmentId: (r.appointment_id as number | null) ?? null,
    dentistId: r.dentist_id as number,
    priority: r.priority as QueueEntry['priority'],
    status: r.status as QueueEntry['status'],
    arrivedAt: r.arrived_at as string,
    calledAt: (r.called_at as string | null) ?? null,
    startedAt: (r.started_at as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    patientName: r.patientName as string,
    patientCode: r.patientCode as string,
    dentistName: r.dentistName as string,
    waitingMinutes: 0
  }
}
