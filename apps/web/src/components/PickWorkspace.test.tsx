// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as apiClient from '../api/client'
import { App, AppShell } from '../App'
import type { Order, OrderDetail, User } from '../api/client'
import { PickWorkspace } from './PickWorkspace'

vi.mock('../api/auth', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1', username: 'picker', display_name: 'Picker', role: 'OWNER',
      roles: ['OWNER'], permissions: ['sales.view'], phone: null, status: 'ACTIVE',
    },
    loading: false,
    logout: vi.fn(),
  }),
}))

const warehouse = { id: 'warehouse-1', code: 'TAN_XUAN', name: 'TÂN XUÂN' }
const customer = { id: 'customer-1', name: 'TEST', phone: null }

function makeOrder(id: string, orderNo: string, status: string): Order {
  return {
    id, order_no: orderNo, order_group_id: null, customer_id: customer.id,
    customer_name: customer.name, warehouse, order_type: 'NORMAL',
    created_date: '2026-10-15', delivery_date: '2026-10-15', is_urgent: false,
    customer_note: null, staff_note: null, status, claimed_by: status === 'PICKING' ? 'user-1' : null, claimed_by_name: 'Picker',
    picked_at: null, total_amount: 0, billing_status: status === 'PICKED' ? 'READY' : 'DRAFT',
    paid_amount: 0, invoice_balance_amount: 0, version: 1, created_at: null, images: [],
  }
}

const initialOrders = [
  makeOrder('order-a', 'HD-A', 'PICKING'),
  makeOrder('order-b', 'HD-B', 'NEW'),
]

function makeDetail(order: Order, productName: string): OrderDetail {
  return {
    order, customer, warehouse,
    items: [{
      id: `${order.id}-item`, product_variant_id: null, product_name: productName,
      sales_code: null, internal_code: null, color: null, size: null,
      warehouse_id: warehouse.id, quantity: 1, unit_price_amount: 1000,
      line_total_amount: 1000, sale_type: 'NhapTay', note: null,
    }],
    reservation: null, inventory: [], history: [],
  }
}

const user: User = {
  id: 'user-1', username: 'picker', display_name: 'Picker', role: 'OWNER',
  roles: ['OWNER'], permissions: ['sales.view'], phone: null, status: 'ACTIVE',
}

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient
let restoreApi: (() => void) | undefined
let claimed: string[]
let saved: string[]
let requestedOrderDetails: string[]
let savedDrafts: Array<{ orderId: string; bodyOrderId: string | undefined; productName: string | undefined }>

function WorkspaceRoute() {
  const { orderId = 'order-a' } = useParams()
  const navigate = useNavigate()
  return <AppShell user={user} page="orders" setPage={vi.fn()} logout={vi.fn()}>
    <PickWorkspace orderId={orderId} customerName={customer.name} orders={initialOrders} returnTo="/orders?tab=NEW&q=TEST"
      onClaim={async id => {
        claimed.push(id)
        const current = initialOrders.find(order => order.id === id)!
        return { ...current, status: 'PICKING' }
      }}
      onSaved={async () => undefined}
      onRelease={async () => undefined}
      onDelete={async () => undefined}
      currentUser={user}
      onClose={() => navigate('/orders?tab=NEW&q=TEST')}/>
  </AppShell>
}

function RouteProbe() {
  const location = useLocation()
  return <output data-testid="route">{location.pathname}{location.search}</output>
}

function renderWorkspace() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  root = createRoot(container)
  act(() => root.render(createElement(QueryClientProvider, { client: queryClient },
    createElement(MemoryRouter, { initialEntries: ['/orders/order-a/picking'] },
      createElement(RouteProbe),
      createElement(Routes, null,
        createElement(Route, { path: '/orders', element: createElement('section', { 'data-testid': 'order-list' }, 'Chi tiết đơn') }),
        createElement(Route, { path: '/orders/:orderId/picking', element: createElement(WorkspaceRoute) }),
      )))))
}

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

async function waitForSelector(selector: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const element = container.querySelector(selector)
    if (element) return element
    await settle()
  }
  throw new Error(`Timed out waiting for ${selector}`)
}

async function waitForText(selector: string, text: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (container.querySelector(selector)?.textContent?.includes(text)) return
    await settle()
  }
  throw new Error(`Timed out waiting for ${selector} to contain ${text}`)
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  claimed = []
  saved = []
  requestedOrderDetails = []
  savedDrafts = []
  const details: Record<string, OrderDetail> = {
    'order-a': makeDetail(initialOrders[0], 'Product for A'),
    'order-b': makeDetail(initialOrders[1], 'Product for B'),
  }
  const apiSpy = vi.spyOn(apiClient, 'api').mockImplementation(async <T,>(path: string, options?: { method?: string; body?: unknown }) => {
    if (path === '/order-work-queue') return { data: [{
      warehouse, order_count: 2,
      customers: [{ customer_id: customer.id, customer_name: customer.name, order_count: 2, has_urgent: false }],
    }] as T }
    if (path.startsWith('/order-work-queue/customers/')) {
      return { data: { customer, warehouse, orders: initialOrders } as T }
    }
    if (path.endsWith('/claim')) {
      const orderId = path.split('/')[2]
      const order = initialOrders.find(row => row.id === orderId)!
      return { data: { ...order, status: 'PICKING' } as T }
    }
    if (path.startsWith('/orders/') && path.endsWith('/pick')) {
      const orderId = path.split('/')[2]
      saved.push(orderId)
      const body = options?.body as { order_id?: string; items?: Array<{ product_name: string }> } | undefined
      savedDrafts.push({ orderId, bodyOrderId: body?.order_id, productName: body?.items?.[0]?.product_name })
      const current = details[orderId]
      const order = { ...current.order, status: 'PICKED', billing_status: 'READY', version: current.order.version + 1 }
      details[orderId] = { ...current, order }
      return { data: details[orderId] as T }
    }
    if (path.startsWith('/orders/')) {
      const orderId = path.split('/')[2]
      requestedOrderDetails.push(orderId)
      return { data: details[orderId] as T }
    }
    if (path === '/product-variants') return { data: [] as T }
    throw new Error(`Unexpected API call: ${path} ${options?.method ?? 'GET'}`)
  })
  restoreApi = () => apiSpy.mockRestore()
})

afterEach(() => {
  act(() => root.unmount())
  queryClient.clear()
  restoreApi?.()
  container.remove()
  sessionStorage.clear()
})

describe('multi-order picking workspace', () => {
  it('keeps the order list form-free and navigates the selected order to its AppShell route', async () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    root = createRoot(container)
    act(() => root.render(createElement(QueryClientProvider, { client: queryClient },
      createElement(MemoryRouter, { initialEntries: ['/orders?tab=NEW&q=TEST'] }, createElement(App)))))
    await waitForSelector('.customer-row')
    await act(async () => container.querySelector<HTMLButtonElement>('.customer-row')?.click())
    await waitForSelector('.order-card .btn-main')
    expect(container.querySelector('.pick-workspace')).toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('.order-card .btn-main')?.click())
    await waitForText('.pick-active-order', 'HD-A')
    expect(container.querySelector('.pick-workspace')).not.toBeNull()
    expect(container.querySelector('.pc-kiot-sidebar')).not.toBeNull()
    expect(Array.from(container.querySelectorAll('.pc-kiot-link')).find(button => button.textContent?.includes('Chi tiết đơn'))?.getAttribute('aria-current')).toBe('page')
  })

  it('keeps the AppShell sidebar active and loads the selected order without mixing details', async () => {
    renderWorkspace()
    await waitForSelector('.pick-footer .btn-main')

    expect(container.querySelector('.pc-kiot-sidebar')).not.toBeNull()
    expect(container.querySelector('.app-container > .blue-header')).not.toBeNull()
    expect(container.querySelector('[data-testid="route"]')?.textContent).toBe('/orders/order-a/picking')
    expect(Array.from(container.querySelectorAll('.pc-kiot-link')).find(button => button.textContent?.includes('Chi tiết đơn'))?.getAttribute('aria-current')).toBe('page')
    expect(container.querySelectorAll('.pick-order-tab')).toHaveLength(2)
    expect(requestedOrderDetails).toContain('order-a')
    const css = readFileSync('src/styles/app.css', 'utf8')
    expect(css).not.toContain('.pick-workspace { position: fixed')

    await act(async () => container.querySelectorAll<HTMLButtonElement>('.pick-order-tab')[1].click())
    await waitForText('.pick-active-order', 'HD-B')
    await waitForSelector('.pick-footer .btn-main')
    expect(claimed).toEqual(['order-b'])
    expect(requestedOrderDetails).toContain('order-b')
    expect(requestedOrderDetails[requestedOrderDetails.length - 1]).toBe('order-b')
    expect(container.querySelector('.pick-active-order')?.textContent).toContain('HD-B')
    expect(container.querySelector('[data-testid="route"]')?.textContent).toBe('/orders/order-b/picking')
  })

  it('marks each saved order, updates the counter, and advances until the customer group is complete', async () => {
    renderWorkspace()
    await waitForSelector('.pick-footer .btn-main')

    await act(async () => container.querySelector<HTMLButtonElement>('.pick-footer .btn-main')?.click())
    await waitForText('.pick-active-order', 'HD-B')
    await waitForSelector('.pick-footer .btn-main')
    expect(saved).toEqual(['order-a'])
    expect(container.querySelector('.pick-group-header')?.textContent).toContain('Đã soạn 1/2')
    expect(container.querySelectorAll('.pick-order-tab')[0].textContent).toContain('Đã soạn')
    expect(container.querySelector('.pick-active-order')?.textContent).toContain('HD-B')
    expect(container.querySelector('[data-testid="route"]')?.textContent).toBe('/orders/order-b/picking')
    expect(requestedOrderDetails[requestedOrderDetails.length - 1]).toBe('order-b')

    await act(async () => container.querySelector<HTMLButtonElement>('.pick-footer .btn-main')?.click())
    await waitForSelector('.pick-complete')
    expect(saved).toEqual(['order-a', 'order-b'])
    expect(savedDrafts).toEqual([
      { orderId: 'order-a', bodyOrderId: 'order-a', productName: 'Product for A' },
      { orderId: 'order-b', bodyOrderId: 'order-b', productName: 'Product for B' },
    ])
    expect(container.querySelector('.pick-group-header')?.textContent).toContain('Đã soạn 2/2')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Đã soạn xong toàn bộ đơn của khách TEST.')
    expect(container.querySelector('.pick-workspace')).not.toBeNull()
  })

  it('returns to the separate order-list route with its search and tab state', async () => {
    renderWorkspace()
    await waitForSelector('.pick-group-header')
    await act(async () => container.querySelector<HTMLButtonElement>('.pick-group-header .btn-outline')?.click())
    expect(container.querySelector('[data-testid="route"]')?.textContent).toBe('/orders?tab=NEW&q=TEST')
    expect(container.querySelector('[data-testid="order-list"]')?.textContent).toBe('Chi tiết đơn')
    expect(container.querySelector('.pick-workspace')).toBeNull()
  })

  it('asks before switching away from an unsaved order and retains its separate draft', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderWorkspace()
    await waitForSelector('.add-line')

    await act(async () => container.querySelector<HTMLButtonElement>('.add-line')?.click())
    await act(async () => container.querySelectorAll<HTMLButtonElement>('.pick-order-tab')[1].click())
    expect(confirm).toHaveBeenCalledWith('Đơn hiện tại có thay đổi chưa lưu. Bạn có muốn chuyển đơn không?')
    expect(container.querySelector('.pick-active-order')?.textContent).toContain('HD-A')

    confirm.mockReturnValue(true)
    await act(async () => container.querySelectorAll<HTMLButtonElement>('.pick-order-tab')[1].click())
    await waitForText('.pick-active-order', 'HD-B')
    await act(async () => container.querySelectorAll<HTMLButtonElement>('.pick-order-tab')[0].click())
    await waitForText('.pick-active-order', 'HD-A')
    expect(container.querySelectorAll('.pick-table tbody tr')).toHaveLength(2)
    confirm.mockRestore()
  })
})
