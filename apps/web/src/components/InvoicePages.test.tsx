// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../api/client'
import { App } from '../App'
import { InvoiceDetailPage, InvoiceGroupPage } from './InvoicePages'
import type { InvoiceDraft, Order, User } from '../api/client'

const warehouse = { id: 'w1', code: 'TAN_XUAN', name: 'TÂN XUÂN' }

const OWNER: User = {
  id: 'user-1', username: 'owner', display_name: 'Owner', role: 'OWNER', roles: ['OWNER'],
  permissions: ['sales.invoice', 'sales.view'], phone: null, status: 'ACTIVE',
}

vi.mock('../api/auth', () => ({
  useAuth: () => ({ user: OWNER, loading: false, logout: vi.fn() }),
}))

vi.mock('html2canvas', () => ({
  default: () => Promise.resolve({ toBlob: (cb: (blob: Blob) => void) => cb(new Blob(['x'], { type: 'image/png' })) }),
}))

vi.mock('../api/media', () => ({
  uploadMediaFile: () => Promise.resolve({ id: 'media-1', view_url: '/media', url: '/media', content_type: 'image/png' }),
  authenticatedMediaFetch: () => Promise.resolve({ blob: () => Promise.resolve(new Blob(['x'])) } as Response),
}))

function makeOrder(id: string, orderNo: string, total: number, hasItems: boolean): Order {
  return {
    id, order_no: orderNo, order_group_id: null, customer_id: 'cust-1', customer_name: 'TEST',
    warehouse, order_type: 'NORMAL', created_date: '2026-10-15', delivery_date: '2026-10-15',
    is_urgent: false, customer_note: null, staff_note: null, status: 'PICKED', claimed_by: null, claimed_by_name: null,
    picked_at: null, total_amount: total, billing_status: 'READY', has_active_items: hasItems,
    paid_amount: 0, invoice_balance_amount: 0, version: 1, created_at: '2026-10-15T00:00:00Z', images: [],
  }
}

function makeDraft(captureStatus: 'NONE' | 'READY' | 'STALE' = 'NONE'): InvoiceDraft {
  return {
    id: 'draft-1', customer_id: 'cust-1', order_ids: ['order-a', 'order-b'],
    customer: { id: 'cust-1', customer_code: 'C1', name: 'TEST', phone: null, address: null },
    orders: [
      { id: 'order-a', order_no: 'HD-A', amount: 100000, status: 'PICKED', billing_status: 'READY',
        delivery_date: '2026-10-15', customer_note: null, images: [],
        items: [{ id: 'item-a', order_id: 'order-a', product_variant_id: null, name: 'SP A', sales_code: null,
          internal_code: null, color: null, size: null, quantity: 2, unit_price_amount: 50000, line_total_amount: 100000 }] },
      { id: 'order-b', order_no: 'HD-B', amount: 40000, status: 'PICKED', billing_status: 'READY',
        delivery_date: '2026-10-15', customer_note: null, images: [],
        items: [{ id: 'item-b', order_id: 'order-b', product_variant_id: null, name: 'SP B', sales_code: null,
          internal_code: null, color: null, size: null, quantity: 4, unit_price_amount: 10000, line_total_amount: 40000 }] },
    ],
    subtotal_amount: 140000, surcharge_amount: 0, return_credit_amount: 0,
    amount_due_before_payment: 140000, debt_before_amount: 0, debt_after_before_payment: 140000,
    invoice_total_amount: 140000, total_debt_amount: 140000, received_amount: 0, remaining_receivable: 140000,
    old_debt_override: null, note: null, payments: [],
    capture_status: captureStatus, capture_media_id: null, captured_image: null,
    finalized_invoice_id: null, finalized_at: null, version: 1,
  }
}

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient
let draftState: InvoiceDraft
let restoreApi: (() => void) | undefined
let draftRequests: Array<{ customer_id: string; order_ids: string[] }>

function render(element: React.ReactNode, initialEntry = '/') {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  root = createRoot(container)
  act(() => root.render(createElement(QueryClientProvider, { client: queryClient },
    createElement(MemoryRouter, { initialEntries: [initialEntry] }, element))))
}

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

async function waitForSelector(selector: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const el = container.querySelector(selector)
    if (el) return el
    await settle()
  }
  throw new Error(`Timed out waiting for ${selector}`)
}

async function waitForText(selector: string, text: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (container.querySelector(selector)?.textContent?.includes(text)) return
    await settle()
  }
  throw new Error(`Timed out waiting for ${selector} to contain ${text}`)
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  draftState = makeDraft('NONE')
  draftRequests = []
  const apiSpy = vi.spyOn(apiClient, 'api').mockImplementation(async <T,>(path: string, opts?: { method?: string; body?: any }) => {
    if (path === '/invoices/work-queue') {
      return { data: { status: 'PENDING', total: 2, groups: [{ customer_id: 'cust-1', customer_name: 'TEST',
        orders: [makeOrder('order-a', 'HD-A', 100000, true), makeOrder('order-b', 'HD-B', 40000, true)] }] } as T }
    }
    if (path.startsWith('/invoices/customers/') && path.endsWith('/pending-orders')) {
      return { data: { customer: { id: 'cust-1', name: 'TEST', phone: null },
        orders: [makeOrder('order-a', 'HD-A', 100000, true), makeOrder('order-b', 'HD-B', 40000, true), makeOrder('order-c', 'HD-C', 4000, false)] } as T }
    }
    if (path === '/invoices/drafts' && opts?.method === 'POST') {
      draftRequests.push(opts.body)
      draftState = makeDraft('NONE')
      return { data: draftState as T }
    }
    if (path === '/invoices/drafts/draft-1' && opts?.method === 'PATCH') {
      if (draftState.capture_status === 'READY') draftState = { ...draftState, capture_status: 'STALE' }
      return { data: draftState as T }
    }
    if (path === '/invoices/drafts/draft-1/capture') {
      draftState = { ...draftState, capture_status: 'READY', capture_media_id: 'media-1',
        captured_image: { id: 'media-1', media_id: 'media-1', url: '/media', view_url: '/media', original_name: 'x.png', content_type: 'image/png' } }
      return { data: draftState as T }
    }
    if (path === '/invoices/drafts/draft-1/finalize') {
      return { data: { ...draftState, finalized_invoice_id: 'inv-1', finalized_at: '2026-10-15T00:00:00Z' } as T }
    }
    if (path === '/invoices/drafts/draft-1') {
      return { data: draftState as T }
    }
    throw new Error(`Unexpected API call: ${path} ${opts?.method ?? 'GET'}`)
  })
  restoreApi = () => apiSpy.mockRestore()
})

afterEach(() => {
  act(() => root.unmount())
  queryClient.clear()
  restoreApi?.()
  container.remove()
})

describe('invoice split flow', () => {
  it('clicking a pending customer navigates to the group page without opening a modal', async () => {
    render(createElement(App), '/invoices')
    await waitForSelector('.invoice-group-head')
    await act(async () => container.querySelector<HTMLButtonElement>('.invoice-group-head')?.click())
    await waitForText('.invoice-page-head h1', 'Gộp hóa đơn theo khách')
    await waitForSelector('.invoice-group-orders')
    expect(container.querySelector('.invoice-form-layer')).toBeNull()
    expect(container.querySelector('.invoice-group-orders')).not.toBeNull()
  })

  it('ticks orders, shows totals, and creates a draft that navigates to the detail page', async () => {
    render(createElement(Routes, null,
      createElement(Route, { path: '/invoices/group/:customerId', element: createElement(InvoiceGroupPage) }),
      createElement(Route, { path: '/invoices/draft/:draftId', element: createElement(InvoiceDetailPage) }),
    ), '/invoices/group/cust-1')
    await waitForSelector('.invoice-group-orders')
    expect(container.querySelectorAll('.invoice-order-option')).toHaveLength(3)

    await act(async () => container.querySelectorAll<HTMLButtonElement>('.invoice-group-tools .btn-outline')[0].click())
    expect(container.querySelector('.invoice-group-summary')?.textContent).toContain('2 đơn đã tick')
    expect(container.querySelector('.invoice-group-summary')?.textContent).toContain('140.000')

    await act(async () => container.querySelector<HTMLButtonElement>('.invoice-group-submit')?.click())
    await waitForText('.invoice-page-head h1', 'CHI TIẾT HÓA ĐƠN')
    expect(container.querySelector('.bill-table')).not.toBeNull()
    // Chỉ các đơn hợp lệ được tick được gửi đi; order không hợp lệ (order-c) không được gửi.
    expect(draftRequests).toHaveLength(1)
    expect(draftRequests[0].order_ids).toEqual(['order-a', 'order-b'])
  })

  it('surfaces the backend error message instead of a generic fallback', async () => {
    const apiSpy = vi.spyOn(apiClient, 'api')
    apiSpy.mockImplementation(async <T,>(path: string, opts?: { method?: string; body?: any }) => {
      if (path.startsWith('/invoices/customers/') && path.endsWith('/pending-orders')) {
        return { data: { customer: { id: 'cust-1', name: 'TEST', phone: null },
          orders: [makeOrder('order-a', 'HD-A', 100000, true), makeOrder('order-b', 'HD-B', 40000, false)] } as T }
      }
      if (path === '/invoices/drafts' && opts?.method === 'POST') {
        const error = new apiClient.ApiError(409, 'ORDER_ITEMS_REQUIRED', 'Đơn HD-B chưa có chi tiết soạn.', {})
        throw error
      }
      throw new Error(`Unexpected API call: ${path}`)
    })
    render(createElement(Routes, null,
      createElement(Route, { path: '/invoices/group/:customerId', element: createElement(InvoiceGroupPage) }),
    ), '/invoices/group/cust-1')
    await waitForSelector('.invoice-group-orders')
    await act(async () => container.querySelector<HTMLInputElement>('.invoice-order-option input')?.click())
    await act(async () => container.querySelector<HTMLButtonElement>('.invoice-group-submit')?.click())
    await waitForText('.pick-error', 'Đơn HD-B chưa có chi tiết soạn.')
    apiSpy.mockRestore()
  })

  it('computes remaining receivable from total debt, not invoice total alone', async () => {
    draftState = { ...makeDraft('NONE'), amount_due_before_payment: 9, debt_before_amount: 5227,
      debt_after_before_payment: 5236, invoice_total_amount: 9, total_debt_amount: 5236,
      received_amount: 0, remaining_receivable: 5236 }
    render(createElement(Routes, null,
      createElement(Route, { path: '/invoices/draft/:draftId', element: createElement(InvoiceDetailPage) }),
    ), '/invoices/draft/draft-1')
    await waitForSelector('.bill-total-final')
    expect(container.querySelector('.bill-total-final')?.textContent).toContain('5.236')
    expect(container.querySelector('.bill-payment-foot')?.textContent).toContain('5.236')
  })

  it('keeps finalize disabled until capture, then enabled after capture', async () => {
    render(createElement(Routes, null,
      createElement(Route, { path: '/invoices/draft/:draftId', element: createElement(InvoiceDetailPage) }),
    ), '/invoices/draft/draft-1')
    await waitForSelector('.invoice-form-actions .btn-main')
    const finalizeButton = () => container.querySelector<HTMLButtonElement>('.invoice-form-actions .btn-main')

    expect(finalizeButton()?.disabled).toBe(true)

    await act(async () => container.querySelector<HTMLButtonElement>('.btn-capture')?.click())
    await waitForText('.invoice-capture-tools', 'Đã chụp hóa đơn')
    expect(finalizeButton()?.disabled).toBe(false)
  })

  it('invalidates capture and disables finalize after editing', async () => {
    draftState = makeDraft('READY')
    draftState.captured_image = { id: 'media-1', media_id: 'media-1', url: '/media', view_url: '/media', original_name: 'x.png', content_type: 'image/png' }
    render(createElement(Routes, null,
      createElement(Route, { path: '/invoices/draft/:draftId', element: createElement(InvoiceDetailPage) }),
    ), '/invoices/draft/draft-1')
    await waitForSelector('.invoice-form-actions .btn-main')
    expect(container.querySelector<HTMLButtonElement>('.invoice-form-actions .btn-main')?.disabled).toBe(false)

    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('.btn-outline')).find(b => b.textContent?.includes('Sửa đơn'))?.click())
    await waitForSelector('.bill-table td input')
    const qtyInput = container.querySelector<HTMLInputElement>('.bill-table td input')
    await act(async () => {
      qtyInput!.value = '3'
      qtyInput!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => container.querySelector<HTMLButtonElement>('.invoice-form-actions .btn-main')?.click())
    await waitForSelector('.invoice-form-actions .btn-main')
    expect(container.querySelector('.invoice-order-warning')).not.toBeNull()
    expect(container.querySelector<HTMLButtonElement>('.invoice-form-actions .btn-main')?.disabled).toBe(true)
  })
})
