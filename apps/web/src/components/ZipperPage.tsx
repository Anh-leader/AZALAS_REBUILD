import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type ZipperCatalogItem, type ZipperDebtMonth, type ZipperDebtSummary, type ZipperLedgerRow, type ZipperMonthPayment, type ZipperPriceHistory, type ZipperReceipt } from '../api/client'
import { formatDate, formatMoney, todayIso } from '../lib/format'

type Tab = 'receipt' | 'catalog' | 'debt'
type Line = { key: string; material_id: string; name: string; quantity: string; unit_price_amount: string }

function message(error: unknown) { return error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.' }

export function ZipperPage({ onBack }: { onBack?: () => void }) {
  const [tab, setTab] = useState<Tab>('receipt')
  return <section className="page materials-page">
    {onBack && <button className="btn-back" onClick={onBack}>← Quay lại Phụ liệu</button>}
    <h1>Quản lý Dây kéo</h1>
    <div className="tabs">
      <button className={tab === 'receipt' ? 'active' : ''} onClick={() => setTab('receipt')}>Nhập Hàng</button>
      <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>Giá & Danh Mục</button>
      <button className={tab === 'debt' ? 'active' : ''} onClick={() => setTab('debt')}>Công Nợ</button>
    </div>
    {tab === 'receipt' && <ReceiptTab/>}
    {tab === 'catalog' && <CatalogTab/>}
    {tab === 'debt' && <DebtTab/>}
  </section>
}

function ReceiptTab() {
  const qc = useQueryClient()
  const catalog = useQuery({ queryKey: ['zipper-catalog'], queryFn: () => api<ZipperCatalogItem[]>('/materials/zippers/catalog').then(r => r.data) })
  const [date, setDate] = useState(todayIso())
  const [lines, setLines] = useState<Line[]>([{ key: crypto.randomUUID(), material_id: '', name: '', quantity: '1', unit_price_amount: '' }])
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('')

  function patchLine(key: string, patch: Partial<Line>) {
    setLines(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row))
  }
  function chooseMaterial(key: string, materialId: string) {
    const item = catalog.data?.find(row => row.id === materialId)
    setLines(rows => rows.map(row => row.key === key
      ? { ...row, material_id: materialId, name: item?.name || '', unit_price_amount: item ? String(item.unit_price_amount) : row.unit_price_amount }
      : row))
  }
  function addLine() { setLines(rows => [...rows, { key: crypto.randomUUID(), material_id: '', name: '', quantity: '1', unit_price_amount: '' }]) }
  function removeLine(key: string) { setLines(rows => (rows.length > 1 ? rows.filter(row => row.key !== key) : rows)) }

  const total = useMemo(() => lines.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.unit_price_amount) || 0), 0), [lines])

  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess('')
    const valid = lines.filter(row => row.material_id && Number(row.quantity) > 0 && Number(row.unit_price_amount) > 0)
    if (!valid.length) { setError('Chưa có dòng sản phẩm hợp lệ. Vui lòng chọn dây kéo, nhập SL và giá.'); return }
    setBusy(true)
    try {
      const response = await api<ZipperReceipt>('/materials/zippers/receipts', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: {
        receipt_date: date,
        lines: valid.map(row => ({ material_id: row.material_id, quantity: Number(row.quantity), unit_price_amount: Number(row.unit_price_amount) })),
      } })
      setSuccess(`Đã lưu phiếu ${response.data.receipt_no} · ${formatMoney(response.data.total_amount)}`)
      setLines([{ key: crypto.randomUUID(), material_id: '', name: '', quantity: '1', unit_price_amount: '' }])
      await qc.invalidateQueries({ queryKey: ['zipper-receipts'] })
    } catch (caught) { setError(message(caught)) } finally { setBusy(false) }
  }

  return <form className="card production-form" onSubmit={save}>
    <h2 className="section-title"><i className="bi bi-box-seam"/>Nhập Hàng</h2>
    <label>Ngày nhập hàng *<input required className="form-control" type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
    <div className="zipper-lines">
      <div className="zipper-line-head"><span>#</span><span>Tên Dây Kéo</span><span>SL</span><span>Giá</span><span>T.Tiền</span><span/></div>
      {lines.map((line, index) => <div className="zipper-line" key={line.key}>
        <span>{index + 1}</span>
        <select className="form-control" value={line.material_id} onChange={e => chooseMaterial(line.key, e.target.value)}><option value="">-- Chọn dây kéo --</option>{catalog.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <input className="form-control" type="number" min="1" value={line.quantity} onChange={e => patchLine(line.key, { quantity: e.target.value })}/>
        <input className="form-control" type="number" min="1" value={line.unit_price_amount} onChange={e => patchLine(line.key, { unit_price_amount: e.target.value })}/>
        <strong>{formatMoney((Number(line.quantity) || 0) * (Number(line.unit_price_amount) || 0))}</strong>
        <button type="button" className="line-remove" onClick={() => removeLine(line.key)}>×</button>
      </div>)}
    </div>
    <button type="button" className="btn-outline" onClick={addLine}>+ THÊM DÒNG SẢN PHẨM</button>
    <div className="zipper-total">TỔNG TIỀN NHẬP: <strong>{formatMoney(total)}</strong></div>
    {success && <div className="success-text">{success}</div>}{error && <div className="error-text">{error}</div>}
    <button className="btn-main" disabled={busy}>{busy ? 'ĐANG LƯU…' : 'XÁC NHẬN NHẬP KHO'}</button>
  </form>
}

function CatalogTab() {
  const qc = useQueryClient()
  const catalog = useQuery({ queryKey: ['zipper-catalog'], queryFn: () => api<ZipperCatalogItem[]>('/materials/zippers/catalog').then(r => r.data) })
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [effectiveDate, setEffectiveDate] = useState(todayIso())
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [busy, setBusy] = useState(false)
  const [historyId, setHistoryId] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess('')
    if (!name.trim()) { setError('Tên dây kéo là bắt buộc.'); return }
    const value = Number(price)
    if (!Number.isFinite(value) || value <= 0) { setError('Giá áp dụng phải lớn hơn 0.'); return }
    setBusy(true)
    try {
      await api('/materials/zippers/catalog', { method: 'POST', body: { name: name.trim(), unit_price_amount: value, effective_date: effectiveDate } })
      setSuccess('Đã lưu vào danh mục.'); setName(''); setPrice('')
      await qc.invalidateQueries({ queryKey: ['zipper-catalog'] })
    } catch (caught) { setError(message(caught)) } finally { setBusy(false) }
  }

  return <div className="card production-form">
    <h2 className="section-title"><i className="bi bi-tags"/>Giá & Danh Mục</h2>
    <p className="muted">Hướng dẫn: Để thay đổi giá, bạn chỉ cần gõ lại Tên dây kéo cũ, nhập giá mới và chọn ngày. Hệ thống sẽ tự lưu lịch sử giá mới.</p>
    <form onSubmit={save}>
      <div className="production-grid">
        <label>Tên dây kéo *<input required className="form-control" placeholder="Gõ tên để tìm hoặc tạo mới..." value={name} onChange={e => setName(e.target.value)}/></label>
        <label>Giá áp dụng (đ/sợi) *<input required className="form-control" type="number" min="1" placeholder="VD: 1200" value={price} onChange={e => setPrice(e.target.value)}/></label>
        <label>Ngày bắt đầu tính giá này *<input required className="form-control" type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)}/></label>
      </div>
      {success && <div className="success-text">{success}</div>}{error && <div className="error-text">{error}</div>}
      <button className="btn-main" disabled={busy}>{busy ? 'ĐANG LƯU…' : 'LƯU VÀO DANH MỤC'}</button>
    </form>
    <h3 className="section-title">Danh sách dây kéo</h3>
    {catalog.data?.length ? <div className="zipper-catalog">{catalog.data.map(row => <button type="button" key={row.id} className="compact-row" onClick={() => setHistoryId(historyId === row.id ? null : row.id)}><span><b>{row.name}</b><small>{row.material_code} · {row.unit}</small></span><strong>{formatMoney(row.unit_price_amount)}</strong><small>{row.price_history_count} lần đổi giá</small></button>)}</div> : <div className="empty">Chưa có dây kéo trong danh mục.</div>}
    {historyId && <PriceHistory materialId={historyId}/>}
  </div>
}

function PriceHistory({ materialId }: { materialId: string }) {
  const history = useQuery({ queryKey: ['zipper-price-history', materialId], queryFn: () => api<ZipperPriceHistory[]>(`/materials/zippers/${materialId}/price-history`).then(r => r.data) })
  return <div className="card-inner"><b>Lịch sử giá</b>{history.data?.map(row => <div className="compact-row" key={row.id}><span>{formatDate(row.effective_date)}</span><b>{formatMoney(row.unit_price_amount)}</b><small>{row.previous_unit_price_amount != null ? `trước ${formatMoney(row.previous_unit_price_amount)}` : 'giá đầu tiên'}</small></div>)}</div>
}

function DebtTab() {
  const qc = useQueryClient()
  const summary = useQuery({ queryKey: ['zipper-debt-summary'], queryFn: () => api<ZipperDebtSummary>('/materials/zippers/debt-summary').then(r => r.data) })
  const ledger = useQuery({ queryKey: ['zipper-ledger'], queryFn: () => api<ZipperLedgerRow[]>('/materials/zippers/ledger').then(r => r.data) })
  const [receiptMonth, setReceiptMonth] = useState<string | null>(null)
  const [payMonth, setPayMonth] = useState<string | null>(null)
  const [payModal, setPayModal] = useState<ZipperDebtMonth | null>(null)
  const [advanceModal, setAdvanceModal] = useState<ZipperDebtMonth | null>(null)

  const groups: Array<['ADVANCE' | 'PENDING' | 'SETTLED', string]> = [
    ['ADVANCE', 'ỨNG TIỀN TRƯỚC'], ['PENDING', 'CẦN XỬ LÝ'], ['SETTLED', 'ĐÃ THANH TOÁN XONG'],
  ]

  async function invalidate() {
    await qc.invalidateQueries({ queryKey: ['zipper-debt-summary'] })
    await qc.invalidateQueries({ queryKey: ['zipper-ledger'] })
    await qc.invalidateQueries({ queryKey: ['zipper-month-payments'] })
  }

  return <div className="card production-form">
    <h2 className="section-title"><i className="bi bi-cash-stack"/>Công Nợ Dây Kéo</h2>
    <div className="money-grid">
      <span>Công nợ còn lại<b className="debt">{formatMoney(summary.data?.total_remaining ?? 0)}</b></span>
      <span>Dư ứng<b>{formatMoney(summary.data?.unallocated_advance ?? 0)}</b></span>
    </div>
    <p className="muted">Tính theo từng tháng: Tổng mua hàng - Tổng đã ứng/thanh toán.</p>

    {summary.data?.months.length ? <div className="zipper-debt-groups">
      {groups.map(([group, label]) => {
        const months = summary.data!.months.filter(m => m.group === group)
        if (!months.length) return null
        return <div key={group} className="zipper-debt-group"><h3>{label}</h3>
          {months.map(m => <div className="zipper-debt-month" key={m.month}>
            <header><b>{monthLabel(m.month)}</b><small>{m.receipt_count} phiếu mua · {m.transaction_count} giao dịch tiền</small></header>
            <div className="zipper-debt-grid">
              <span>MUA HÀNG<b>{formatMoney(m.buy)}</b></span>
              <span>ĐÃ ỨNG/TRẢ<b>{formatMoney(m.advance + m.paid)}</b><small>Ứng: {formatMoney(m.advance)} · Trả: {formatMoney(m.paid)}</small></span>
              <span>CÒN LẠI<b className={m.remaining > 0 ? 'debt' : ''}>{formatMoney(m.remaining)}</b></span>
            </div>
            <div className="action-row">
              <button className="btn-outline" onClick={() => setReceiptMonth(receiptMonth === m.month ? null : m.month)}>Chi tiết mua hàng tháng</button>
              <button className="btn-outline" onClick={() => setPayMonth(payMonth === m.month ? null : m.month)}>Chi tiết thanh toán</button>
              <button className="btn-outline" onClick={() => setPayModal(m)}>Thanh toán</button>
              <button className="btn-outline" onClick={() => setAdvanceModal(m)}>Ứng thêm</button>
            </div>
            {receiptMonth === m.month && <ReceiptDetail month={m.month}/>}
            {payMonth === m.month && <PaymentDetail month={m.month}/>}
          </div>)}
        </div>
      })}
    </div> : <div className="empty">Chưa có giao dịch dây kéo trong 10 tháng gần đây.</div>}

    <h3 className="section-title">Lịch sử giao dịch</h3>
    {ledger.data?.length ? <div className="zipper-ledger">{ledger.data.map(row => <div className="zipper-ledger-row" key={row.id}><span><b>{row.description || row.entry_type}</b><small>{formatDate(row.occurred_at)}</small></span><em>{row.debit ? `+${formatMoney(row.debit)}` : `-${formatMoney(row.credit)}`}</em><strong>{formatMoney(row.balance)}</strong></div>)}</div> : <div className="empty">Chưa có giao dịch.</div>}

    {payModal && <MoneyModal title="Thanh toán dây kéo" month={payModal} onSaved={invalidate} onClose={() => setPayModal(null)}/>}
    {advanceModal && <MoneyModal title="Ứng tiền dây kéo" month={advanceModal} advance onSaved={invalidate} onClose={() => setAdvanceModal(null)}/>}
  </div>
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-')
  return `Tháng ${m}/${y}`
}

function ReceiptDetail({ month }: { month: string }) {
  const receipts = useQuery({ queryKey: ['zipper-month-receipts', month], queryFn: () => api<ZipperReceipt[]>(`/materials/zippers/monthly/${month}/receipts`).then(r => r.data) })
  if (receipts.isLoading) return <div className="loading">Đang tải…</div>
  if (!receipts.data?.length) return <div className="empty">Tháng này chưa có phiếu nhập.</div>
  const total = receipts.data.reduce((sum, r) => sum + r.total_amount, 0)
  return <div className="card-inner"><b>Chi tiết mua hàng · {monthLabel(month)}</b>
    <div className="zipper-detail-table"><div className="zipper-detail-head"><span>Ngày</span><span>Mã phiếu</span><span>SL</span><span>Đơn giá</span><span>Thành tiền</span></div>
      {receipts.data.flatMap(r => r.lines.map(line => <div className="zipper-detail-row" key={line.id}><span>{formatDate(r.receipt_date)}</span><span>{r.receipt_no}</span><span>{line.quantity}</span><span>{formatMoney(line.unit_price_amount)}</span><strong>{formatMoney(line.amount)}</strong></div>))}
    </div>
    <div className="zipper-total">Tổng mua tháng: <strong>{formatMoney(total)}</strong></div>
  </div>
}

function PaymentDetail({ month }: { month: string }) {
  const payments = useQuery({ queryKey: ['zipper-month-payments', month], queryFn: () => api<ZipperMonthPayment[]>(`/materials/zippers/monthly/${month}/payments`).then(r => r.data) })
  if (payments.isLoading) return <div className="loading">Đang tải…</div>
  if (!payments.data?.length) return <div className="empty">Chưa có thanh toán/ứng trong tháng.</div>
  const total = payments.data.reduce((sum, r) => sum + r.amount, 0)
  return <div className="card-inner"><b>Chi tiết thanh toán / ứng · {monthLabel(month)}</b>
    <div className="zipper-detail-table"><div className="zipper-detail-head"><span>Ngày</span><span>Loại</span><span>Số tiền</span><span>Ghi chú</span></div>
      {payments.data.map(row => <div className="zipper-detail-row" key={row.id}><span>{formatDate(row.occurred_date)}</span><span>{row.transaction_type === 'ADVANCE' ? 'Ứng' : 'Trừ Nợ'}</span><strong>{formatMoney(row.amount)}</strong><span>{row.note || ''}</span></div>)}
    </div>
    <div className="zipper-total">Tổng ứng/trả: <strong>{formatMoney(total)}</strong></div>
  </div>
}

function MoneyModal({ title, month, advance, onSaved, onClose }: { title: string; month: ZipperDebtMonth; advance?: boolean; onSaved: () => void; onClose: () => void }) {
  const [date, setDate] = useState(todayIso()); const [amount, setAmount] = useState(''); const [note, setNote] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function save(event: FormEvent) {
    event.preventDefault(); setError('')
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) { setError('Số tiền phải lớn hơn 0.'); return }
    setBusy(true)
    try {
      const path = advance ? '/materials/zippers/advances' : '/materials/zippers/payments'
      await api(path, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { month: month.month, amount: value, date, note: note.trim() || null } })
      await onSaved(); onClose()
    } catch (caught) { setError(message(caught)) } finally { setBusy(false) }
  }
  return <div className="modal-layer"><form className="modal-card" onSubmit={save}>
    <h2>{title}</h2>
    <p className="muted">{monthLabel(month.month)} · Còn lại: {formatMoney(month.remaining)}</p>
    {advance && <p className="muted">Ứng trước hoặc ứng thêm đúng tháng.</p>}
    <label>Ngày {advance ? 'ứng' : 'thanh toán'}<input required className="form-control" type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
    <label>Số tiền<input required className="form-control" type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)}/></label>
    <label>Ghi chú<input className="form-control" placeholder={advance ? 'Ứng thêm tiền dây kéo…' : 'Thanh toán tiền dây kéo…'} value={note} onChange={e => setNote(e.target.value)}/></label>
    {error && <div className="error-text">{error}</div>}
    <div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={busy}>Hủy</button><button className="btn-main" disabled={busy}>{busy ? 'ĐANG LƯU…' : advance ? 'XÁC NHẬN ỨNG' : 'XÁC NHẬN THANH TOÁN'}</button></div>
  </form></div>
}
