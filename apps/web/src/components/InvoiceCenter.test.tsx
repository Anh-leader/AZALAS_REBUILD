// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../api/client'
import { InvoicePage } from './InvoiceCenter'
import type { DeletedOrderDetail, Invoice, InvoiceDetail, Order, User } from '../api/client'

const warehouse = { id: 'w1', code: 'TAN_XUAN', name: 'TÂN XUÂN' }

const OWNER: User = {
  id: 'user-1', username: 'owner', display_name: 'Owner', role: 'OWNER', roles: ['OWNER'],
  permissions: ['sales.invoice', 'sales.view'], phone: null, status: 'ACTIVE',
}

vi.mock('../api/auth', () => ({
  useAuth: () => ({ user: OWNER, loading: false, logout: vi.fn() }),
}))

vi.mock('../api/media', () => ({
  authenticatedMediaFetch: () => Promise.resolve({ blob: () => Promise.resolve(new Blob(['x'])) } as Response),
  openAuthenticatedMedia: vi.fn(() => Promise.resolve()),
}))

function makeInvoice(id: string, no: string, status: string): Invoice {
  return {
    id, invoice_no: no, customer_id: 'cust-1', status, issued_at: '2026-10-15T00:00:00Z',
    subtotal_amount: 100000, surcharge_amount: 0, return_credit_amount: 0, paid_amount: 0,
    balance_amount: 100000, debt_before_amount: 0, debt_after_amount: 100000, note: null,
    version: 1, order_ids: ['order-a'], allocated_amount: 0, unallocated_credit_amount: 0,
    snapshot: { customer: { id: 'cust-1', customer_code: 'C1', name: 'TEST', phone: null, address: null } },
    captured_invoice_media_id: null, captured_at: null, captured_image: null,
  }
}

function makeInvoiceDetail(status: string): InvoiceDetail {
  return {
    id: 'inv-1', invoice_no: 'INV-1', customer_id: 'cust-1', status, created_at: '2026-10-15T00:00:00Z',
    issued_at: '2026-10-15T00:00:00Z',
    customer: { id: 'cust-1', customer_code: 'C1', name: 'TEST', phone: null, address: null },
    warehouse, warehouses: [warehouse], created_by: { id: 'user-1', display_name: 'Owner' },
    orders: [{ id: 'order-a', order_no: 'HD-A', warehouse, created_date: '2026-10-10', delivery_date: null, status: 'PICKED', billing_status: 'PAID', total_amount: 100000 }],
    items: [{ order_no: 'HD-A', name: 'SP A', sales_code: 'SC1', internal_code: null, color: 'Đỏ', size: 'M', quantity: 2, unit_price_amount: 50000, line_total_amount: 100000 }],
    subtotal_amount: 100000, surcharge_amount: 0, return_credit_amount: 0, total_amount: 100000,
    paid_amount: 0, balance_amount: 100000, debt_before_amount: 0, debt_after_amount: 100000,
    old_debt_snapshot: null, old_debt_override: null, old_debt_applied_delta: null, invoice_image_path: null,
    payments: [], captured_invoice_media_id: null, captured_at: null, captured_image: null, snapshot: {},
  }
}

function makeDeletedOrderDetail(): DeletedOrderDetail {
  return {
    id: 'order-a', order_no: 'HD-A', customer: { id: 'cust-1', customer_code: 'C1', name: 'TEST' },
    warehouse, created_at: '2026-10-15T00:00:00Z', created_date: '2026-10-10',
    previous_status: 'PICKED', current_status: 'PICKED', billing_status: 'DELETED', total_amount: 100000,
    items: [{ id: 'item-a', name: 'SP A', sales_code: 'SC1', internal_code: null, color: 'Đỏ', size: 'M', quantity: 2, unit_price_amount: 50000, line_total_amount: 100000 }],
    related_invoice: null, deleted_at: '2026-10-16T00:00:00Z', delete_reason: null,
    deleted_by: { id: 'user-1', display_name: 'Owner' },
  }
}

function makeDeletedOrder(id: string, no: string): Order {
  return {
    id, order_no: no, order_group_id: null, customer_id: 'cust-1', customer_name: 'TEST',
    warehouse, order_type: 'NORMAL', created_date: '2026-10-10', delivery_date: null,
    is_urgent: false, customer_note: null, staff_note: null, status: 'PICKED', claimed_by: null,
    claimed_by_name: null, picked_at: null, total_amount: 100000, billing_status: 'DELETED',
    paid_amount: 0, invoice_balance_amount: 0, version: 1, created_at: '2026-10-15T00:00:00Z', images: [],
  }
}

// Mô phỏng response thiếu field (old backend shape) và null snapshot.
function makeSparseDetail(overrides: Record<string, any> = {}): any {
  return {
    id: 'inv-1', invoice_no: 'INV-1', customer_id: 'cust-1', status: 'SENT',
    created_at: '2026-10-15T00:00:00Z', issued_at: '2026-10-15T00:00:00Z',
    subtotal_amount: 100000, surcharge_amount: 0, return_credit_amount: 0, total_amount: 100000,
    paid_amount: 0, balance_amount: 100000, debt_before_amount: 0, debt_after_amount: 100000,
    old_debt_snapshot: null, old_debt_override: null, old_debt_applied_delta: null, invoice_image_path: null,
    captured_invoice_media_id: null, captured_at: null, captured_image: null, snapshot: null,
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient
let restoreApi: (() => void) | undefined

let detailData: any
let detailReject: Error | null
let detailPending: Promise<{ data: any }> | null
let deletedDetailData: any

function render(element: React.ReactNode) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  root = createRoot(container)
  act(() => root.render(createElement(QueryClientProvider, { client: queryClient },
    createElement(MemoryRouter, { initialEntries: ['/invoices'] }, element))))
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

function clickByText(selector: string, text: string) {
  const el = Array.from(container.querySelectorAll<HTMLButtonElement>(selector)).find(btn => btn.textContent?.includes(text))
  if (!el) throw new Error(`No ${selector} with text ${text}`)
  return act(async () => el.click())
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  detailData = makeInvoiceDetail('SENT')
  detailReject = null
  detailPending = null
  deletedDetailData = makeDeletedOrderDetail()
  const apiSpy = vi.spyOn(apiClient, 'api').mockImplementation(async <T,>(path: string, opts?: { method?: string; query?: Record<string, string | undefined | null> }) => {
    if (path === '/invoices/work-queue') {
      if (opts?.query?.status === 'SENT') {
        return { data: { status: 'SENT', total: 1, groups: [{ customer_id: 'cust-1', customer_name: 'TEST', invoices: [makeInvoice('inv-1', 'INV-1', 'SENT')] }] } as T }
      }
      if (opts?.query?.status === 'DELETED') {
        return { data: { status: 'DELETED', total: 1, groups: [{ customer_id: 'cust-1', customer_name: 'TEST', orders: [makeDeletedOrder('order-a', 'HD-A')] }] } as T }
      }
      return { data: { status: 'PENDING', total: 0, groups: [] } as T }
    }
    if (path === '/invoices/inv-1') {
      if (detailReject) throw detailReject
      if (detailPending) return detailPending as any
      return { data: detailData as T }
    }
    if (path === '/orders/order-a/deleted-detail') return { data: deletedDetailData as T }
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

describe('invoice center detail views', () => {
  it('opens a read-only invoice detail modal from the Sent tab and shows missing-image empty state', async () => {
    render(createElement(InvoicePage, { go: () => {} }))
    await waitForSelector('.invoice-tabs')
    await clickByText('.invoice-tabs button', 'Đã gửi đơn')
    await waitForSelector('.invoice-sent-row')
    await clickByText('.invoice-sent-row .btn-outline', 'Xem')
    await waitForSelector('.invoice-detail-modal')
    await waitForText('.invoice-detail-modal', 'Chi tiết hóa đơn')
    await waitForText('.invoice-detail-modal', 'TEST')
    await waitForText('.invoice-detail-modal', 'Chưa có ảnh hóa đơn')
  })

  it('opens a read-only deleted order detail modal from the Deleted tab', async () => {
    render(createElement(InvoicePage, { go: () => {} }))
    await waitForSelector('.invoice-tabs')
    await clickByText('.invoice-tabs button', 'Đơn đã xóa')
    await waitForSelector('.invoice-deleted-row')
    await clickByText('.invoice-deleted-row .btn-outline', 'Xem chi tiết')
    await waitForSelector('.invoice-detail-modal')
    await waitForText('.invoice-detail-modal', 'Chi tiết đơn đã xóa')
    await waitForText('.invoice-detail-modal', 'HD-A')
    await waitForText('.invoice-detail-modal', 'Owner')
  })

  it('does not crash when invoice detail is missing orders/items/payments and snapshot is null', async () => {
    detailData = makeSparseDetail()
    render(createElement(InvoicePage, { go: () => {} }))
    await waitForSelector('.invoice-tabs')
    await clickByText('.invoice-tabs button', 'Đã gửi đơn')
    await waitForSelector('.invoice-sent-row')
    await clickByText('.invoice-sent-row .btn-outline', 'Xem')
    await waitForSelector('.invoice-detail-modal')
    await waitForText('.invoice-detail-modal', 'Không có đơn liên kết')
    await waitForText('.invoice-detail-modal', 'Không có sản phẩm')
    await waitForText('.invoice-detail-modal', 'Chưa có thanh toán')
    await waitForText('.invoice-detail-modal', 'Chưa có ảnh hóa đơn')
  })

  it('falls back to snapshot orders/items when top-level detail fields are missing', async () => {
    detailData = makeSparseDetail({ snapshot: { customer: { name: 'TEST' }, orders: [{ id: 'order-a', order_no: 'HD-A', status: 'PICKED', items: [{ name: 'SP A', sales_code: 'SC1', internal_code: null, color: 'Đỏ', size: 'M', quantity: 2, unit_price_amount: 50000, line_total_amount: 100000 }] }] } })
    render(createElement(InvoicePage, { go: () => {} }))
    await waitForSelector('.invoice-tabs')
    await clickByText('.invoice-tabs button', 'Đã gửi đơn')
    await waitForSelector('.invoice-sent-row')
    await clickByText('.invoice-sent-row .btn-outline', 'Xem')
    await waitForSelector('.invoice-detail-modal')
    await waitForText('.invoice-detail-modal', 'HD-A')
    await waitForText('.invoice-detail-modal', 'SP A')
  })

  it('does not crash when deleted order detail is missing items', async () => {
    deletedDetailData = { ...makeDeletedOrderDetail(), items: undefined }
    render(createElement(InvoicePage, { go: () => {} }))
    await waitForSelector('.invoice-tabs')
    await clickByText('.invoice-tabs button', 'Đơn đã xóa')
    await waitForSelector('.invoice-deleted-row')
    await clickByText('.invoice-deleted-row .btn-outline', 'Xem chi tiết')
    await waitForSelector('.invoice-detail-modal')
    await waitForText('.invoice-detail-modal', 'Không có sản phẩm')
  })

  it('shows an error inside the modal and keeps the list when detail API fails', async () => {
    detailReject = new Error('Detail failed')
    render(createElement(InvoicePage, { go: () => {} }))
    await waitForSelector('.invoice-tabs')
    await clickByText('.invoice-tabs button', 'Đã gửi đơn')
    await waitForSelector('.invoice-sent-row')
    await clickByText('.invoice-sent-row .btn-outline', 'Xem')
    await waitForSelector('.invoice-detail-modal')
    await waitForText('.invoice-detail-modal', 'Không thể kết nối máy chủ.')
    expect(container.querySelector('.invoice-sent-row')).not.toBeNull()
  })

  it('shows loading inside the modal before detail resolves', async () => {
    let resolveDetail!: (value: any) => void
    detailPending = new Promise(resolve => { resolveDetail = resolve })
    render(createElement(InvoicePage, { go: () => {} }))
    await waitForSelector('.invoice-tabs')
    await clickByText('.invoice-tabs button', 'Đã gửi đơn')
    await waitForSelector('.invoice-sent-row')
    await clickByText('.invoice-sent-row .btn-outline', 'Xem')
    await waitForSelector('.invoice-detail-modal')
    await waitForText('.invoice-detail-modal', 'Đang tải…')
    await act(async () => { resolveDetail({ data: detailData }) })
    await waitForText('.invoice-detail-modal', 'Chi tiết hóa đơn')
  })
})
