import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestEnv, completeSetupLogin, type TestEnv } from './helpers'
import { supplierSave, supplierList, inventorySaveItem, inventoryAddBatch, inventoryMove, inventoryItems, inventoryItemDetail, inventoryAlerts } from '../src/main/services/inventory'
import { getSettings, updateSettings } from '../src/main/services/settings'

let env: TestEnv

beforeAll(() => {
  env = createTestEnv()
  completeSetupLogin(env)
})

afterAll(() => {
  env.cleanup()
})

describe('inventory: suppliers', () => {
  it('creates and lists suppliers', () => {
    const s = supplierSave(env.ctx, env.owner, { name: 'Dental Supply BD', contactPerson: 'Rafiq', phone: '01712000000' })
    expect(s.id).toBeTruthy()
    expect(supplierList(env.ctx).length).toBe(1)
  })
})

describe('inventory: items, batches, FIFO consumption', () => {
  it('creates an item with unique SKU enforcement', () => {
    const item = inventorySaveItem(env.ctx, env.owner, { name: 'Nitrile Gloves (M)', sku: 'GLV-M-001', unit: 'box', reorderThreshold: 5 })
    expect(item.id).toBeTruthy()
    expect(() => inventorySaveItem(env.ctx, env.owner, { name: 'Dup', sku: 'GLV-M-001', unit: 'box', reorderThreshold: 1 })).toThrowError(/already in use/)
  })

  it('adds batches and records stock-in movements', () => {
    const item = inventoryItems(env.ctx, { page: 1, pageSize: 10, search: 'GLV-M-001' }).rows[0]
    const supplier = supplierList(env.ctx)[0]
    const b1 = inventoryAddBatch(env.ctx, env.owner, {
      itemId: item.id, supplierId: supplier.id, purchaseDate: '2026-01-05', batchNo: 'B-OLD',
      expiryDate: '2027-01-01', purchaseCost: 450000, qtyPurchased: 10
    })
    expect(b1.qtyCurrent).toBe(10)
    const b2 = inventoryAddBatch(env.ctx, env.owner, {
      itemId: item.id, supplierId: supplier.id, purchaseDate: '2026-02-10', batchNo: 'B-NEW',
      expiryDate: '2027-06-01', purchaseCost: 500000, qtyPurchased: 10
    })
    expect(b2.qtyCurrent).toBe(10)
    const detail = inventoryItemDetail(env.ctx, item.id)
    expect(detail.item.currentStock).toBe(20)
    expect(detail.movements.filter((m) => m.type === 'in').length).toBe(2)
  })

  it('consumes FIFO from the oldest batch when no batch is specified', () => {
    const item = inventoryItems(env.ctx, { page: 1, pageSize: 10, search: 'GLV-M-001' }).rows[0]
    // Consume 12: 10 from B-OLD (depleted) + 2 from B-NEW.
    inventoryMove(env.ctx, env.owner, { itemId: item.id, type: 'usage', quantity: 12, reason: 'Chairside use' })
    const detail = inventoryItemDetail(env.ctx, item.id)
    const oldBatch = detail.batches.find((b) => b.batchNo === 'B-OLD')
    const newBatch = detail.batches.find((b) => b.batchNo === 'B-NEW')
    expect(oldBatch?.status).toBe('depleted')
    expect(oldBatch?.qtyCurrent).toBe(0)
    expect(newBatch?.qtyCurrent).toBe(8)
    expect(detail.item.currentStock).toBe(8)
  })

  it('never lets stock go negative', () => {
    const item = inventoryItems(env.ctx, { page: 1, pageSize: 10, search: 'GLV-M-001' }).rows[0]
    expect(() => inventoryMove(env.ctx, env.owner, { itemId: item.id, type: 'usage', quantity: 100 })).toThrowError(/not enough stock|insufficient|negative/i)
    const detail = inventoryItemDetail(env.ctx, item.id)
    expect(detail.item.currentStock).toBe(8)
  })

  it('adjust sets an absolute quantity', () => {
    const item = inventoryItems(env.ctx, { page: 1, pageSize: 10, search: 'GLV-M-001' }).rows[0]
    const detail0 = inventoryItemDetail(env.ctx, item.id)
    const activeBatch = detail0.batches.find((b) => b.status === 'active')
    inventoryMove(env.ctx, env.owner, { itemId: item.id, batchId: activeBatch!.id, type: 'adjust', quantity: 3, reason: 'Physical count' })
    const detail = inventoryItemDetail(env.ctx, item.id)
    expect(detail.item.currentStock).toBe(3)
  })

  it('flags low stock and expiring batches via alerts', () => {
    const alerts = inventoryAlerts(env.ctx)
    const item = inventoryItems(env.ctx, { page: 1, pageSize: 10, search: 'GLV-M-001' }).rows[0]
    expect(alerts.lowStock.some((a) => a.id === item.id && a.currentStock <= a.reorderThreshold)).toBe(true)

    // B-OLD (already depleted) should not appear as expiring; add a soon-expiring batch to a new item.
    const item2 = inventorySaveItem(env.ctx, env.owner, { name: 'Anesthetic Carpule', sku: 'ANA-001', unit: 'box', reorderThreshold: 2 })
    const soon = new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    inventoryAddBatch(env.ctx, env.owner, { itemId: item2.id, purchaseDate: '2026-01-01', expiryDate: soon, purchaseCost: 100000, qtyPurchased: 50 })
    const alerts2 = inventoryAlerts(env.ctx)
    const days = getSettings(env.ctx).notifications.expiryDays
    expect(alerts2.expiringSoon.some((a) => a.itemId === item2.id)).toBe(days >= 20)

    // past expiry → expired
    const item3 = inventorySaveItem(env.ctx, env.owner, { name: 'Old Gauze', sku: 'GAU-001', unit: 'pack', reorderThreshold: 1 })
    inventoryAddBatch(env.ctx, env.owner, { itemId: item3.id, purchaseDate: '2025-01-01', expiryDate: '2025-06-01', purchaseCost: 50000, qtyPurchased: 5 })
    const alerts3 = inventoryAlerts(env.ctx)
    expect(alerts3.expired.some((a) => a.itemId === item3.id)).toBe(true)
  })

  it('respects a changed expiryDays setting', () => {
    updateSettings(env.ctx, env.owner, 'notifications', { expiryDays: 60 })
    const alerts = inventoryAlerts(env.ctx)
    const item2 = inventoryItems(env.ctx, { page: 1, pageSize: 10, search: 'ANA-001' }).rows[0]
    expect(alerts.expiringSoon.some((a) => a.itemId === item2.id)).toBe(true)
  })
})
