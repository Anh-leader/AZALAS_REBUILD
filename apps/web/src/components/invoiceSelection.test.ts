import { describe, expect, it } from 'vitest'
import { partitionSelectedInvoiceOrders } from './invoiceSelection'

const orders = [
  { id: 'valid-a', order_no: 'HD-A', has_active_items: true },
  { id: 'invalid', order_no: 'HD-EMPTY', has_active_items: false },
  { id: 'valid-b', order_no: 'HD-B', has_active_items: true },
]

describe('partitionSelectedInvoiceOrders', () => {
  it('retains valid selected orders and isolates an incomplete order', () => {
    const result = partitionSelectedInvoiceOrders(orders, ['valid-a', 'invalid', 'valid-b'])
    expect(result.eligible.map(order => order.id)).toEqual(['valid-a', 'valid-b'])
    expect(result.missingItems.map(order => order.order_no)).toEqual(['HD-EMPTY'])
  })

  it('returns no eligible orders when all selected orders lack items', () => {
    const result = partitionSelectedInvoiceOrders(orders, ['invalid'])
    expect(result.eligible).toEqual([])
    expect(result.missingItems).toEqual([orders[1]])
  })

  it('returns an empty selection when nothing is checked', () => {
    expect(partitionSelectedInvoiceOrders(orders, [])).toEqual({
      selected: [], eligible: [], missingItems: [],
    })
  })
})
