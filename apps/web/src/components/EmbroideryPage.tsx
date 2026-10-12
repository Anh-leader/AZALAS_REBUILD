import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type EmbroideryDebtMonth, type EmbroideryDebtSummary, type EmbroideryLedgerRow, type EmbroideryMonthPayment, type EmbroiderySettlement } from '../api/client'
import { formatDate, formatMoney, todayIso } from '../lib/format'

type Tab = 'settle' | 'debt'

function message(error: unknown) { return error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.' }
const currentMonth = () => todayIso().slice(0, 7)
function monthLabel(month: string): string { const [y, m] = month.split('-'); return `Tháng ${m}/${y}` }

export function EmbroideryPage({ onBack }: { onBack?: () => void }) {
  const [tab, setTab] = useState<Tab>('settle')
  return <section className="page materials-page">
    {onBack && <button className="btn-back" onClick={onBack}>← Quay lại Phụ liệu</button>}
    <h1>Quản lý Thêu</h1>
    <div className="tabs">
      <button className={tab === 'settle' ? 'active' : ''} onClick={() => setTab('settle')}>Chốt Tháng</button>
      <button className={tab === 'debt' ? 'active' : ''} onClick={() => setTab('debt')}>Công Nợ</button>
    </div>
    {tab === 'settle' && <SettleTab/>}
    {tab === 'debt' && <DebtTab/>}
  </section>
}

function SettleTab() {
  const qc = useQueryClient()
  const [month, setMonth] = useState(currentMonth()); const [amount, setAmount] = useState('')
  const [note, setNote] = useState(''); const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [busy, setBusy] = useState(false)
  const settlements = useQuery({ queryKey: ['embroidery-settlements'], queryFn: () => api<EmbroiderySettlement[]>('/materials/embroidery/monthly-settlements').then(r => r.data) })
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess('')
    const value = Number(amount)
    if (!month) { setError('Vui lòng chọn tháng/năm chốt sổ.'); return }
    if (!Number.isFinite(value) || value <= 0) { setError('Tổng số tiền thêu phải lớn hơn 0.'); return }
    setBusy(true)
    try {
      await api('/materials/embroidery/monthly-settlements', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { period_month: month, amount: value, note: note.trim() || null } })
      setSuccess(`Đã chốt tiền thêu tháng ${month}.`); setAmount(''); setNote('')
      await qc.invalidateQueries({ queryKey: ['embroidery-settlements'] })
    } catch (caught) { setError(message(caught)) } finally { setBusy(false) }
  }
  return <div className="card production-form">
    <h2 className="section-title"><i className="bi bi-brush"/>Chốt Tháng</h2>
    <p className="muted">Gợi ý: Tại đây bạn chỉ cần chốt số tổng số tiền thêu của nguyên 1 tháng để hệ thống ghi nhận vào công nợ.</p>
    <form onSubmit={save}>
      <div className="production-grid">
        <label>Chọn tháng / năm chốt sổ *<input required className="form-control" type="month" value={month} onChange={e => setMonth(e.target.value)}/></label>
        <label>Tổng số tiền thêu (VNĐ) *<input required className="form-control" type="number" min="1" placeholder="VD: 5000000" value={amount} onChange={e => setAmount(e.target.value)}/></label>
        <label>Ghi chú<input className="form-control" placeholder="VD: Chốt tiền thêu tháng…" value={note} onChange={e => setNote(e.target.value)}/></label>
      </div>
      {success && <div className="success-text">{success}</div>}{error && <div className="error-text">{error}</div>}
      <button className="btn-main" disabled={busy}>{busy ? 'ĐANG LƯU…' : 'XÁC NHẬN LƯU SỔ'}</button>
    </form>
    <h3 className="section-title">Đã chốt gần đây</h3>
    {settlements.data?.length ? <div className="zipper-catalog">{settlements.data.map(row => <div className="compact-row" key={row.id}><span><b>{row.period_month}</b><small>{row.settlement_no}</small></span><strong>{formatMoney(row.total_amount)}</strong><small>{row.status === 'UNPAID' ? 'Còn nợ' : row.status}</small></div>)}</div> : <div className="empty">Chưa có chốt thêu nào.</div>}
  </div>
}

function DebtTab() {
  const qc = useQueryClient()
  const summary = useQuery({ queryKey: ['embroidery-debt-summary'], queryFn: () => api<EmbroideryDebtSummary>('/materials/embroidery/debt-summary').then(r => r.data) })
  const ledger = useQuery({ queryKey: ['embroidery-ledger'], queryFn: () => api<EmbroideryLedgerRow[]>('/materials/embroidery/ledger').then(r => r.data) })
  const [settleMonth, setSettleMonth] = useState<string | null>(null)
  const [payMonth, setPayMonth] = useState<string | null>(null)
  const [payModal, setPayModal] = useState<EmbroideryDebtMonth | null>(null)
  const [advanceModal, setAdvanceModal] = useState<EmbroideryDebtMonth | null>(null)

  const groups: Array<['ADVANCE' | 'PENDING' | 'SETTLED', string]> = [
    ['ADVANCE', 'ỨNG TIỀN TRƯỚC'], ['PENDING', 'CẦN XỬ LÝ'], ['SETTLED', 'ĐÃ THANH TOÁN XONG'],
  ]

  async function invalidate() {
    await qc.invalidateQueries({ queryKey: ['embroidery-debt-summary'] })
    await qc.invalidateQueries({ queryKey: ['embroidery-ledger'] })
    await qc.invalidateQueries({ queryKey: ['embroidery-month-payments'] })
  }

  return <div className="card production-form">
    <h2 className="section-title"><i className="bi bi-cash-stack"/>Công Nợ Thêu</h2>
    <div className="money-grid">
      <span>Công nợ còn lại<b className="debt">{formatMoney(summary.data?.total_remaining ?? 0)}</b></span>
      <span>Dư ứng<b>{formatMoney(summary.data?.unallocated_advance ?? 0)}</b></span>
    </div>
    <p className="muted">Tính riêng từng tháng: Tổng đã chốt - Tổng đã ứng/thanh toán.</p>

    {summary.data?.months.length ? <div className="zipper-debt-groups">
      {groups.map(([group, label]) => {
        const months = summary.data!.months.filter(m => m.group === group)
        if (!months.length) return null
        return <div key={group} className="zipper-debt-group"><h3>{label}</h3>
          {months.map(m => <div className="zipper-debt-month" key={m.month}>
            <header><b>{monthLabel(m.month)}</b><small>{m.receipt_count} phiếu chốt · {m.transaction_count} giao dịch tiền</small></header>
            <div className="zipper-debt-grid">
              <span>ĐÃ CHỐT<b>{formatMoney(m.buy)}</b></span>
              <span>ĐÃ ỨNG/TRẢ<b>{formatMoney(m.advance + m.paid)}</b><small>Ứng: {formatMoney(m.advance)} · Trả: {formatMoney(m.paid)}</small></span>
              <span>CÒN LẠI<b className={m.remaining > 0 ? 'debt' : ''}>{formatMoney(m.remaining)}</b></span>
            </div>
            <div className="action-row">
              <button className="btn-outline" onClick={() => setSettleMonth(settleMonth === m.month ? null : m.month)}>Chi tiết chốt tháng</button>
              <button className="btn-outline" onClick={() => setPayMonth(payMonth === m.month ? null : m.month)}>Chi tiết thanh toán</button>
              <button className="btn-outline" onClick={() => setPayModal(m)}>Thanh toán</button>
              <button className="btn-outline" onClick={() => setAdvanceModal(m)}>Ứng thêm</button>
            </div>
            {settleMonth === m.month && <SettleDetail month={m.month}/>}
            {payMonth === m.month && <PaymentDetail month={m.month}/>}
          </div>)}
        </div>
      })}
    </div> : <div className="empty">Không có tháng nào cần xử lý.</div>}

    <h3 className="section-title">Lịch sử giao dịch thêu</h3>
    {ledger.data?.length ? <div className="zipper-ledger">{ledger.data.map(row => <div className="zipper-ledger-row" key={row.id}><span><b>{row.description || row.entry_type}</b><small>{formatDate(row.occurred_at)}</small></span><em>{row.debit ? `+${formatMoney(row.debit)}` : `-${formatMoney(row.credit)}`}</em><strong>{formatMoney(row.balance)}</strong></div>)}</div> : <div className="empty">Chưa có giao dịch Thêu.</div>}

    {payModal && <MoneyModal title="Thanh toán thêu" month={payModal} onSaved={invalidate} onClose={() => setPayModal(null)}/>}
    {advanceModal && <MoneyModal title="Ứng tiền thêu" month={advanceModal} advance onSaved={invalidate} onClose={() => setAdvanceModal(null)}/>}
  </div>
}

function SettleDetail({ month }: { month: string }) {
  const settlements = useQuery({ queryKey: ['embroidery-month-settlements', month], queryFn: () => api<EmbroiderySettlement[]>(`/materials/embroidery/monthly/${month}/settlements`).then(r => r.data) })
  if (settlements.isLoading) return <div className="loading">Đang tải…</div>
  if (!settlements.data?.length) return <div className="empty">Tháng này chưa có chốt thêu nào.</div>
  const total = settlements.data.reduce((sum, r) => sum + r.total_amount, 0)
  return <div className="card-inner"><b>Chi tiết chốt tháng · {monthLabel(month)}</b>
    <div className="zipper-detail-table"><div className="zipper-detail-head"><span>Mã chốt</span><span>Tháng</span><span>Số tiền</span><span>Trạng thái</span></div>
      {settlements.data.map(row => <div className="zipper-detail-row" key={row.id}><span>{row.settlement_no}</span><span>{monthLabel(row.period_month)}</span><strong>{formatMoney(row.total_amount)}</strong><span>{row.status}</span></div>)}
    </div>
    <div className="zipper-total">Tổng chốt tháng: <strong>{formatMoney(total)}</strong></div>
  </div>
}

function PaymentDetail({ month }: { month: string }) {
  const payments = useQuery({ queryKey: ['embroidery-month-payments', month], queryFn: () => api<EmbroideryMonthPayment[]>(`/materials/embroidery/monthly/${month}/payments`).then(r => r.data) })
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

function MoneyModal({ title, month, advance, onSaved, onClose }: { title: string; month: EmbroideryDebtMonth; advance?: boolean; onSaved: () => void; onClose: () => void }) {
  const [date, setDate] = useState(todayIso()); const [amount, setAmount] = useState(''); const [note, setNote] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function save(event: FormEvent) {
    event.preventDefault(); setError('')
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) { setError('Số tiền phải lớn hơn 0.'); return }
    setBusy(true)
    try {
      const path = advance ? '/materials/embroidery/advances' : '/materials/embroidery/payments'
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
    <label>Ghi chú<input className="form-control" placeholder={advance ? 'Ứng trước tiền thêu…' : 'Thanh toán tiền thêu…'} value={note} onChange={e => setNote(e.target.value)}/></label>
    {error && <div className="error-text">{error}</div>}
    <div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={busy}>Hủy</button><button className="btn-main" disabled={busy}>{busy ? 'ĐANG LƯU…' : advance ? 'XÁC NHẬN ỨNG' : 'XÁC NHẬN THANH TOÁN'}</button></div>
  </form></div>
}
