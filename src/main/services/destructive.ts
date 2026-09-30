import type { AppContext, Actor } from '../core/context'
import { errValidation } from '@shared/errors'
import { audit } from './audit'
import { notify } from './notifications'
import { seed } from '../core/seed'

/**
 * Destructive operations (spec §63–64): typed confirmation + mandatory
 * pre-operation backup + audit + notification. Permission `business.delete`
 * is enforced at the router; these functions add the second layer of safety.
 */
export function deleteBusinessData(
  ctx: AppContext,
  actor: Actor,
  scope: 'business' | 'factory',
  confirm: string,
  preBackupFile: string | null
): void {
  const expected = scope === 'business' ? 'DELETE ALL DATA' : 'FACTORY RESET'
  if (confirm !== expected) {
    throw errValidation(`Type "${expected}" exactly to confirm. This action cannot be undone.`)
  }
  if (!preBackupFile) {
    throw errValidation('A pre-operation backup is required before destructive actions. Create a backup first — it protects you if anything goes wrong.')
  }

  const run = ctx.db.transaction(() => {
    if (scope === 'business') {
      // Business data only: patients, clinical, financial, inventory. Users, roles, settings, clinic stay.
      const tables = [
        'stock_movements', 'inventory_batches', 'inventory_items', 'suppliers',
        'financial_transactions', 'payments', 'invoice_lines', 'invoices',
        'referrals', 'attachments', 'prescription_medicines', 'prescriptions',
        'chart_entries', 'visit_treatments', 'visits', 'appointments', 'queue_entries',
        'patients', 'medicines'
      ]
      for (const t of tables) ctx.db.prepare(`DELETE FROM ${t}`).run()
      // Reset counters so new records start from 1 again.
      const settingsRow = ctx.db.prepare("SELECT value FROM settings WHERE key = 'settings'").get() as { value: string } | undefined
      if (settingsRow) {
        const s = JSON.parse(settingsRow.value)
        s.general.patientCodeNext = 1
        s.general.invoiceNext = 1
        s.general.rxNext = 1
        ctx.db.prepare("UPDATE settings SET value = ? WHERE key = 'settings'").run(JSON.stringify(s))
      }
      audit(ctx, actor, { action: 'business_delete', entity: 'database', context: `All business data deleted (pre-op backup: ${preBackupFile})` })
    } else {
      // Factory reset: everything including users, roles, audit config — back to first-run state.
      const tables = [
        'stock_movements', 'inventory_batches', 'inventory_items', 'suppliers',
        'financial_transactions', 'payments', 'invoice_lines', 'invoices',
        'referrals', 'attachments', 'prescription_medicines', 'prescriptions',
        'chart_entries', 'visit_treatments', 'visits', 'appointments', 'queue_entries',
        'patients', 'medicines', 'audit_log', 'notifications', 'backups_metadata',
        'printer_profiles', 'clinical_options', 'tooth_conditions', 'treatments',
        'role_permissions', 'users', 'roles', 'permissions', 'dentist_designations',
        'dentist_qualifications', 'dentists', 'staff', 'clinic', 'activation_state', 'settings'
      ]
      for (const t of tables) ctx.db.prepare(`DELETE FROM ${t}`).run()
      audit(ctx, null, { action: 'reset', entity: 'database', context: `Factory reset by ${actor.username} (pre-op backup: ${preBackupFile})` })
    }
  })
  run()

  if (scope === 'factory') {
    // Re-seed the system tables so the app returns to a working first-run state.
    seed(ctx.db, ctx.clock())
  }

  notify(ctx, {
    type: 'system', severity: 'warning', audience: 'admin',
    title: scope === 'business' ? 'All business data deleted' : 'Factory reset performed',
    body: `Requested by ${actor.username}. A backup taken before this operation is available: ${preBackupFile}`
  })
}
