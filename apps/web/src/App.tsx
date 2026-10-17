import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError, STATUS_LABEL, type Customer, type CustomerDebtChange, type Order, type OrderDetail, type Overview, type QueueSection, type QueueTab, type User } from './api/client'
import { uploadMediaFile } from './api/media'
import { useAuth } from './api/auth'
import { formatDate, formatDateShort, formatMoney, parseMoneyInput, todayIso, todayLabel } from './lib/format'
import { PickWorkspace } from './components/PickWorkspace'
import { PickerStatistics } from './components/PickerStatistics'
import { ReturnsPage, ShippingPage } from './components/SalesPages'
import { InvoicePage } from './components/InvoiceCenter'
import { InvoiceDetailPage, InvoiceGroupPage } from './components/InvoicePages'
import { OrderImages } from './components/OrderImages'
import { OrderImagePasteArea, type PendingOrderImage } from './components/OrderImagePasteArea'
import { CustomerCombobox } from './components/CustomerCombobox'
import { RecentImagesPage } from './components/RecentImagesPage'
import { ProductionPage } from './components/ProductionPage'
import { MaterialsPage } from './components/MaterialsPage'
import { HrPage, ReportsPage } from './components/HrReportsPages'
import { AccountPage, AdminPage } from './components/AdminPage'
import type { DebtStatement } from './api/client'

export type Page = 'dashboard' | 'orders' | 'create' | 'shipping' | 'invoices' | 'returns' | 'images' | 'customers' | 'production' | 'materials' | 'hr' | 'reports' | 'admin' | 'account'
const PAGE_PATH: Record<Page, string> = {
  dashboard: '/', orders: '/orders', create: '/create', shipping: '/shipping',
  invoices: '/invoices', returns: '/returns', images: '/images', customers: '/customers',
  production: '/production', materials: '/materials', hr: '/hr', reports: '/reports',
  admin: '/admin', account: '/account',
}
type NavItem = [Page, string, string, string]
const navSections: Array<[string, NavItem[]]> = [
  ['Bán hàng', [['dashboard', 'bi-grid-1x2-fill', 'Tổng quan', 'sales.view'], ['create', 'bi-plus-circle-fill', 'Tạo đơn', 'sales.create'], ['orders', 'bi-card-checklist', 'Chi tiết đơn', 'sales.view'], ['shipping', 'bi-truck', 'Vận chuyển', 'sales.ship'], ['invoices', 'bi-receipt', 'Hóa đơn', 'sales.invoice'], ['returns', 'bi-arrow-return-left', 'Hàng trả', 'sales.returns'], ['images', 'bi-images', 'Kho ảnh', 'sales.view'], ['customers', 'bi-people-fill', 'Khách hàng / công nợ', 'sales.view']]],
  ['Sản xuất', [['production', 'bi-scissors', 'QL Rập', 'production.view']]],
  ['Mua hàng', [['materials', 'bi-box-seam', 'Phụ liệu / mua hàng', 'materials.view']]],
  ['Nhân sự', [['hr', 'bi-person-badge', 'Nhân sự / lương', 'hr.view']]],
  ['Quản trị', [['reports', 'bi-bar-chart-line', 'Báo cáo / Audit', 'reports.view'], ['admin', 'bi-shield-lock', 'Tài khoản / phân quyền', 'admin.users']]],
]

function message(error: unknown) { return error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.' }

export function App() {
  const { user, loading, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  if (loading) return <div className="splash">Đang khởi động AZALAS SPORT…</div>
  if (!user) return <Login />
  let page: Page = 'dashboard'
  if (location.pathname.startsWith('/orders/')) page = 'orders'
  else if (location.pathname.startsWith('/invoices/')) page = 'invoices'
  else page = Object.entries(PAGE_PATH).find(([, path]) => path === location.pathname)?.[0] as Page ?? 'dashboard'
  const setPage = (next: Page) => navigate(PAGE_PATH[next])
  return <AppShell user={user} page={page} setPage={setPage} logout={logout}>
    <Routes>
      <Route path="/" element={<Dashboard go={setPage}/>}/>
      <Route path="/orders" element={<Orders/>}/>
      <Route path="/orders/:orderId/picking" element={<PickingPage/>}/>
      <Route path="/create" element={<CreateOrder onCreated={() => setPage('orders')}/>}/>
      <Route path="/shipping" element={<ShippingPage/>}/>
      <Route path="/invoices" element={<InvoicePage go={setPage}/>}/>
      <Route path="/invoices/group/:customerId" element={<InvoiceGroupPage/>}/>
      <Route path="/invoices/draft/:draftId" element={<InvoiceDetailPage/>}/>
      <Route path="/returns" element={<ReturnsPage/>}/>
      <Route path="/images" element={<RecentImagesPage go={setPage}/>}/>
      <Route path="/customers" element={<Customers/>}/>
      <Route path="/production" element={<ProductionPage/>}/>
      <Route path="/materials" element={<MaterialsPage/>}/>
      <Route path="/hr" element={<HrPage/>}/>
      <Route path="/reports" element={<ReportsPage onBack={() => setPage('dashboard')} onOpenOrders={() => setPage('orders')}/>}/>
      <Route path="/admin" element={<AdminPage/>}/>
      <Route path="/account" element={<AccountPage/>}/>
      <Route path="*" element={<Dashboard go={setPage}/>}/>
    </Routes>
  </AppShell>
}

export function AppShell({
  user,
  page,
  setPage,
  logout,
  children,
}: {
  user: User
  page: Page
  setPage: (page: Page) => void
  logout: () => void
  children?: ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!sidebarOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    const onResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [sidebarOpen])

  useEffect(() => {
    setSidebarOpen(false)
  }, [page])

  return <div className="app-shell">
    {sidebarOpen && <button className="pc-kiot-overlay" aria-label="Đóng menu" onClick={() => setSidebarOpen(false)}/>}
    <aside className={`pc-kiot-sidebar${sidebarOpen ? ' is-open' : ''}`}>
      <div className="pc-kiot-brand">
        <img src="/logo.svg" alt="AZALAS"/>
        <div><div className="pc-kiot-brand-title">AZALAS SPORT</div><div className="pc-kiot-brand-sub">QUẢN TRỊ VẬN HÀNH</div></div>
        <button className="pc-kiot-close" aria-label="Đóng menu" onClick={() => setSidebarOpen(false)}><i className="bi bi-x-lg"/></button>
      </div>
      <nav className="pc-kiot-nav" aria-label="Chức năng chính">{navSections.map(([section, items]) => { const visible = items.filter(item => user.permissions.includes(item[3])); return visible.length ? <div key={section}><div className="pc-kiot-nav-title">{section}</div>{visible.map(([id, icon, label]) => <button key={id} className={`pc-kiot-link ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => { setPage(id); setSidebarOpen(false) }}><i className={`bi ${icon}`}/>{label}</button>)}</div> : null })}</nav>
      <div className="pc-kiot-foot"><i className="bi bi-person-circle"/><span><b>{user.display_name}</b><br/>{user.role}</span><button onClick={() => { setPage('account'); setSidebarOpen(false) }}>Đổi MK</button><button onClick={logout}>Thoát</button></div>
    </aside>
    <main className="app-container">
      <header className="blue-header">
        <button className="pc-kiot-menu-toggle" aria-label="Mở menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><i className="bi bi-list"/></button>
        <span className="blue-header-date"><i className="bi bi-calendar3"/> {todayLabel()}</span>
        <span className="title">AZALAS SPORT</span>
        <span className="blue-header-user">{user.display_name}</span>
      </header>
      {children}
    </main>
  </div>
}

function Login() {
  const { login } = useAuth(); const [username, setUsername] = useState('owner'); const [password, setPassword] = useState('owner123'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await login(username, password) } catch (e) { setError(message(e)) } finally { setBusy(false) } }
  return <div className="login-wrap"><form className="login-card" onSubmit={submit}><img src="/logo.svg"/><h1>AZALAS SPORT</h1><p>Đăng nhập quản trị vận hành</p><label>Tên đăng nhập<input autoFocus value={username} onChange={e => setUsername(e.target.value)} /></label><label>Mật khẩu<input type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>{error && <div className="error-text">{error}</div>}<button className="btn-main" disabled={busy}>{busy ? 'ĐANG ĐĂNG NHẬP…' : 'ĐĂNG NHẬP'}</button><small>Tài khoản demo: owner / owner123</small></form></div>
}

function Dashboard({ go }: { go: (page: Page) => void }) {
  const [preset, setPreset] = useState<DashboardPeriodPreset>('today')
  const [fromDate, setFromDate] = useState(todayIso())
  const [toDate, setToDate] = useState(todayIso())
  const overview = useQuery({
    queryKey: ['overview', fromDate, toDate],
    queryFn: () => api<Overview>('/dashboard/overview', { query: { from_date: fromDate, to_date: toDate } }).then(r => r.data),
  })
  const d = overview.data
  const orderCards = d ? [
    ['Tổng số đơn', d.orders.total_orders, 'dashboard-total'],
    ['Đơn chưa soạn', d.orders.new_orders, 'new'],
    ['Đang soạn', d.orders.picking_orders, 'picking'],
    ['HĐ chưa gửi', d.orders.invoice_pending, 'dashboard-invoice-pending'],
    ['HĐ đã gửi', d.orders.invoice_sent, 'dashboard-invoice-sent'],
    ['Nợ đơn', d.orders.debt_orders, 'dashboard-debt'],
    ['Hủy', d.orders.cancelled_orders, 'dashboard-cancelled'],
  ] as const : []
  const cashCards = d ? [
    ['Doanh thu', d.cashflow.revenue_amount, 'Tổng tiền hàng trong kỳ', 'cash-revenue'],
    ['Đã thu CK/TM', d.cashflow.collected_amount, 'Tiền đã thu từ khách', 'cash-collected'],
    ['Công nợ tổng', d.cashflow.total_debt_amount, 'Phải thu + phải trả', 'cash-debt'],
    ['Còn lại', d.cashflow.remaining_amount, 'Đã thu - công nợ phải trả', 'cash-remaining'],
  ] as const : []
  function applyPreset(nextPreset: DashboardPeriodPreset) {
    setPreset(nextPreset)
    if (nextPreset === 'custom') return
    const today = dateFromInput(todayIso())
    let start = today
    let end = today
    if (nextPreset === '7days' || nextPreset === '30days') {
      start = new Date(today)
      start.setDate(start.getDate() - (nextPreset === '7days' ? 6 : 29))
    } else if (nextPreset === 'this_month') {
      start = new Date(today.getFullYear(), today.getMonth(), 1)
    } else if (nextPreset === 'last_month') {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      end = new Date(today.getFullYear(), today.getMonth(), 0)
    }
    setFromDate(toDateInput(start))
    setToDate(toDateInput(end))
  }
  return <section className="page dashboard">
    <h1>Xin chào, chúc bạn làm việc hiệu quả!</h1>
    <div className="dashboard-period card">
      <div className="dashboard-period-presets" aria-label="Chọn khoảng thời gian">
        {([
          ['today', 'Hôm nay'], ['7days', '7 ngày'], ['30days', '30 ngày'],
          ['this_month', 'Tháng này'], ['last_month', 'Tháng trước'],
        ] as const).map(([value, label]) => <button
          key={value}
          type="button"
          className={preset === value ? 'active' : ''}
          onClick={() => applyPreset(value)}
        >{label}</button>)}
      </div>
      <label>Từ ngày<input type="date" value={fromDate} onChange={event => { setPreset('custom'); setFromDate(event.target.value) }}/></label>
      <label>Đến ngày<input type="date" value={toDate} onChange={event => { setPreset('custom'); setToDate(event.target.value) }}/></label>
      <button type="button" className="btn-outline dashboard-refresh" onClick={() => void overview.refetch()} disabled={overview.isFetching}>
        <i className={`bi ${overview.isFetching ? 'bi-arrow-repeat' : 'bi-arrow-clockwise'}`}/> Làm mới
      </button>
    </div>

    <section className="dashboard-metric-section" aria-labelledby="dashboard-cashflow-title">
      <h2 id="dashboard-cashflow-title">Dòng tiền</h2>
      <div className="dashboard-metric-grid dashboard-cash-grid">
        {overview.isLoading ? Array.from({ length: 4 }, (_, index) => <MetricSkeleton key={index}/>) :
          cashCards.map(([label, amount, description, color]) => <button
            type="button"
            className={`metric dashboard-metric ${color}`}
            key={label}
            onClick={() => go('reports')}
            aria-label={`${label}: ${amount === null || !d?.cashflow.available ? 'Chưa có quyền xem' : formatMoney(amount)}`}
            disabled={!d?.cashflow.available}
          >
            <span>{label}</span>
            <b>{!d?.cashflow.available || amount === null ? 'Chưa có quyền xem' : formatMoney(amount)}</b>
            <small>{description}</small>
          </button>)}
      </div>
      {d && !d.cashflow.available && <p className="dashboard-finance-note">Số liệu dòng tiền chỉ hiển thị với tài khoản OWNER hoặc ADMIN.</p>}
    </section>

    <section className="dashboard-metric-section" aria-labelledby="dashboard-orders-title">
      <h2 id="dashboard-orders-title">Vận đơn / đơn hàng</h2>
      <div className="dashboard-metric-grid dashboard-orders-grid">
        {overview.isLoading ? Array.from({ length: 7 }, (_, index) => <MetricSkeleton key={index}/>) :
          orderCards.map(([label, count, color]) => <button
            type="button"
            className={`metric dashboard-metric ${color}`}
            key={label}
            onClick={() => go('orders')}
          >
            <span>{label}</span><b>{count.toLocaleString('vi-VN')}</b>
          </button>)}
      </div>
    </section>

    {overview.error && <div className="dashboard-error"><Problem text={message(overview.error)}/><button className="btn-outline" onClick={() => overview.refetch()}>Thử lại</button></div>}
    {d && <div className="card"><h2 className="section-title"><i className="bi bi-clock-history"/>Hoạt động gần đây</h2>{d.recent_activity.length ? <div className="activity-list">{d.recent_activity.map(x => <div key={x.order_id}><b>{x.order_no}</b><span>{x.customer_name}</span><em>{STATUS_LABEL[x.status] ?? x.status}</em></div>)}</div> : <div className="empty">Chưa có hoạt động.</div>}</div>}
  </section>
}

type DashboardPeriodPreset = 'today' | '7days' | '30days' | 'this_month' | 'last_month' | 'custom'

function dateFromInput(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function toDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function MetricSkeleton() {
  return <div className="metric dashboard-metric-skeleton" aria-hidden="true"><i/><i/><i/></div>
}

type OrderView = QueueTab | 'STATS'

type PickingRouteState = {
  customerName: string
  orders: Order[]
  returnTo: string
}

function Orders() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') as OrderView | null) ?? 'NEW'
  const q = searchParams.get('q') ?? ''
  const customerId = searchParams.get('customer_id')
  const warehouseId = searchParams.get('warehouse_id')
  const selected = customerId && warehouseId ? { customerId, warehouseId } : null
  const isStats = tab === 'STATS'
  const queue = useQuery({
    queryKey: ['queue', tab, q],
    enabled: !isStats,
    queryFn: () => api<QueueSection[]>('/order-work-queue', { query: { tab: tab as QueueTab, q } }).then(r => r.data),
  })
  const tabs: Array<[OrderView, string]> = [
    ['NEW', 'Đơn mới'], ['PICKING', 'Đang soạn'], ['DEBT', 'Nợ đơn'], ['CUSTOMER_ORDER', 'Khách đặt'],
    ...(user?.role === 'OWNER' ? [['STATS', 'Thống kê soạn'] as [OrderView, string]] : []),
  ]
  function updateListState(next: { tab?: OrderView; q?: string; customerId?: string | null; warehouseId?: string | null }) {
    const params = new URLSearchParams(searchParams)
    if (next.tab !== undefined) params.set('tab', next.tab)
    if (next.q !== undefined) next.q ? params.set('q', next.q) : params.delete('q')
    if (next.customerId !== undefined) next.customerId ? params.set('customer_id', next.customerId) : params.delete('customer_id')
    if (next.warehouseId !== undefined) next.warehouseId ? params.set('warehouse_id', next.warehouseId) : params.delete('warehouse_id')
    setSearchParams(params, { replace: true })
  }
  function beginPicking(order: Order, group: Order[], customerName: string) {
    const path = `${location.pathname}${location.search}`
    const orders = group.map(row => row.id === order.id && row.status === 'NEW' ? { ...row, status: 'PICKING' } : row)
    const state: PickingRouteState = { customerName, orders, returnTo: path }
    navigate(`/orders/${order.id}/picking`, { state })
  }
  return <section className="page">
    <h1>Chi tiết đơn</h1>
    <div className="tabs">{tabs.map(([id, label]) => <button className={tab === id ? 'active' : ''} onClick={() => updateListState({ tab: id, customerId: null, warehouseId: null })} key={id}>{label}</button>)}</div>
    {isStats ? <PickerStatistics/> : <>
      <input className="form-control search" placeholder="Tìm mã đơn hoặc khách hàng…" value={q} onChange={e => updateListState({ q: e.target.value })}/>
      {queue.isLoading ? <Loading/> : queue.error ? <Problem text={message(queue.error)}/> : <div className="queue-grid">{queue.data!.map(section => <div className="card warehouse" key={section.warehouse.id}><h2><span className={`type-badge ${section.warehouse.code === 'TAN_XUAN' ? 'badge-tan-xuan' : 'badge-ca-koi'}`}>{section.warehouse.name}</span><span className="count-pill">{section.order_count}</span></h2>{section.customers.map(c => <button className="customer-row" onClick={() => updateListState({ customerId: c.customer_id, warehouseId: section.warehouse.id })} key={c.customer_id}><i className="bi bi-person-circle"/><span><b>{c.customer_name}</b><small>{c.order_count} đơn</small></span>{c.has_urgent && <mark>GẤP</mark>}<i className="bi bi-chevron-right"/></button>)}</div>)}</div>}
      {selected && <OrderDrawer {...selected} tab={tab as QueueTab} onClose={() => updateListState({ customerId: null, warehouseId: null })} onBeginPicking={beginPicking}/>}
    </>}
  </section>
}

function PickingPage() {
  const { orderId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const routeState = location.state as PickingRouteState | null
  const activeOrder = useQuery({
    queryKey: ['order-detail', orderId],
    enabled: !!orderId && !routeState?.orders?.length,
    queryFn: () => api<OrderDetail>(`/orders/${orderId}`).then(response => response.data),
  })
  const fallbackOrders = useQuery({
    queryKey: ['picking-group', orderId],
    enabled: !!activeOrder.data,
    queryFn: async () => {
      const { customer, warehouse } = activeOrder.data!
      const [newOrders, pickingOrders] = await Promise.all((['NEW', 'PICKING'] as QueueTab[]).map(tab =>
        api<{ orders: Order[] }>(`/order-work-queue/customers/${customer.id}`, {
          query: { warehouse_id: warehouse.id, tab },
        }).then(response => response.data.orders)))
      const byId = new Map([...newOrders, ...pickingOrders].map(order => [order.id, order]))
      byId.set(activeOrder.data!.order.id, activeOrder.data!.order)
      return [...byId.values()]
    },
  })

  const orders = routeState?.orders ?? fallbackOrders.data
  const customerName = routeState?.customerName ?? activeOrder.data?.customer.name ?? ''
  const returnTo = routeState?.returnTo ?? '/orders'
  if (!orders) return activeOrder.error || fallbackOrders.error
    ? <div className="page"><Problem text={message(activeOrder.error ?? fallbackOrders.error)}/><button className="btn-outline" onClick={() => navigate(returnTo)}>← Quay lại Chi tiết đơn</button></div>
    : <Loading/>

  async function claimOrder(id: string) {
    const response = await api<Order>(`/orders/${id}/claim`, { method: 'POST' })
    await qc.invalidateQueries({ queryKey: ['queue'] })
    return response.data
  }

  async function savedOrder() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['queue'] }),
      qc.invalidateQueries({ queryKey: ['customer-orders'] }),
      qc.invalidateQueries({ queryKey: ['invoice-work-queue'] }),
      qc.invalidateQueries({ queryKey: ['overview'] }),
      qc.invalidateQueries({ queryKey: ['customer-order-gallery'] }),
    ])
  }

  async function releaseClaim(id: string, reason: string) {
    await api<Order>(`/orders/${id}/release-claim`, { method: 'POST', body: { reason } })
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['queue'] }),
      qc.invalidateQueries({ queryKey: ['customer-orders'] }),
      qc.invalidateQueries({ queryKey: ['order-detail', id] }),
    ])
  }

  async function deleteOrder(id: string) {
    await api<{ ok: boolean }>(`/orders/${id}`, { method: 'DELETE' })
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['queue'] }),
      qc.invalidateQueries({ queryKey: ['customer-orders'] }),
      qc.invalidateQueries({ queryKey: ['order-detail', id] }),
      qc.invalidateQueries({ queryKey: ['invoice-work-queue'] }),
      qc.invalidateQueries({ queryKey: ['overview'] }),
      qc.invalidateQueries({ queryKey: ['customer-order-gallery'] }),
    ])
  }

  return <PickWorkspace orderId={orderId} customerName={customerName} orders={orders}
    returnTo={returnTo} onClaim={claimOrder} onClose={() => navigate(returnTo)} onSaved={savedOrder}
    onRelease={releaseClaim} onDelete={deleteOrder} currentUser={user}/>
}

function OrderDrawer({ customerId, warehouseId, tab, onClose, onBeginPicking }: { customerId: string; warehouseId: string; tab: QueueTab; onClose: () => void; onBeginPicking: (order: Order, group: Order[], customerName: string) => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const detail = useQuery({ queryKey: ['customer-orders', customerId, warehouseId, tab], queryFn: () => api<{customer: {name: string; phone: string | null}; warehouse: {name: string}; orders: Order[]}>(`/order-work-queue/customers/${customerId}`, { query: { warehouse_id: warehouseId, tab } }).then(r => r.data) })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  async function claim(order: Order) {
    setBusy(order.id); setError('')
    try {
      const claimed = await api<Order>(`/orders/${order.id}/claim`, { method: 'POST' })
      await qc.invalidateQueries({ queryKey: ['queue'] })
      onBeginPicking(claimed.data, detail.data?.orders ?? [claimed.data], detail.data?.customer.name ?? '')
    }
    catch (e) { setError(message(e)) } finally { setBusy(null) }
  }
  function openExisting(order: Order) {
    const state: PickingRouteState = {
      customerName: detail.data?.customer.name ?? '',
      orders: detail.data?.orders ?? [order],
      returnTo: `${location.pathname}${location.search}`,
    }
    navigate(`/orders/${order.id}/picking`, { state })
  }
  return <div className="drawer-layer order-drawer-layer"><section className="drawer"><header className="blue-header"><button className="btn-back" onClick={onClose}>← Quay lại Chi tiết đơn</button><span className="title">Đơn của khách</span></header>{detail.isLoading ? <Loading/> : detail.error ? <Problem text={message(detail.error)}/> : <><div className="drawer-intro"><b>{detail.data!.customer.name}</b><span>{detail.data!.customer.phone || 'Chưa có SĐT'} · {detail.data!.warehouse.name}</span></div>{error && <div className="error-text">{error}</div>}{detail.data!.orders.map(o => <article className="order-card" key={o.id}><div><b>{o.order_no}</b>{o.is_urgent && <mark>GẤP</mark>}<span className="type-badge">{o.status === 'PICKING' && o.claimed_by_name ? `Đang soạn - ${o.claimed_by_name}` : o.status === 'NEW' ? 'Chờ soạn' : STATUS_LABEL[o.status] ?? o.status}</span></div><p>Ngày tạo: {formatDateShort(o.created_date)} {o.delivery_date && <>· Giao: {formatDate(o.delivery_date)}</>}</p>{o.customer_note && <p className="muted">{o.customer_note}</p>}{o.claimed_by_name && <p className="muted">Người soạn: {o.claimed_by_name}</p>}<OrderImages images={o.images}/>{o.status === 'NEW' && <button className="btn-main" disabled={busy === o.id} onClick={() => claim(o)}>{busy === o.id ? 'ĐANG NHẬN…' : 'BẮT ĐẦU SOẠN ĐƠN NÀY'}</button>}{o.status === 'PICKING' && <button className="btn-main" onClick={() => openExisting(o)}>MỞ SOẠN HÀNG</button>}</article>)}</>}</section></div>
}

function CreateOrder({ onCreated }: { onCreated: () => void }) {
  const qc = useQueryClient()
  const customers = useQuery({ queryKey: ['customers', 'create'], queryFn: () => api<Customer[]>('/customers', { query: { sort: 'name_asc' } }).then(r => r.data) })
  const [customerId, setCustomerId] = useState(''); const [mode, setMode] = useState('TAN_XUAN'); const [delivery, setDelivery] = useState(''); const [urgent, setUrgent] = useState(false); const [note, setNote] = useState('')
  const [uploads, setUploads] = useState<PendingOrderImage[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [multiMode, setMultiMode] = useState(false)
  const [commonNote, setCommonNote] = useState('')
  const [multiRows, setMultiRows] = useState<Array<{ key: string; customerId: string; note: string; uploads: PendingOrderImage[] }>>([
    { key: crypto.randomUUID(), customerId: '', note: '', uploads: [] },
  ])
  const [createdOrders, setCreatedOrders] = useState<Array<{ customer_id: string; customer_name: string; order_id: string; order_no: string; warehouse: string }>>([])
  const bulkIdempotencyKey = useRef(crypto.randomUUID())

  function addUploads(files: File[], source: PendingOrderImage['source'], fingerprints: string[]) {
    const known = new Set(uploads.map(image => image.fingerprint ?? `file:${image.file.name}|${image.file.size}|${image.file.type}|${image.file.lastModified}`))
    const additions: PendingOrderImage[] = []
    files.forEach((file, index) => {
      const fingerprint = fingerprints[index]
      if (known.has(fingerprint) || uploads.length + additions.length >= 20) return
      known.add(fingerprint)
      additions.push({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file), source, fingerprint })
    })
    if (additions.length) setUploads(current => [...current, ...additions])
    setError('')
  }
  function removeUpload(key: string) {
    const target = uploads.find(item => item.key === key)
    if (target) URL.revokeObjectURL(target.preview)
    setUploads(current => current.filter(item => item.key !== key))
  }
  function updateMultiRow(key: string, update: (row: typeof multiRows[number]) => typeof multiRows[number]) {
    bulkIdempotencyKey.current = crypto.randomUUID()
    setCreatedOrders([])
    setMultiRows(current => current.map(row => row.key === key ? update(row) : row))
  }
  function addRowUploads(key: string, files: File[], source: PendingOrderImage['source'], fingerprints: string[]) {
    const currentRow = multiRows.find(row => row.key === key)
    if (!currentRow) return
    const known = new Set(currentRow.uploads.map(image => image.fingerprint ?? `file:${image.file.name}|${image.file.size}|${image.file.type}|${image.file.lastModified}`))
    const additions: PendingOrderImage[] = []
    files.forEach((file, index) => {
      const fingerprint = fingerprints[index]
      if (known.has(fingerprint) || currentRow.uploads.length + additions.length >= 20) return
      known.add(fingerprint)
      additions.push({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file), source, fingerprint })
    })
    if (!additions.length) return
    updateMultiRow(key, row => ({
      ...row,
      uploads: [...row.uploads, ...additions],
    }))
    setError('')
  }
  function removeRowUpload(rowKey: string, imageKey: string) {
    const target = multiRows.find(row => row.key === rowKey)?.uploads.find(item => item.key === imageKey)
    if (target) URL.revokeObjectURL(target.preview)
    updateMultiRow(rowKey, row => {
      return { ...row, uploads: row.uploads.filter(item => item.key !== imageKey) }
    })
  }
  function addCustomerRow() {
    bulkIdempotencyKey.current = crypto.randomUUID()
    setCreatedOrders([])
    setMultiRows(current => [...current, { key: crypto.randomUUID(), customerId: '', note: '', uploads: [] }])
  }
  function removeCustomerRow(key: string) {
    bulkIdempotencyKey.current = crypto.randomUUID()
    setCreatedOrders([])
    multiRows.find(row => row.key === key)?.uploads.forEach(item => URL.revokeObjectURL(item.preview))
    setMultiRows(current => current.filter(item => item.key !== key))
  }
  async function invalidateOrderSurfaces() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['queue'] }),
      qc.invalidateQueries({ queryKey: ['customer-orders'] }),
      qc.invalidateQueries({ queryKey: ['order-detail'] }),
      qc.invalidateQueries({ queryKey: ['orders'] }),
      qc.invalidateQueries({ queryKey: ['customer-order-gallery'] }),
      qc.invalidateQueries({ queryKey: ['recent-images'] }),
      qc.invalidateQueries({ queryKey: ['overview'] }),
    ])
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (multiMode) {
      if (multiRows.some(row => !row.customerId)) return setError('Vui lòng chọn khách hàng cho tất cả các dòng.')
      if (new Set(multiRows.map(row => row.customerId)).size !== multiRows.length) return setError('Không thể chọn trùng khách hàng trong cùng một lần tạo.')
    } else if (!customerId) return setError('Vui lòng chọn khách hàng.')
    setBusy(true); setError('')
    let uploadFailed = false
    try {
      if (multiMode) {
        let completedRows = multiRows.map(row => ({ ...row, uploads: [...row.uploads] }))
        for (const row of completedRows) {
          for (let index = 0; index < row.uploads.length; index += 1) {
            if (row.uploads[index].mediaId) continue
            row.uploads[index] = { ...row.uploads[index], uploading: true, error: undefined }
            setMultiRows([...completedRows])
            try {
              const response = await uploadMediaFile(row.uploads[index].file, 'orders')
              row.uploads[index] = { ...row.uploads[index], mediaId: response.id, uploading: false }
              setMultiRows([...completedRows])
            } catch (uploadError) {
              uploadFailed = true
              row.uploads[index] = { ...row.uploads[index], uploading: false, error: message(uploadError) }
              setMultiRows([...completedRows])
              throw uploadError
            }
          }
        }
        const response = await api<Array<{ customer_id: string; customer_name: string; order_id: string; order_no: string; warehouse: string }>>('/orders/bulk', {
          method: 'POST',
          headers: { 'Idempotency-Key': bulkIdempotencyKey.current },
          body: {
            warehouse_mode: mode,
            created_date: todayIso(),
            delivery_date: delivery || null,
            is_urgent: urgent,
            common_note: commonNote || null,
            customers: completedRows.map(row => ({
              customer_id: row.customerId,
              note: row.note || null,
              media_ids: row.uploads.map(item => item.mediaId).filter((id): id is string => Boolean(id)),
            })),
          },
        })
        completedRows.forEach(row => row.uploads.forEach(item => URL.revokeObjectURL(item.preview)))
        setMultiRows([{ key: crypto.randomUUID(), customerId: '', note: '', uploads: [] }])
        setCommonNote('')
        setCreatedOrders(response.data)
        bulkIdempotencyKey.current = crypto.randomUUID()
        await invalidateOrderSurfaces()
        return
      }
      const completed = [...uploads]
      for (let index = 0; index < completed.length; index += 1) {
        if (completed[index].mediaId) continue
        completed[index] = { ...completed[index], uploading: true, error: undefined }; setUploads([...completed])
        try {
          const response = await uploadMediaFile(completed[index].file, 'orders')
          completed[index] = { ...completed[index], mediaId: response.id, uploading: false }
          setUploads([...completed])
        } catch (uploadError) {
          uploadFailed = true
          completed[index] = { ...completed[index], uploading: false, error: message(uploadError) }
          setUploads([...completed]); throw uploadError
        }
      }
      await api<Order[]>('/orders', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: {
        customer_id: customerId, warehouse_mode: mode, created_date: todayIso(), delivery_date: delivery || null,
        is_urgent: urgent, customer_note: note || null, media_ids: completed.map(item => item.mediaId).filter((id): id is string => Boolean(id)),
      } })
      completed.forEach(item => URL.revokeObjectURL(item.preview))
      await invalidateOrderSurfaces()
      onCreated()
    } catch (caught) {
      setError(uploadFailed ? 'Không thể tải ảnh lên. Vui lòng thử lại.' : message(caught))
    } finally { setBusy(false) }
  }
  return <section className="page narrow"><h1>Tạo đơn mới</h1><form className="card" onSubmit={submit}>
    <div className="tabs"><button type="button" disabled={busy} className={!multiMode ? 'active' : ''} onClick={() => { setMultiMode(false); setError('') }}>Một khách</button><button type="button" disabled={busy} className={multiMode ? 'active' : ''} onClick={() => { setMultiMode(true); setError('') }}>Nhiều khách</button></div>
    {!multiMode && <div className="field"><label>Khách hàng *</label><CustomerCombobox customers={customers.data ?? []} disabled={busy} value={customerId} onChange={setCustomerId}/></div>}
    <div className="field"><label>Kho / loại đơn *</label><select className="form-control" disabled={busy} value={mode} onChange={e => { bulkIdempotencyKey.current = crypto.randomUUID(); setCreatedOrders([]); setMode(e.target.value) }}><option value="TAN_XUAN">Tân Xuân</option><option value="CA_KOI">Cá Koi</option><option value="BOTH">Tân Xuân và Cá Koi</option><option value="CUSTOMER_ORDER">Khách đặt</option></select></div>
    <div className="field"><label>Ngày giao</label><input className="form-control" type="date" disabled={busy} value={delivery} onChange={e => { bulkIdempotencyKey.current = crypto.randomUUID(); setCreatedOrders([]); setDelivery(e.target.value) }}/></div>
    <div className="field check"><input id="urgent" type="checkbox" disabled={busy} checked={urgent} onChange={e => { bulkIdempotencyKey.current = crypto.randomUUID(); setCreatedOrders([]); setUrgent(e.target.checked) }}/><label htmlFor="urgent">Đơn gấp</label></div>
    {multiMode ? <>
      <div className="field"><label>Ghi chú chung</label><textarea className="form-control" disabled={busy} value={commonNote} onChange={e => { bulkIdempotencyKey.current = crypto.randomUUID(); setCreatedOrders([]); setCommonNote(e.target.value) }} /></div>
      {multiRows.map((row, index) => {
        const usedCustomerIds = multiRows.filter(other => other.key !== row.key).map(other => other.customerId)
        return <article className="card" key={row.key}>
          <h3>Khách hàng {index + 1}</h3>
          <div className="field"><label>Khách hàng *</label><CustomerCombobox customers={customers.data ?? []} disabled={busy} value={row.customerId} excludeIds={usedCustomerIds} onChange={customerId => updateMultiRow(row.key, current => ({ ...current, customerId }))}/></div>
          <div className="field"><label>Ảnh đơn hàng ({row.uploads.length}/20)</label><OrderImagePasteArea images={row.uploads} disabled={busy} onAdd={(files, source, fingerprints) => addRowUploads(row.key, files, source, fingerprints)} onRemove={imageKey => removeRowUpload(row.key, imageKey)}/></div>
          <div className="field"><label>Ghi chú riêng của khách</label><textarea className="form-control" disabled={busy} value={row.note} onChange={e => updateMultiRow(row.key, current => ({ ...current, note: e.target.value }))}/></div>
          {multiRows.length > 1 && <button type="button" className="btn-outline" disabled={busy} onClick={() => removeCustomerRow(row.key)}>Xóa khách này</button>}
        </article>
      })}
      <button type="button" className="btn-outline" disabled={busy || multiRows.length >= 100} onClick={addCustomerRow}>+ Thêm khách hàng</button>
    </> : <>
      <div className="field"><label>Ảnh đơn hàng ({uploads.length}/20)</label><OrderImagePasteArea images={uploads} disabled={busy} onAdd={addUploads} onRemove={removeUpload}/></div>
      <div className="field"><label>Ghi chú</label><textarea className="form-control" disabled={busy} value={note} onChange={e => setNote(e.target.value)} /></div>
    </>}
    {error && <div className="error-text">{error}</div>}
    {createdOrders.length > 0 && <div className="card"><b>Đã tạo {new Set(createdOrders.map(order => order.customer_id)).size} khách hàng:</b>{createdOrders.map(order => <div key={order.order_id}>{order.customer_name} · {order.order_no} ({order.warehouse})</div>)}<button type="button" className="btn-outline" onClick={onCreated}>Đến Chi tiết đơn</button></div>}
    <button className="btn-main" disabled={busy || customers.isLoading}>{busy ? 'ĐANG TẢI ẢNH & LƯU…' : multiMode ? 'TẠO ĐƠN CHO CÁC KHÁCH' : 'TẠO ĐƠN'}</button>
  </form></section>
}

type CustomerListSummary = { total_debt_amount: number; count: number }

function Customers() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('debt_desc')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const customers = useQuery({
    queryKey: ['customers', q, sort],
    queryFn: async () => {
      const response = await api<Customer[]>('/customers', { query: { q, sort } })
      const summary: CustomerListSummary = response.meta
      return { rows: response.data, summary }
    },
  })
  const todayDebtChanges = useQuery({
    queryKey: ['customer-debt-changes-today'],
    queryFn: () => api<CustomerDebtChange[]>('/customers/debt-changes/today').then(response => response.data),
  })
  const rows = customers.data?.rows ?? []
  const summary = customers.data?.summary
  const customersWithDebt = rows.filter(customer => customer.debt_amount > 0).length
  const sortDescription: Record<string, string> = {
    debt_desc: 'Công nợ được sắp xếp từ cao xuống thấp.',
    debt_asc: 'Công nợ được sắp xếp từ thấp lên cao.',
    name_asc: 'Tên khách hàng được sắp xếp từ A đến Z.',
    name_desc: 'Tên khách hàng được sắp xếp từ Z đến A.',
    created_desc: 'Khách mới thêm được hiển thị trước.',
    created_asc: 'Khách cũ thêm được hiển thị trước.',
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api<Customer>('/customers', { method: 'POST', body: { name, phone: phone || null } })
      setName('')
      setPhone('')
      qc.invalidateQueries({ queryKey: ['customers'] })
    } catch (e) {
      setError(message(e))
    }
  }

  return <section className="page customers-page">
    <header className="customers-hero">
      <div className="customers-hero-copy">
        <span className="customers-eyebrow">BÁN HÀNG</span>
        <h1>Khách hàng</h1>
        <p>Quản lý khách hàng, công nợ và lịch sử mua hàng.</p>
      </div>
      <div className="customers-hero-icon" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false">
        <circle cx="18" cy="15" r="7"/><path d="M5 38c0-7.2 5.8-13 13-13s13 5.8 13 13v2H5z"/>
        <path d="M31 9.2a6.5 6.5 0 0 1 0 12.7M35 27c4.8 2 8 6.3 8 11v2h-8"/>
      </svg></div>
    </header>

    <form className="card customers-add" onSubmit={create}>
      <div className="customers-add-heading">
        <span className="customers-add-icon"><i className="bi bi-person-plus-fill"/></span>
        <span><b>Thêm khách hàng</b><small>Tạo hồ sơ khách mới</small></span>
      </div>
      <input className="form-control" placeholder="Tên khách hàng mới" value={name} onChange={e => setName(e.target.value)}/>
      <input className="form-control" placeholder="Số điện thoại" value={phone} onChange={e => setPhone(e.target.value)}/>
      <button className="btn-main"><i className="bi bi-plus-lg"/> Thêm khách</button>
      {error && <div className="error-text customers-add-error">{error}</div>}
    </form>

    <section className="customers-overview" aria-labelledby="customers-list-title">
      <div className="customers-list-heading">
        <div>
          <span className="customers-eyebrow">KHÁCH HÀNG</span>
          <h2 id="customers-list-title">Danh sách khách hàng</h2>
          <p>{sortDescription[sort] || sortDescription.debt_desc}</p>
        </div>
        <div className="customers-visible-count">
          <span>Tổng khách đang hiển thị</span>
          <strong>{customers.isLoading ? '—' : summary?.count ?? rows.length}</strong>
        </div>
      </div>

      <div className="customers-summary-grid">
        <article className="card customers-summary-card customers-summary-debt">
          <span className="customers-summary-icon" aria-hidden="true">₫</span>
          <div><small>TỔNG CÔNG NỢ</small>
            {customers.isLoading ? <span className="customers-skeleton customers-skeleton-value"/> : <strong>{formatMoney(summary?.total_debt_amount ?? 0)}</strong>}
            <em>Theo danh sách hiện tại</em>
          </div>
        </article>
        <article className="card customers-summary-card customers-summary-count">
          <span className="customers-summary-icon" aria-hidden="true">+</span>
          <div><small>KHÁCH ĐANG NỢ</small>
            {customers.isLoading ? <span className="customers-skeleton customers-skeleton-value"/> : <strong>{customersWithDebt}</strong>}
            <em>Có số dư công nợ lớn hơn 0</em>
          </div>
        </article>
        <article className="card customers-summary-card customers-summary-overdue">
          <span className="customers-summary-icon" aria-hidden="true">30+</span>
          <div><small>NỢ QUÁ 1 THÁNG</small>
            {customers.isLoading ? <span className="customers-skeleton customers-skeleton-value"/> : <strong>0</strong>}
            <em>Chưa có dữ liệu tuổi nợ trong danh sách</em>
          </div>
        </article>
        <article className="card customers-summary-card customers-summary-today">
          <span className="customers-summary-icon" aria-hidden="true">↕</span>
          <div className="customers-today-content">
            <small>KHÁCH HÀNG THAY ĐỔI CÔNG NỢ (TRONG NGÀY HÔM NAY)</small>
            {todayDebtChanges.isLoading ? <span className="customers-skeleton customers-skeleton-value"/> : todayDebtChanges.error ? <em>Không thể tải dữ liệu thay đổi công nợ.</em> : <>
              <strong>{todayDebtChanges.data?.length ?? 0}</strong>
              <em>khách có phát sinh công nợ hôm nay</em>
              {todayDebtChanges.data?.length ? <ul className="customers-today-list">
                {todayDebtChanges.data.map(change => <li key={change.customer_id}>
                  <span><b>{change.customer_name}</b><small>{change.customer_code}</small></span>
                  <span className="customers-today-amounts">
                    {change.paid_amount > 0 && <small className="is-paid">Đã trả {formatMoney(change.paid_amount)}</small>}
                    {change.reduced_amount > change.paid_amount && <small className="is-reduced">Giảm nợ khác {formatMoney(change.reduced_amount - change.paid_amount)}</small>}
                    {change.increased_amount > 0 && <small className="is-increased">Tăng nợ {formatMoney(change.increased_amount)}</small>}
                  </span>
                </li>)}
              </ul> : <em>Chưa có khách hàng thay đổi công nợ hôm nay.</em>}
            </>}
            {todayDebtChanges.error && <button type="button" className="customers-today-retry" onClick={() => void todayDebtChanges.refetch()}>Thử lại</button>}
          </div>
        </article>
      </div>
      {/* TODO: tính số khách quá hạn khi danh sách công nợ cung cấp ngày phát sinh nợ. */}

      <div className="customers-list-panel card">
        <div className="customer-tools">
          <label className="customers-search">
            <span className="customers-search-icon" aria-hidden="true">⌕</span>
            <input className="form-control search" aria-label="Tìm khách hàng" placeholder="Tìm khách, SĐT hoặc mã khách…" value={q} onChange={e => setQ(e.target.value)}/>
          </label>
          <select className="form-control" aria-label="Sắp xếp khách hàng" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="debt_desc">Nợ nhiều → ít</option>
            <option value="debt_asc">Nợ ít → nhiều</option>
            <option value="name_asc">Tên A → Z</option>
            <option value="name_desc">Tên Z → A</option>
            <option value="created_desc">Khách mới thêm trước</option>
            <option value="created_asc">Khách cũ thêm trước</option>
          </select>
        </div>

        {customers.isLoading ? <div className="customers-skeleton-list" aria-label="Đang tải danh sách khách hàng">
          {Array.from({ length: 5 }, (_, index) => <div className="customers-skeleton-row" key={index}><i/><i/><i/><i/></div>)}
        </div> : customers.error ? <div className="customers-load-error">
          <i className="bi bi-exclamation-circle" aria-hidden="true"/>
          <span>Không thể tải danh sách khách hàng.</span>
          <button type="button" className="btn-outline" onClick={() => void customers.refetch()}>Thử lại</button>
        </div> : rows.length === 0 ? <div className="customers-empty">
          <i className="bi bi-person-lines-fill" aria-hidden="true"/>
          <strong>{q ? 'Không tìm thấy khách hàng phù hợp.' : 'Chưa có khách hàng nào.'}</strong>
        </div> : <div className="customers-table-wrap">
          <table className="customers-table">
            <thead><tr><th>Mã KH</th><th>Tên khách hàng</th><th>Công nợ</th><th>Chi tiết</th></tr></thead>
            <tbody>{rows.map(customer => <tr key={customer.id}>
              <td><span className="customer-code">{customer.customer_code}</span></td>
              <td><div className="customer-name-cell"><strong>{customer.name}</strong><span>{customer.phone || 'Chưa có SĐT'}</span></div></td>
              <td><strong className={`customer-debt-amount${customer.debt_amount > 0 ? ' is-debt' : ''}`}>{formatMoney(customer.debt_amount)}</strong></td>
              <td><button type="button" className="customer-view-button" onClick={() => setSelected(customer.id)}>Xem <span aria-hidden="true">↗</span></button></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </div>
    </section>
    {selected && <CustomerDetail customerId={selected} onClose={() => setSelected(null)}/>}
  </section>
}

type DraftDebtLine = { key: string; type: 'INCREASE' | 'DECREASE'; date: string; amount: number; note: string }

function CustomerDetail({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const customer = useQuery({ queryKey: ['customer-detail', customerId], queryFn: () => api<Customer & { recent_orders: Order[] }>(`/customers/${customerId}`).then(r => r.data) })
  const debt = useQuery({ queryKey: ['customer-debt', customerId], queryFn: () => api<DebtStatement>(`/debt/customers/${customerId}`).then(r => r.data) })
  const canAdjust = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'KE_TOAN'
  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState<'INCREASE' | 'DECREASE'>('INCREASE')
  const [date, setDate] = useState(todayIso())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState<DraftDebtLine[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  function addLine() {
    const parsed = parseMoneyInput(amount)
    if (parsed === null || parsed <= 0) { setError('Vui lòng nhập số tiền lớn hơn 0.'); return }
    setDraft(cur => [...cur, { key: crypto.randomUUID(), type, date, amount: parsed, note: note.trim() }])
    setAmount(''); setNote(''); setError('')
  }
  function removeLine(key: string) { setDraft(cur => cur.filter(l => l.key !== key)) }

  const totalChange = draft.reduce((sum, l) => sum + (l.type === 'INCREASE' ? l.amount : -l.amount), 0)
  const currentDebt = debt.data?.closing ?? 0
  const projectedDebt = Math.max(currentDebt + totalChange, 0)

  async function saveSlip() {
    if (!draft.length) { setError('Phiếu chưa có dòng nào để lưu.'); return }
    setBusy(true); setError('')
    try {
      await api(`/customers/${customerId}/debt-adjustments`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: {
        items: draft.map(l => ({ type: l.type, date: l.date || null, amount: l.amount, note: l.note || null })),
      } })
      setDraft([]); setShowForm(false); setToast('Đã cập nhật công nợ thành công!')
      await qc.invalidateQueries({ queryKey: ['customer-detail', customerId] })
      await qc.invalidateQueries({ queryKey: ['customer-debt', customerId] })
      await qc.invalidateQueries({ queryKey: ['customers'] })
      setTimeout(() => setToast(''), 2500)
    } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }

  return <div className="drawer-layer"><section className="drawer customer-detail"><header className="blue-header"><button className="btn-back" onClick={onClose}>← Quay lại</button><span className="title">Chi tiết khách / công nợ</span></header>{customer.isLoading || debt.isLoading ? <Loading/> : customer.error || debt.error ? <Problem text={message(customer.error || debt.error)}/> : <>
    <div className="card customer-hero">
      <h2>{customer.data!.name}</h2>
      <p>{customer.data!.customer_code} · {customer.data!.phone || 'Chưa có SĐT'}</p>
      <p>{customer.data!.address || 'Chưa có địa chỉ'}</p>
      <p><b>Chành xe:</b> {customer.data!.carrier_name || 'Chưa có'} · {customer.data!.carrier_phone || 'Chưa có SĐT'}</p>
      <div className="customer-debt-box"><span>NỢ HIỆN TẠI</span><b>{formatMoney(debt.data!.closing)}</b><small>Công nợ đang theo dõi</small></div>
    </div>
    <div className="money-grid debt-summary"><span>Đầu kỳ <b>{formatMoney(debt.data!.opening)}</b></span><span>Phát sinh tăng <b>{formatMoney(debt.data!.debit)}</b></span><span>Phát sinh giảm <b>{formatMoney(debt.data!.credit)}</b></span><span>Cuối kỳ <b>{formatMoney(debt.data!.closing)}</b></span></div>

    {canAdjust && <div className="card debt-adjust">
      {!showForm ? <button className="btn-main" onClick={() => { setShowForm(true); setError('') }}>＋/－ Tạo phiếu công nợ</button> : <div className="debt-adjust-form">
        <div className="debt-adjust-title">TẠO PHIẾU CÔNG NỢ</div>
        <div className="debt-adjust-help">Một phiếu có thể vừa cộng tiền mua nợ, vừa trừ tiền khách trả.</div>
        <div className="debt-adjust-grid">
          <label>Loại<select className="form-control" value={type} onChange={e => setType(e.target.value as 'INCREASE' | 'DECREASE')}><option value="INCREASE">＋ Mua nợ / Cộng thêm</option><option value="DECREASE">－ Trừ tiền</option></select></label>
          <label>Ngày<input className="form-control" type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
          <label>Số tiền<input className="form-control" inputMode="numeric" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)}/></label>
        </div>
        <label>Ghi chú<input className="form-control" placeholder="VD: Khách lấy thêm hàng, khách CK, trừ hàng lỗi..." value={note} onChange={e => setNote(e.target.value)}/></label>
        <button className="btn-outline" onClick={addLine}>＋ Thêm vào phiếu</button>
        {draft.length > 0 && <div className="debt-adjust-draft">
          <b>Phiếu đang tạo:</b>
          {draft.map((l, i) => <div className="debt-draft-line" key={l.key}><span>{i + 1}. {l.type === 'INCREASE' ? '＋ Cộng thêm' : '－ Trừ tiền'} · {formatDate(l.date)} · {formatMoney(l.amount)}{l.note ? ` · ${l.note}` : ''}</span><button className="line-remove" onClick={() => removeLine(l.key)}>×</button></div>)}
          <div className="debt-draft-total"><span>Tạm tính thay đổi: <b>{totalChange > 0 ? '+' : ''}{formatMoney(totalChange)}</b></span><span>Nợ sau khi lưu: <b>{formatMoney(projectedDebt)}</b></span></div>
        </div>}
        <button className="btn-main" disabled={busy} onClick={saveSlip}>{busy ? 'ĐANG LƯU…' : '💾 Lưu TT'}</button>
        <button className="btn-outline" onClick={() => { setShowForm(false); setError(''); setDraft([]) }}>Đóng</button>
      </div>}
    </div>}
    {error && <div className="error-text">{error}</div>}

    <div className="card"><h2 className="section-title">Sổ công nợ</h2><div className="debt-ledger">{debt.data!.entries.length ? debt.data!.entries.map(row => <div key={row.id}><span>{formatDate(row.occurred_at)}<small>{row.description || row.entry_type}</small></span><em className={row.debit ? 'debt-increase' : 'debt-decrease'}>{row.debit ? `+${formatMoney(row.debit)}` : `-${formatMoney(row.credit)}`}</em><b>{formatMoney(row.balance)}</b></div>) : <div className="empty">Chưa có phát sinh công nợ.</div>}</div></div>
    <div className="card"><h2 className="section-title">Đơn gần đây</h2>{customer.data!.recent_orders.map(order => <div className="recent-order" key={order.id}><b>{order.order_no}</b><span>{STATUS_LABEL[order.status] || order.status}</span><strong>{formatMoney(order.total_amount)}</strong></div>)}</div>
  </>}</section>{toast && <div className="toast">{toast}</div>}</div>
}

function Loading() { return <div className="loading">Đang tải dữ liệu…</div> }
function Problem({ text }: { text: string }) { return <div className="empty">{text}</div> }
