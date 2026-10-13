import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type PrintingPartnerDebtMonth, type PrintingPartnerDebtSummary, type PrintingPartnerLedgerRow, type PrintingPartnerMonthPayment, type PrintingPartnerSettlement } from '../api/client'
import { openAuthenticatedMedia } from '../api/media'
import { formatDate, formatMoney, todayIso } from '../lib/format'

type Tab = 'settle' | 'debt'
export type PrintingPartnerKey = 'nhat' | 'tung'
const PARTNER_LABEL: Record<PrintingPartnerKey, string> = { nhat: 'NHẬT - IN', tung: 'TÙNG - IN' }
const partnerPath = (partner: PrintingPartnerKey) => `/materials/printing/${partner}`

function message(error: unknown) { return error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.' }
const currentMonth = () => todayIso().slice(0, 7)
function monthLabel(month: string): string { const [y, m] = month.split('-'); return `Tháng ${m}/${y}` }

export function PrintingPartnerPage({ partner, onBack }: { partner: PrintingPartnerKey; onBack?: () => void }) {
  const [tab, setTab] = useState<Tab>('settle')
  return <section className="page materials-page">
    {onBack && <button className="btn-back" onClick={onBack}>← Quay lại Phụ liệu</button>}
    <h1>{PARTNER_LABEL[partner]} <span className="type-badge badge-khach-dat">Dữ liệu tách riêng</span></h1>
    <div className="tabs">
      <button className={tab === 'settle' ? 'active' : ''} onClick={() => setTab('settle')}>Chốt tháng</button>
      <button className={tab === 'debt' ? 'active' : ''} onClick={() => setTab('debt')}>Công nợ & thanh toán</button>
    </div>
    {tab === 'settle' && <SettleTab partner={partner}/>}
    {tab === 'debt' && <DebtTab partner={partner}/>}
  </section>
}

function SettleTab({ partner }: { partner: PrintingPartnerKey }) {
  const qc = useQueryClient()
  const [month, setMonth] = useState(currentMonth()); const [amount, setAmount] = useState('')
  const [note, setNote] = useState(''); const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const label = PARTNER_LABEL[partner]
  const settlements = useQuery({ queryKey: [partner, 'printing-settlements'], queryFn: () => api<PrintingPartnerSettlement[]>(`${partnerPath(partner)}/monthly-settlements`).then(r => r.data) })
  function choose(event: ChangeEvent<HTMLInputElement>) { setFile(event.target.files?.[0] || null) }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess('')
    const value = Number(amount)
    if (!month) { setError('Vui lòng chọn tháng/năm.'); return }
    if (!Number.isSafeInteger(value) || value <= 0) { setError('Số tiền phải là số nguyên lớn hơn 0.'); return }
    setBusy(true)
    try {
      let mediaId: string | null = null
      if (file) {
        const form = new FormData(); form.append('file', file)
        const media = await api<{ id: string }>(`/media/upload/printing/${partner}`, { method: 'POST', body: form })
        mediaId = media.data.id
      }
      await api(`${partnerPath(partner)}/monthly-settlements`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { period_month: month, amount: value, note: note.trim() || null, media_id: mediaId } })
      setSuccess(`Đã chốt tiền ${label} tháng ${month}.`); setAmount(''); setNote(''); setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      await Promise.all([
        qc.invalidateQueries({ queryKey: [partner, 'printing-settlements'] }),
        qc.invalidateQueries({ queryKey: [partner, 'printing-debt-summary'] }),
        qc.invalidateQueries({ queryKey: [partner, 'printing-ledger'] }),
        qc.invalidateQueries({ queryKey: [partner, 'printing-month-settlements', month] }),
      ])
    } catch (caught) { setError(message(caught)) } finally { setBusy(false) }
  }
  return <div className="card production-form">
    <h2 className="section-title"><i className="bi bi-printer"/>Chốt công nợ theo tháng</h2>
    <p className="muted">{label} — mỗi lần chốt được ghi vào đúng sổ {partner === 'nhat' ? 'Nhật' : 'Tùng'}.</p>
    <form onSubmit={save}>
      <div className="production-grid">
        <label>Tháng / năm *<input required className="form-control" type="month" value={month} onChange={e => setMonth(e.target.value)}/></label>
        <label>Số tiền *<input required className="form-control" type="number" min="1" step="1" placeholder={`Nhập tổng tiền của ${label}`} value={amount} onChange={e => setAmount(e.target.value)}/></label>
        <label>Ghi chú<input className="form-control" placeholder="VD: File in tháng 08" value={note} onChange={e => setNote(e.target.value)}/></label>
        <label>File PDF đối chiếu<input ref={fileInput} className="form-control" type="file" accept="application/pdf,.pdf" onChange={choose}/>{file && <small>Đã chọn: {file.name}</small>}</label>
      </div>
      <p className="muted">File được tự động lưu vào thư mục riêng {partner === 'nhat' ? 'NHAT_IN' : 'TUNG_IN'}.</p>
      {success && <div className="success-text">{success}</div>}{error && <div className="error-text">{error}</div>}
      <button className="btn-main" disabled={busy}>{busy ? 'ĐANG LƯU…' : `CHỐT THÁNG ${label}`}</button>
    </form>
    <h3 className="section-title">Đã chốt gần đây</h3>
    {settlements.data?.length ? <div className="zipper-catalog">{settlements.data.map(row => <div className="compact-row" key={row.id}><span><b>{row.period_month}</b><small>{row.settlement_no}{row.media && <> · <AuthenticatedFileLink url={row.media.url} label={row.media.original_name || 'Xem file PDF'}/></>}</small></span><strong>{formatMoney(row.total_amount)}</strong><small>{row.status === 'UNPAID' ? 'Còn nợ' : row.status}</small></div>)}</div> : <div className="empty">Chưa có chốt {label} nào.</div>}
  </div>
}

function DebtTab({ partner }: { partner: PrintingPartnerKey }) {
  const qc = useQueryClient()
  const label = PARTNER_LABEL[partner]
  const summary = useQuery({ queryKey: [partner, 'printing-debt-summary'], queryFn: () => api<PrintingPartnerDebtSummary>(`${partnerPath(partner)}/debt-summary`).then(r => r.data) })
  const ledger = useQuery({ queryKey: [partner, 'printing-ledger'], queryFn: () => api<PrintingPartnerLedgerRow[]>(`${partnerPath(partner)}/ledger`).then(r => r.data) })
  const [settleMonth, setSettleMonth] = useState<string | null>(null)
  const [payMonth, setPayMonth] = useState<string | null>(null)
  const [payModal, setPayModal] = useState<PrintingPartnerDebtMonth | null>(null)
  const [advanceModal, setAdvanceModal] = useState<PrintingPartnerDebtMonth | 'NEW' | null>(null)

  const groups: Array<['ADVANCE' | 'PENDING' | 'SETTLED', string]> = [
    ['ADVANCE', 'ỨNG TIỀN TRƯỚC'], ['PENDING', 'CẦN XỬ LÝ'], ['SETTLED', 'ĐÃ THANH TOÁN XONG'],
  ]

  async function invalidate() {
    await qc.invalidateQueries({ queryKey: [partner, 'printing-debt-summary'] })
    await qc.invalidateQueries({ queryKey: [partner, 'printing-ledger'] })
    await qc.invalidateQueries({ queryKey: [partner, 'printing-month-payments'] })
  }

  return <div className="card production-form">
    <h2 className="section-title"><i className="bi bi-cash-stack"/>Công nợ còn lại · {label}</h2>
    <div className="money-grid">
      <span>Công nợ còn lại<b className="debt">{formatMoney(summary.data?.total_remaining ?? 0)}</b></span>
      <span>Dư ứng<b>{formatMoney(summary.data?.unallocated_advance ?? 0)}</b></span>
    </div>
    <p className="muted">Tổng chốt - Tổng ứng/thanh toán.</p>

    <div className="action-row">
      <div><b>ỨNG TIỀN TRƯỚC</b><small className="muted">Dùng khi tháng đó chưa chốt nhưng cần ứng trước cho {label}.</small></div>
      <button className="btn-outline" onClick={() => setAdvanceModal('NEW')}>Ứng</button>
    </div>

    {summary.data?.months.length ? <div className="zipper-debt-groups">
      {groups.map(([group, label]) => {
        const months = summary.data!.months.filter(m => m.group === group)
        if (!months.length) return null
        return <div key={group} className="zipper-debt-group"><h3>{label}</h3>
          {months.map(m => <div className="zipper-debt-month" key={m.month}>
            <header><b>{monthLabel(m.month)}</b><small>{m.receipt_count} lần chốt · {m.transaction_count} lần thanh toán</small></header>
            <div className="zipper-debt-grid">
              <span>CHỐT<b>{formatMoney(m.buy)}</b></span>
              <span>ĐÃ ỨNG/TRẢ<b>{formatMoney(m.advance + m.paid)}</b><small>Ứng: {formatMoney(m.advance)} · Trả: {formatMoney(m.paid)}</small></span>
              <span>CÒN LẠI<b className={m.remaining > 0 ? 'debt' : ''}>{formatMoney(m.remaining)}</b></span>
            </div>
            <div className="action-row">
              <button className="btn-outline" onClick={() => setSettleMonth(settleMonth === m.month ? null : m.month)}>Chi tiết chốt tháng</button>
              <button className="btn-outline" onClick={() => setPayMonth(payMonth === m.month ? null : m.month)}>Xem chi tiết thanh toán</button>
              <button className="btn-outline" onClick={() => setPayModal(m)}>Thanh toán</button>
              <button className="btn-outline" onClick={() => setAdvanceModal(m)}>Ứng thêm</button>
            </div>
            {settleMonth === m.month && <SettleDetail partner={partner} month={m.month}/>}
            {payMonth === m.month && <PaymentDetail partner={partner} month={m.month}/>}
          </div>)}
        </div>
      })}
    </div> : <div className="empty">Không có tháng nào cần xử lý.</div>}

    <h3 className="section-title">Lịch sử giao dịch · {label}</h3>
    {ledger.data?.length ? <div className="zipper-ledger">{ledger.data.map(row => <div className="zipper-ledger-row" key={row.id}><span><b>{row.description || row.entry_type}</b><small>{formatDate(row.occurred_at)} · {row.month ? monthLabel(row.month) : '—'} · {row.entry_type.replace(`${partner.toUpperCase()}_IN_`, '')} · {row.transaction_no || '—'} · {row.actor_name || '—'}</small></span><em>{row.debit ? `+${formatMoney(row.debit)}` : `-${formatMoney(row.credit)}`}</em><strong>{formatMoney(row.balance)}</strong></div>)}</div> : <div className="empty">Chưa có giao dịch {label}.</div>}

    {payModal && <MoneyModal partner={partner} title={`Thanh toán ${label}`} month={payModal} onSaved={invalidate} onClose={() => setPayModal(null)}/>}
    {advanceModal && <MoneyModal key={`${partner}-advance-${advanceModal === 'NEW' ? 'new' : advanceModal.month}`} partner={partner} title={`Ứng tiền ${label}`} month={advanceModal === 'NEW' ? null : advanceModal} advance onSaved={invalidate} onClose={() => setAdvanceModal(null)}/>}
  </div>
}

function SettleDetail({ partner, month }: { partner: PrintingPartnerKey; month: string }) {
  const settlements = useQuery({ queryKey: [partner, 'printing-month-settlements', month], queryFn: () => api<PrintingPartnerSettlement[]>(`${partnerPath(partner)}/monthly/${month}/settlements`).then(r => r.data) })
  if (settlements.isLoading) return <div className="loading">Đang tải…</div>
  if (!settlements.data?.length) return <div className="empty">Tháng này chưa có mẻ chốt nào.</div>
  const total = settlements.data.reduce((sum, r) => sum + r.total_amount, 0)
  return <div className="card-inner"><b>Chi tiết chốt tháng · {monthLabel(month)}</b>
    <div className="zipper-detail-table"><div className="zipper-detail-head"><span>Ngày chốt</span><span>Số tiền</span><span>Ghi chú</span><span>File</span><span>Người nhập</span></div>
      {settlements.data.map(row => <div className="zipper-detail-row" key={row.id}><span>{row.created_at ? formatDate(row.created_at) : row.settlement_no}</span><strong>{formatMoney(row.total_amount)}</strong><span>{row.notes || '—'}</span><span>{row.media ? <AuthenticatedFileLink url={row.media.url} label={row.media.original_name || 'Xem file'}/> : '—'}</span><span>{row.created_by_name || '—'}</span></div>)}
    </div>
    <div className="zipper-total">Tổng chốt tháng: <strong>{formatMoney(total)}</strong></div>
  </div>
}

function AuthenticatedFileLink({ url, label }: { url: string; label: string }) {
  const [error, setError] = useState('')
  return <span>
    <a href={url} onClick={event => {
      event.preventDefault()
      setError('')
      void openAuthenticatedMedia(url).catch(() => setError('Không thể mở file.'))
    }}>{label}</a>
    {error && <small className="error-text">{error}</small>}
  </span>
}

function PaymentDetail({ partner, month }: { partner: PrintingPartnerKey; month: string }) {
  const payments = useQuery({ queryKey: [partner, 'printing-month-payments', month], queryFn: () => api<PrintingPartnerMonthPayment[]>(`${partnerPath(partner)}/monthly/${month}/payments`).then(r => r.data) })
  if (payments.isLoading) return <div className="loading">Đang tải…</div>
  if (!payments.data?.length) return <div className="empty">Chưa có thanh toán/ứng trong tháng.</div>
  const total = payments.data.reduce((sum, r) => sum + r.amount, 0)
  return <div className="card-inner"><b>Chi tiết thanh toán · {monthLabel(month)}</b>
    <div className="zipper-detail-table"><div className="zipper-detail-head"><span>Ngày / mã</span><span>Loại</span><span>Số tiền</span><span>Lý do</span><span>Người nhập</span></div>
      {payments.data.map(row => <div className="zipper-detail-row" key={row.id}><span>{formatDate(row.occurred_date)}<small>{row.transaction_no || ''}</small></span><span>{row.transaction_type === 'ADVANCE' ? 'Ứng' : 'Thanh toán'}</span><strong>{formatMoney(row.amount)}</strong><span>{row.note || '—'}</span><span>{row.created_by_name || '—'}</span></div>)}
    </div>
    <div className="zipper-total">Tổng ứng/trả: <strong>{formatMoney(total)}</strong></div>
  </div>
}

function MoneyModal({ partner, title, month, advance, onSaved, onClose }: { partner: PrintingPartnerKey; title: string; month: PrintingPartnerDebtMonth | null; advance?: boolean; onSaved: () => void; onClose: () => void }) {
  const [selectedMonth, setSelectedMonth] = useState(month?.month ?? currentMonth())
  const [date, setDate] = useState(todayIso()); const [amount, setAmount] = useState(''); const [note, setNote] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function save(event: FormEvent) {
    event.preventDefault(); setError('')
    const value = Number(amount)
    if (!Number.isSafeInteger(value) || value <= 0) { setError('Số tiền phải là số nguyên lớn hơn 0.'); return }
    if (!selectedMonth) { setError('Vui lòng chọn tháng.'); return }
    setBusy(true)
    try {
      const path = advance ? `${partnerPath(partner)}/advances` : `${partnerPath(partner)}/payments`
      await api(path, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { month: selectedMonth, amount: value, date, note: note.trim() || null } })
      await onSaved(); onClose()
    } catch (caught) { setError(message(caught)) } finally { setBusy(false) }
  }
  return <div className="modal-layer"><form className="modal-card" onSubmit={save}>
    <h2>{title}</h2>
    {month && <p className="muted">{monthLabel(month.month)} · Còn lại: {formatMoney(month.remaining)}</p>}
    {advance && <p className="muted">Dùng cho tháng chưa chốt hoặc ứng thêm trong tháng.</p>}
    {advance && <label>Tháng ứng<input required className="form-control" type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}/></label>}
    <label>Ngày {advance ? 'ứng' : 'thanh toán'}<input required className="form-control" type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
    <label>Số tiền<input required className="form-control" type="number" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)}/></label>
    <label>{advance ? 'Lý do' : 'Ghi chú'}<input className="form-control" placeholder={advance ? `Ứng thêm ${PARTNER_LABEL[partner]}…` : `Thanh toán ${PARTNER_LABEL[partner]}…`} value={note} onChange={e => setNote(e.target.value)}/></label>
    {error && <div className="error-text">{error}</div>}
    <div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={busy}>Hủy</button><button className="btn-main" disabled={busy}>{busy ? 'ĐANG LƯU…' : advance ? 'XÁC NHẬN ỨNG' : 'XÁC NHẬN THANH TOÁN'}</button></div>
  </form></div>
}
