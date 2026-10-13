const TOKEN_KEY = 'azalas.token'
const REFRESH_KEY = 'azalas.refresh_token'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  setRefresh: (t: string) => localStorage.setItem(REFRESH_KEY, t),
  clear: () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REFRESH_KEY) },
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, any> = {},
  ) {
    super(message)
  }
}

type Options = {
  method?: string
  body?: unknown
  query?: Record<string, string | undefined | null>
  headers?: Record<string, string>
  signal?: AbortSignal
  _retried?: boolean
}

export async function api<T>(path: string, opts: Options = {}): Promise<{ data: T; meta?: any }> {
  const qs = opts.query
    ? '?' +
      new URLSearchParams(
        Object.entries(opts.query).filter(([, v]) => v != null && v !== '') as [string, string][],
      ).toString()
    : ''
  const headers: Record<string, string> = { ...opts.headers }
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (opts.body instanceof FormData) body = opts.body
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await fetch(`/api/v1${path}${qs}`, { method: opts.method ?? 'GET', headers, body, signal: opts.signal })
  if (res.status === 401 && !opts._retried && path !== '/auth/login' && path !== '/auth/refresh' && tokenStore.getRefresh()) {
    const refreshed = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: tokenStore.getRefresh() }) })
    if (refreshed.ok) {
      const payload = await refreshed.json()
      tokenStore.set(payload.data.access_token); tokenStore.setRefresh(payload.data.refresh_token)
      return api<T>(path, { ...opts, _retried: true })
    }
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') {
      tokenStore.clear()
      window.dispatchEvent(new Event('azalas:logout'))
    }
    const err = json?.error
    const msg = err?.message ?? (Array.isArray(json?.detail) ? 'Dữ liệu không hợp lệ.' : 'Có lỗi xảy ra, thử lại.')
    throw new ApiError(res.status, err?.code ?? 'ERROR', msg, err?.details ?? {})
  }
  return json
}

// ---- Types ----
export type User = { id: string; username: string; display_name: string; role: string; roles: string[]; permissions: string[]; phone: string | null; status: string }
export type ReportsOverview = {
  period: { from_date: string; to_date: string }
  cashflow: {
    available: boolean
    invoice_revenue: number | null
    money_in: number | null
    money_out: number | null
    net_cashflow: number | null
    total_debt: number | null
  }
  orders: {
    total_orders: number
    new_orders: number
    picking_orders: number
    picked_orders: number
    invoice_pending: number
    debt_orders: number
    cancelled_orders: number
  }
}
export type ReportActionItem = {
  id: string
  type: string
  severity: string
  reference: string
  entity_id: string
  customer_name: string
  description: string
  occurred_at: string
  target: string
}
export type AuditLogRow = {
  id: string
  entity_type: string
  entity_label: string
  entity_id: string
  entity_code: string | null
  action: string
  action_label: string
  module: string | null
  module_label: string
  actor_user_id: string | null
  actor_name: string | null
  description_vi: string
  request_id: string | null
  before: Record<string, unknown> | unknown[] | null
  after: Record<string, unknown> | unknown[] | null
  occurred_at: string
}
export type Warehouse = { id: string; code: string; name: string }
export type Customer = {
  id: string
  customer_code: string
  name: string
  phone: string | null
  address: string | null
  carrier_name: string | null
  carrier_phone: string | null
  debt_amount: number
  last_order_date: string | null
  created_at: string | null
}
export type CustomerDebtChange = {
  customer_id: string
  customer_code: string
  customer_name: string
  net_change: number
  paid_amount: number
  reduced_amount: number
  increased_amount: number
  change_count: number
  last_changed_at: string | null
}
export type Order = {
  id: string
  order_no: string
  order_group_id: string | null
  customer_id: string
  customer_name: string
  warehouse: Warehouse
  order_type: 'NORMAL' | 'CUSTOMER_ORDER'
  created_date: string
  delivery_date: string | null
  is_urgent: boolean
  customer_note: string | null
  staff_note: string | null
  status: string
  claimed_by_name: string | null
  picked_at: string | null
  total_amount: number
  billing_status: string
  has_active_items?: boolean
  paid_amount: number
  invoice_balance_amount: number
  version: number
  created_at: string | null
  images: { id: string; url: string; view_url?: string; original_name?: string | null; content_type?: string | null }[]
}
export type RecentImage = {
  id: string
  order_id: string
  order_no: string
  customer_id: string
  customer_name: string
  order_date: string
  created_at: string | null
  url: string
  view_url?: string
}
export type RecentImageGroup = {
  date: string
  date_iso: string
  images: RecentImage[]
}
export type CustomerOrderGalleryStatus = 'NOT_PICKED' | 'PICKING' | 'PICKED' | 'SENT' | 'CANCELLED'
export type CustomerOrderGalleryImage = {
  id: string
  url: string
  view_url?: string
  original_name: string | null
  created_at: string | null
  uploaded_by_name: string | null
}
export type CustomerOrderGalleryOrder = {
  group_id: string
  order_id: string
  order_ids: string[]
  order_no: string
  order_numbers: string[]
  customer_id: string
  customer_name: string
  customer_code: string
  created_at: string | null
  order_date: string
  note: string
  status: CustomerOrderGalleryStatus
  created_by_names: string[]
  image_count: number
  images: CustomerOrderGalleryImage[]
}
export type CustomerOrderGalleryGroup = {
  date: string
  date_iso: string
  orders: CustomerOrderGalleryOrder[]
}
export type QueueTab = 'NEW' | 'PICKING' | 'DEBT' | 'CUSTOMER_ORDER'
export type QueueSection = {
  warehouse: Warehouse
  order_count: number
  customers: { customer_id: string; customer_name: string; order_count: number; has_urgent: boolean }[]
}
export type Overview = {
  period: { from_date: string; to_date: string }
  cashflow: {
    available: boolean
    revenue_amount: number | null
    collected_amount: number | null
    receivables_amount: number | null
    payables_amount: number | null
    total_debt_amount: number | null
    remaining_amount: number | null
  }
  orders: {
    total_orders: number
    new_orders: number
    picking_orders: number
    invoice_pending: number
    invoice_sent: number
    debt_orders: number
    cancelled_orders: number
  }
  new_orders: number
  picking_orders: number
  shipping_orders: number
  completed_orders: number
  debt_orders: number
  recent_activity: { order_id: string; order_no: string; customer_name: string; status: string; created_at: string }[]
}
export type PickerStats = {
  month: string
  total: number
  picked: number
  picking: number
  pickers: { user_id: string; name: string; picked: number; picking: number; by_warehouse: Record<string, number>; orders: Order[] }[]
}

export type ProductionMaster = {
  workshops: { id: string; workshop_code: string; name: string; debt_amount: number }[]
  cutting_teams: { id: string; team_code: string; name: string; default_unit_price_amount: number }[]
  patterns: { product_id: string; pattern_code: string | null; name: string }[]
  customers: { id: string; name: string }[]
  colors: { id: string; name: string }[]
  fabrics: { id: string; code: string; name: string }[]
  warehouses: Warehouse[]
  material_catalog: string[]
}

export type ProductionReceipt = {
  id: string
  receipt_no: string
  receipt_date: string
  batch_id: string
  warehouse_id: string
  planned_quantity: number
  actual_quantity: number
  difference_quantity: number
  status: string
  notes: string | null
  received_by: string | null
  lines?: Array<{ id: string; received_now: number; total_received: number; remaining_quantity: number; notes: string | null }>
}

export type ProductionBatch = {
  id: string
  batch_no: string
  cut_date: string
  workshop: { id: string; name: string }
  cutting_team: { id: string; name: string }
  pattern_code: string
  product_id: string | null
  product_name: string
  layer_expression: string
  size_expression?: string | null
  ratio_expression?: string | null
  planned_quantity: number
  delivered_quantity: number
  remaining_quantity: number
  imported_quantity?: number
  expected_delivery_date: string | null
  batch_type: 'CUSTOMER_ORDER' | 'HOUSE'
  customer_id: string | null
  customer_name?: string | null
  customer_code?: string | null
  synced_order_id: string | null
  synced_order_no?: string | null
  workshop_unit_price_amount: number
  workshop_amount: number
  production_status: string
  receipt_status: string
  settlement_status: string
  workshop_settlement_id: string | null
  planned_warehouse_id: string
  notes: string | null
  version: number
  thumbnail?: string | null
  payment_status?: 'paid' | 'unpaid'
  images?: Array<{ id: string; url: string; view_url?: string; original_name: string | null; content_type: string }>
  size_plans?: Array<{ id: string; size: string; color_name: string | null; variant_code: string | null; layers: number; ratio: number; planned_quantity: number; product_variant_id: string | null }>
  receipts?: ProductionReceipt[]
}

export type WorkshopSettlement = {
  id: string
  settlement_no: string
  settlement_date: string
  workshop_id: string
  total_quantity: number
  total_amount: number
  paid_amount: number
  balance_amount: number
  status: string
  notes: string | null
  version: number
  allocated_amount: number
  lines?: Array<{ id: string; production_batch_id: string | null; quantity: number; unit_price_amount: number; amount: number }>
}

export type WorkshopDebtStatement = {
  opening: number
  debit: number
  credit: number
  closing: number
  entries: Array<{
    id: string
    occurred_at: string
    entry_type: string
    debit: number
    credit: number
    balance: number
    reference_type: string | null
    reference_id: string | null
    description: string | null
  }>
}

export type CuttingReportRow = {
  id: string
  report_no: string
  report_date: string
  cutting_team_id: string
  team_name: string
  batch_no: string | null
  pattern_code: string
  quantity: number
  unit_price_amount: number
  amount: number
  status: string
  notes: string | null
  created_by: string | null
}

export type CuttingPaymentRow = {
  id: string
  occurred_at: string
  team_id: string
  team_name: string
  amount: number
  description: string | null
  entered_by: string | null
  reference_id: string | null
}

export type MaterialHistory = {
  catalog: string[]
  totals: { name: string; delivered: number; total_required: number; remaining: number }[]
  events: Array<{ id: string; delivery_no: string; delivery_date: string; received_by: string | null; lines: Array<{ name: string; quantity_delivered: number }> }>
}

export type Partner = {
  id: string
  partner_code: string
  name: string
  partner_type: string
  phone: string | null
  address: string | null
  status: string
  notes: string | null
  debt_amount: number
}

export type FabricReceiptLine = {
  id: string
  entry_type: 'PURCHASE' | 'RETURN'
  receipt_date: string
  fabric_name: string
  unit: 'KG' | 'METER'
  roll_count: number
  gross_quantity: number
  wastage_quantity: number
  net_quantity: number
  deduction_enabled: boolean
  unit_price_amount: number
  transport_amount: number
  amount: number
}

export type FabricReceipt = {
  id: string
  receipt_no: string
  supplier_id: string
  total_amount: number
  status: string
  created_at: string | null
  lines: FabricReceiptLine[]
}

export type FabricDebtSummary = {
  total_debt: number
  net_balance: number
  supplier_count: number
  suppliers: Array<{ supplier_id: string; name: string; balance: number }>
}

export type FabricPayment = {
  id: string
  payment_no: string
  supplier_id: string
  payment_date: string
  amount: number
  method: string
  note: string | null
  status: string
}

export type FabricLedgerEntry = {
  id: string
  occurred_at: string
  entry_type: string
  debit: number
  credit: number
  balance: number
  reference_type: string | null
  reference_id: string | null
  transaction_no: string | null
  description: string | null
  actor_name: string | null
}

export type FabricStatement = {
  supplier: { id: string; name: string; phone: string | null }
  opening: number
  debit: number
  credit: number
  closing: number
  receipts: Array<FabricReceipt & { created_by_name: string | null }>
  entries: FabricLedgerEntry[]
}

export type Material = {
  id: string
  material_code: string
  name: string
  category: string
  unit: string
  status: string
  variants: { id: string; color_id: string | null; size: string | null; display_name: string }[]
}

export type ZipperCatalogItem = {
  id: string
  material_code: string
  name: string
  unit: string
  unit_price_amount: number
  status: string
  price_history_count: number
}

export type ZipperPriceHistory = {
  id: string
  effective_date: string
  unit_price_amount: number
  previous_unit_price_amount: number | null
  changed_by: string | null
  created_at: string | null
}

export type ZipperReceipt = {
  id: string
  receipt_no: string
  receipt_date: string
  partner_id: string
  category: string
  total_amount: number
  status: string
  notes: string | null
  lines: Array<{ id: string; quantity: number; unit_price_amount: number; amount: number }>
}

export type ZipperDebtMonth = {
  month: string
  buy: number
  advance: number
  paid: number
  receipt_count: number
  transaction_count: number
  remaining: number
  group: 'ADVANCE' | 'PENDING' | 'SETTLED'
}

export type ZipperDebtSummary = {
  total_remaining: number
  unallocated_advance: number
  months: ZipperDebtMonth[]
}

export type ZipperMonthPayment = {
  id: string
  month: string
  transaction_type: 'PAYMENT' | 'ADVANCE'
  amount: number
  occurred_date: string
  note: string | null
  created_at: string | null
}

export type ZipperLedgerRow = {
  id: string
  occurred_at: string
  entry_type: string
  debit: number
  credit: number
  balance: number
  description: string | null
}

export type EmbroiderySettlement = {
  id: string
  settlement_no: string
  period_month: string
  total_amount: number
  paid_amount: number
  balance_amount: number
  status: string
  notes: string | null
  version: number
  created_at: string | null
}

export type EmbroideryDebtMonth = {
  month: string
  buy: number
  advance: number
  paid: number
  receipt_count: number
  transaction_count: number
  remaining: number
  group: 'ADVANCE' | 'PENDING' | 'SETTLED'
}

export type EmbroideryDebtSummary = {
  total_remaining: number
  unallocated_advance: number
  months: EmbroideryDebtMonth[]
}

export type EmbroideryMonthPayment = {
  id: string
  month: string
  transaction_type: 'PAYMENT' | 'ADVANCE'
  amount: number
  occurred_date: string
  note: string | null
  created_at: string | null
}

export type EmbroideryLedgerRow = {
  id: string
  occurred_at: string
  entry_type: string
  debit: number
  credit: number
  balance: number
  description: string | null
}

export type PrintingPartnerSettlement = {
  id: string
  settlement_no: string
  period_month: string
  total_amount: number
  paid_amount: number
  balance_amount: number
  status: string
  notes: string | null
  version: number
  media: { id: string; url: string; view_url?: string; original_name: string | null; content_type: string } | null
  created_at: string | null
  created_by_name?: string | null
}

export type PrintingPartnerDebtMonth = {
  month: string
  buy: number
  advance: number
  paid: number
  receipt_count: number
  transaction_count: number
  remaining: number
  group: 'ADVANCE' | 'PENDING' | 'SETTLED'
}

export type PrintingPartnerDebtSummary = {
  total_remaining: number
  unallocated_advance: number
  months: PrintingPartnerDebtMonth[]
}

export type PrintingPartnerMonthPayment = {
  id: string
  month: string
  transaction_type: 'PAYMENT' | 'ADVANCE'
  amount: number
  occurred_date: string
  note: string | null
  created_at: string | null
  created_by_name: string | null
  transaction_no: string | null
}

export type PrintingPartnerLedgerRow = {
  id: string
  occurred_at: string
  entry_type: string
  month: string | null
  transaction_no: string | null
  debit: number
  credit: number
  balance: number
  description: string | null
  actor_name: string | null
}

export type PartnerTransaction = {
  id: string
  transaction_no: string
  partner_id: string
  direction: 'DEBIT' | 'CREDIT'
  transaction_type: string
  amount: number
  occurred_at: string
  description: string | null
  settlement_id: string | null
  status: string
}

export type Employee = {
  id: string
  employee_code: string
  full_name: string
  phone: string | null
  position: string
  daily_rate_amount: number
  start_date: string
  status: string
  notes: string | null
  user_id: string | null
}

export type PayrollRun = {
  id: string
  payroll_no: string
  period_month: string
  status: string
  total_gross_amount: number
  total_advance_amount: number
  total_net_amount: number
  version: number
  lines: Array<{ id: string; employee_id: string; employee_name: string; daily_rate_amount: number; work_units: number; overtime_hours: number; base_amount: number; overtime_amount: number; advance_amount: number; net_amount: number }>
}

export type HrPersonalReport = {
  employee_id: string; employee_name: string; employee_code: string; daily_rate_amount: number
  total_work_units: number; total_overtime_hours: number; total_bonus_amount: number
  total_advance_amount: number; base_amount: number; overtime_amount: number
  gross_amount: number; net_amount: number
  months: Array<{ month: string; work_units: number; overtime_hours: number; bonus_amount: number; advance_amount: number }>
}
export type HrSummaryReport = {
  from_month: string; to_month: string; employee_count: number
  total_work_units: number; total_overtime_hours: number; total_bonus_amount: number
  total_advance_amount: number; total_gross_amount: number; total_net_amount: number
  employees: HrPersonalReport[]
}
export type RateHistory = {
  id: string; employee_id: string; effective_date: string
  old_daily_rate_amount: number; new_daily_rate_amount: number; reason: string | null
}

export type ProductVariant = {
  id: string
  product_id: string
  product_code: string
  pattern_code: string | null
  product_name: string
  internal_code: string
  sales_code: string | null
  color: string | null
  size: string
  display_name: string
  on_hand: number
  reserved: number
  available: number
}

export type PickItem = {
  id?: string
  product_variant_id: string | null
  product_name: string
  sales_code: string | null
  internal_code: string | null
  color: string | null
  size: string | null
  warehouse_id: string
  quantity: number
  unit_price_amount: number
  line_total_amount?: number
  sale_type: string | null
  note: string | null
}

export type OrderDetail = {
  order: Order
  customer: { id: string; name: string; phone: string | null }
  warehouse: Warehouse
  items: PickItem[]
  reservation: null | { id: string; reservation_no: string; status: string; version: number; lines: any[] }
  inventory: any[]
  history: { from_status: string | null; to_status: string; reason: string | null; occurred_at: string }[]
}

export const STATUS_LABEL: Record<string, string> = {
  NEW: 'Mới',
  PICKING: 'Đang soạn',
  PICKED: 'Đã soạn',
  DEBT_ORDER: 'Nợ đơn',
  SHIPPING: 'Đang vận chuyển',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Hủy',
  DELETED: 'Xóa',
  RETURNED: 'Trả hàng',
}

export type Invoice = {
  id: string; invoice_no: string; customer_id: string; status: string; issued_at: string
  subtotal_amount: number; surcharge_amount: number; return_credit_amount: number
  paid_amount: number; balance_amount: number; debt_before_amount: number; debt_after_amount: number
  note: string | null; version: number; order_ids: string[]; allocated_amount: number
  unallocated_credit_amount: number; snapshot: any
  captured_invoice_media_id: string | null; captured_at: string | null
  captured_image: { id: string; url: string; view_url?: string; original_name: string | null; content_type: string | null } | null
}

export type InvoiceWorkQueue = {
  status: string
  total: number
  groups: Array<{ customer_id: string; customer_name: string; orders?: Order[]; invoices?: Invoice[] }>
}

export type InvoiceCapture = {
  id: string; media_id: string; url: string; view_url?: string; original_name: string | null; content_type: string | null
}

export type InvoicePreview = {
  customer: { id: string; customer_code: string; name: string; phone: string | null; address: string | null }
  orders: Array<{ id: string; order_no: string; amount: number; items: any[]
    images?: Array<{ id: string; url: string; view_url?: string; original_name: string | null }> }>
  subtotal_amount: number; surcharge_amount: number; return_credit_amount: number
  amount_due_before_payment: number; debt_before_amount: number; debt_after_before_payment: number
  available_returns: Array<{ id: string; return_no: string; amount: number; note: string | null }>
}

export type ReturnRecord = {
  id: string; return_no: string; customer_id: string; customer_name: string
  warehouse: Warehouse; status: string; total_credit_amount: number
  restock_posted: boolean; credit_posted: boolean; note: string | null; version: number
  created_at: string; approved_at: string | null
  items: Array<{ id: string; product_variant_id: string | null; description: string; quantity: number
    unit_credit_amount: number; line_credit_amount: number; condition: string | null; restock: boolean }>
}

export type DebtStatement = {
  customer: { id: string; name: string }; opening: number; debit: number; credit: number; closing: number
  entries: Array<{ id: string; occurred_at: string; entry_type: string; debit: number; credit: number
    amount_delta: number; balance: number; description: string | null }>
}
