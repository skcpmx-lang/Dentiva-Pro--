import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errConflict } from '@shared/errors'
import type { InventoryItemInput, BatchInput, StockMovePayload } from '@shared/ipc'
import type { InventoryItem, InventoryBatch, StockMovement, InventoryAlerts, Supplier } from '@shared/types'
import { daysBetween, todayISO, isValidDateStr } from '@shared/dates'
import { getSettings } from './settings'
import { audit } from './audit'

/* ---------------- Suppliers ---------------- */

function mapSupplier(r: Record<string, unknown>): Supplier {
  return {
    id: r.id as number,
    name: r.name as string,
    contactPerson: (r.contact_person as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    isActive: r.is_active === 1
  }
}

export function supplierList(ctx: AppContext): Supplier[] {
  return (ctx.db.prepare('SELECT * FROM suppliers ORDER BY name COLLATE NOCASE').all() as Record<string, unknown>[]).map(mapSupplier)
}

const supplierSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(2).max(160),
  contactPerson: z.string().max(120).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().optional()
})

export function supplierSave(ctx: AppContext, actor: Actor, input: Record<string, unknown>): Supplier {
  const res = supplierSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid supplier.')
  const d = res.data
  const run = ctx.db.transaction((): number => {
    let id = d.id
    if (id) {
      if (!ctx.db.prepare('SELECT id FROM suppliers WHERE id = ?').get(id)) throw errNotFound('Supplier not found.')
      ctx.db.prepare('UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, address = ?, notes = ?, is_active = ? WHERE id = ?')
        .run(d.name, d.contactPerson ?? null, d.phone ?? null, d.address ?? null, d.notes ?? null, d.isActive === false ? 0 : 1, id)
      audit(ctx, actor, { action: 'update', entity: 'supplier', entityId: id, newValue: d })
    } else {
      const r = ctx.db.prepare('INSERT INTO suppliers (name, contact_person, phone, address, notes, is_active) VALUES (?, ?, ?, ?, ?, ?)')
        .run(d.name, d.contactPerson ?? null, d.phone ?? null, d.address ?? null, d.notes ?? null, d.isActive === false ? 0 : 1)
      id = Number(r.lastInsertRowid)
      audit(ctx, actor, { action: 'create', entity: 'supplier', entityId: id, newValue: d })
    }
    return id!
  })
  return mapSupplier(ctx.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(run()) as Record<string, unknown>)
}

export function supplierDelete(ctx: AppContext, actor: Actor, id: number): void {
  const existing = ctx.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id)
  if (!existing) throw errNotFound('Supplier not found.')
  const used = ctx.db.prepare('SELECT COUNT(*) AS c FROM inventory_batches WHERE supplier_id = ?').get(id) as { c: number }
  const run = ctx.db.transaction(() => {
    if (used.c > 0) ctx.db.prepare('UPDATE inventory_batches SET supplier_id = NULL WHERE supplier_id = ?').run(id)
    ctx.db.prepare('DELETE FROM suppliers WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'supplier', entityId: id, oldValue: existing })
  })
  run()
}

/* ---------------- Items ---------------- */

function currentStock(ctx: AppContext, itemId: number): number {
  return (ctx.db.prepare('SELECT COALESCE(SUM(qty_current),0) AS s FROM inventory_batches WHERE item_id = ? AND status = \'active\'').get(itemId) as { s: number }).s
}

function mapItem(r: Record<string, unknown>, stock: number, threshold: number): InventoryItem {
  return {
    id: r.id as number,
    name: r.name as string,
    sku: r.sku as string,
    category: (r.category as string | null) ?? null,
    unit: r.unit as string,
    reorderThreshold: threshold,
    notes: (r.notes as string | null) ?? null,
    isActive: r.is_active === 1,
    currentStock: stock,
    stockStatus: stock <= 0 ? 'out' : stock <= threshold ? 'low' : 'ok'
  }
}

export function inventoryItems(ctx: AppContext, opts: { search?: string; activeOnly?: boolean; page: number; pageSize: number }) {
  const page = Math.max(1, opts.page | 0 || 1)
  const pageSize = Math.min(200, Math.max(5, opts.pageSize | 0 || 25))
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (opts.activeOnly) where.push('is_active = 1')
  if (opts.search) {
    const s = opts.search.replace(/[\\%_]/g, (c) => `\\${c}`)
    where.push('(name LIKE $q ESCAPE "\\" OR sku LIKE $q ESCAPE "\\" OR category LIKE $q ESCAPE "\\")')
    params.$q = `%${s}%`
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS c FROM inventory_items ${whereSql}`).get(params) as { c: number }).c
  const rows = ctx.db.prepare(`SELECT * FROM inventory_items ${whereSql} ORDER BY name COLLATE NOCASE LIMIT $limit OFFSET $offset`)
    .all({ ...params, $limit: pageSize, $offset: (page - 1) * pageSize }) as Record<string, unknown>[]
  return {
    rows: rows.map((r) => mapItem(r, currentStock(ctx, r.id as number), r.reorder_threshold as number)),
    total, page, pageSize
  }
}

const itemSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(2).max(160),
  sku: z.string().trim().min(1).max(40),
  category: z.string().max(60).nullable().optional(),
  unit: z.string().trim().min(1).max(20),
  reorderThreshold: z.number().int().min(0).max(1000000),
  notes: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().optional()
})

export function inventorySaveItem(ctx: AppContext, actor: Actor, input: InventoryItemInput): InventoryItem {
  const res = itemSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid inventory item.')
  const d = res.data
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const id = ctx.db.transaction((): number => {
    let itemId = d.id
    const dup = ctx.db.prepare('SELECT id FROM inventory_items WHERE sku = ? AND id != ?').get(d.sku, itemId ?? -1)
    if (dup) throw errConflict(`SKU "${d.sku}" is already in use.`)
    if (itemId) {
      if (!ctx.db.prepare('SELECT id FROM inventory_items WHERE id = ?').get(itemId)) throw errNotFound('Item not found.')
      ctx.db.prepare('UPDATE inventory_items SET name = ?, sku = ?, category = ?, unit = ?, reorder_threshold = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?')
        .run(d.name, d.sku, d.category ?? null, d.unit, d.reorderThreshold, d.notes ?? null, d.isActive === false ? 0 : 1, ts, itemId)
      audit(ctx, actor, { action: 'update', entity: 'inventory_item', entityId: itemId, newValue: d })
    } else {
      const r = ctx.db.prepare('INSERT INTO inventory_items (name, sku, category, unit, reorder_threshold, notes, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(d.name, d.sku, d.category ?? null, d.unit, d.reorderThreshold, d.notes ?? null, d.isActive === false ? 0 : 1, ts, ts)
      itemId = Number(r.lastInsertRowid)
      audit(ctx, actor, { action: 'create', entity: 'inventory_item', entityId: itemId, newValue: d })
    }
    return itemId!
  })()
  const row = ctx.db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as Record<string, unknown>
  return mapItem(row, currentStock(ctx, id), row.reorder_threshold as number)
}

function mapBatch(r: Record<string, unknown>): InventoryBatch {
  return {
    id: r.id as number,
    itemId: r.item_id as number,
    supplierId: (r.supplier_id as number | null) ?? null,
    supplierName: (r.supplierName as string | null) ?? null,
    purchaseDate: r.purchase_date as string,
    batchNo: (r.batch_no as string | null) ?? null,
    expiryDate: (r.expiry_date as string | null) ?? null,
    purchaseCost: r.purchase_cost as number,
    qtyPurchased: r.qty_purchased as number,
    qtyCurrent: r.qty_current as number,
    status: r.status as InventoryBatch['status'],
    createdAt: r.created_at as string
  }
}

const batchSchema = z.object({
  itemId: z.number().int().positive(),
  supplierId: z.number().int().positive().nullable().optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  batchNo: z.string().max(60).nullable().optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  purchaseCost: z.number().int().min(0),
  qtyPurchased: z.number().int().min(1).max(1000000)
})

export function inventoryAddBatch(ctx: AppContext, actor: Actor, input: BatchInput): InventoryBatch {
  const res = batchSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid batch information.')
  const d = res.data
  if (!isValidDateStr(d.purchaseDate)) throw errValidation('Invalid purchase date.')
  if (d.expiryDate && !isValidDateStr(d.expiryDate)) throw errValidation('Invalid expiry date.')
  if (!ctx.db.prepare('SELECT id FROM inventory_items WHERE id = ?').get(d.itemId)) throw errNotFound('Inventory item not found.')
  if (d.supplierId && !ctx.db.prepare('SELECT id FROM suppliers WHERE id = ?').get(d.supplierId)) throw errNotFound('Supplier not found.')
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const id = ctx.db.transaction((): number => {
    const r = ctx.db.prepare(`
      INSERT INTO inventory_batches (item_id, supplier_id, purchase_date, batch_no, expiry_date, purchase_cost, qty_purchased, qty_current, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(d.itemId, d.supplierId ?? null, d.purchaseDate, d.batchNo ?? null, d.expiryDate ?? null, d.purchaseCost, d.qtyPurchased, d.qtyPurchased, ts)
    const batchId = Number(r.lastInsertRowid)
    ctx.db.prepare(`
      INSERT INTO stock_movements (item_id, batch_id, type, quantity, reason, reference, created_by, created_at)
      VALUES (?, ?, 'in', ?, 'Purchase received', ?, ?, ?)
    `).run(d.itemId, batchId, d.qtyPurchased, d.batchNo ?? null, actor.userId, ts)
    audit(ctx, actor, { action: 'create', entity: 'inventory_batch', entityId: batchId, newValue: d })
    return batchId
  })()
  return mapBatch(ctx.db.prepare(`
    SELECT b.*, s.name AS supplierName FROM inventory_batches b LEFT JOIN suppliers s ON s.id = b.supplier_id WHERE b.id = ?
  `).get(id) as Record<string, unknown>)
}

const moveSchema = z.object({
  itemId: z.number().int().positive(),
  batchId: z.number().int().positive().nullable().optional(),
  type: z.enum(['in', 'out', 'adjust', 'damaged', 'expired', 'returned', 'usage']),
  quantity: z.number().int(),
  reason: z.string().max(300).nullable().optional(),
  reference: z.string().max(100).nullable().optional()
})

export function inventoryMove(ctx: AppContext, actor: Actor, payload: StockMovePayload): void {
  const res = moveSchema.safeParse(payload)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid stock movement.')
  const d = res.data
  const decreases = ['out', 'damaged', 'expired', 'returned', 'usage']
  if (d.quantity === 0) throw errValidation('Quantity cannot be zero.')
  if (decreases.includes(d.type) && d.quantity <= 0) {
    throw errValidation(`For "${d.type}" movements the quantity must be a positive number of units to remove.`)
  }
  if (d.type === 'in' && d.quantity <= 0) throw errValidation('Stock-in quantity must be positive.')

  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    const item = ctx.db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(d.itemId) as Record<string, unknown> | undefined
    if (!item) throw errNotFound('Inventory item not found.')
    let batchId = d.batchId ?? null
    if (batchId) {
      const batch = ctx.db.prepare('SELECT * FROM inventory_batches WHERE id = ? AND item_id = ?').get(batchId, d.itemId) as Record<string, unknown> | undefined
      if (!batch) throw errNotFound('Batch not found for this item.')
    } else if (decreases.includes(d.type)) {
      // FIFO consumption from oldest active batches with stock.
      const batches = ctx.db.prepare(
        "SELECT id, qty_current FROM inventory_batches WHERE item_id = ? AND status = 'active' AND qty_current > 0 ORDER BY purchase_date, id"
      ).all(d.itemId) as { id: number; qty_current: number }[]
      let remaining = d.quantity
      for (const b of batches) {
        if (remaining <= 0) break
        const take = Math.min(b.qty_current, remaining)
        const newQty = b.qty_current - take
        ctx.db.prepare('UPDATE inventory_batches SET qty_current = ?, status = ? WHERE id = ?')
          .run(newQty, newQty <= 0 ? 'depleted' : 'active', b.id)
        remaining -= take
      }
      if (remaining > 0) {
        throw errValidation(`Insufficient stock: only ${d.quantity - remaining} unit(s) available. Stock cannot go negative.`)
      }
      ctx.db.prepare(`
        INSERT INTO stock_movements (item_id, batch_id, type, quantity, reason, reference, created_by, created_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
      `).run(d.itemId, d.type, d.quantity, d.reason ?? null, d.reference ?? null, actor.userId, ts)
      audit(ctx, actor, { action: 'update', entity: 'stock', entityId: d.itemId, newValue: { type: d.type, quantity: d.quantity } })
      return
    }

    if (batchId) {
      const batch = ctx.db.prepare('SELECT qty_current FROM inventory_batches WHERE id = ?').get(batchId) as { qty_current: number }
      let newQty = batch.qty_current
      if (d.type === 'in') newQty += d.quantity
      else if (d.type === 'adjust') newQty = d.quantity // adjust sets the absolute batch quantity
      else newQty -= d.quantity
      if (newQty < 0) throw errValidation(`Insufficient stock in this batch (${batch.qty_current} available). Stock cannot go negative.`)
      ctx.db.prepare('UPDATE inventory_batches SET qty_current = ?, status = ? WHERE id = ?')
        .run(newQty, newQty <= 0 ? 'depleted' : 'active', batchId)
    }
    ctx.db.prepare(`
      INSERT INTO stock_movements (item_id, batch_id, type, quantity, reason, reference, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(d.itemId, batchId, d.type, d.quantity, d.reason ?? null, d.reference ?? null, actor.userId, ts)
    audit(ctx, actor, { action: 'update', entity: 'stock', entityId: d.itemId, newValue: { type: d.type, quantity: d.quantity, batchId } })
  })
  run()
}

export function inventoryItemDetail(ctx: AppContext, id: number): { item: InventoryItem; batches: InventoryBatch[]; movements: StockMovement[] } {
  const row = ctx.db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw errNotFound('Inventory item not found.')
  const batches = (ctx.db.prepare(`
    SELECT b.*, s.name AS supplierName FROM inventory_batches b LEFT JOIN suppliers s ON s.id = b.supplier_id
    WHERE b.item_id = ? ORDER BY b.purchase_date DESC, b.id DESC
  `).all(id) as Record<string, unknown>[]).map(mapBatch)
  const movements = (ctx.db.prepare(`
    SELECT m.*, i.name AS itemName FROM stock_movements m JOIN inventory_items i ON i.id = m.item_id
    WHERE m.item_id = ? ORDER BY m.created_at DESC LIMIT 200
  `).all(id) as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    itemId: r.item_id as number,
    itemName: r.itemName as string,
    batchId: (r.batch_id as number | null) ?? null,
    type: r.type as StockMovement['type'],
    quantity: r.quantity as number,
    reason: (r.reason as string | null) ?? null,
    reference: (r.reference as string | null) ?? null,
    createdBy: '—',
    createdAt: r.created_at as string
  }))
  return { item: mapItem(row, currentStock(ctx, id), row.reorder_threshold as number), batches, movements }
}

export function inventoryAlerts(ctx: AppContext): InventoryAlerts {
  const thresholdDays = getSettings(ctx).notifications.expiryDays
  const today = todayISO(ctx.clock())
  const items = (ctx.db.prepare('SELECT * FROM inventory_items WHERE is_active = 1').all() as Record<string, unknown>[])
    .map((r) => mapItem(r, currentStock(ctx, r.id as number), r.reorder_threshold as number))
  const lowStock = items.filter((i) => i.stockStatus === 'low')
  const outOfStock = items.filter((i) => i.stockStatus === 'out')
  const batchRows = ctx.db.prepare(`
    SELECT b.*, i.name AS itemName FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
    WHERE b.status = 'active' AND b.expiry_date IS NOT NULL AND b.qty_current > 0 ORDER BY b.expiry_date
  `).all() as (Record<string, unknown> & { itemName: string })[]
  const expiringSoon: (InventoryBatch & { itemName: string; daysToExpiry: number })[] = []
  const expired: (InventoryBatch & { itemName: string; daysToExpiry: number })[] = []
  for (const r of batchRows) {
    const b = mapBatch(r)
    const days = daysBetween(today, b.expiryDate!)
    const withDays = { ...b, itemName: r.itemName, daysToExpiry: days }
    if (days < 0) expired.push(withDays)
    else if (days <= thresholdDays) expiringSoon.push(withDays)
  }
  return { lowStock, outOfStock, expiringSoon, expired }
}
