import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type FabricDebtSummary, type FabricPayment, type FabricReceipt, type FabricStatement, type Partner } from '../api/client'
import { formatDate, formatMoney, todayIso } from '../lib/format'

type FabricLine = {
  key: string
  entryType: 'PURCHASE' | 'RETURN'
  date: string
  name: string
  rollCount: string
  quantity: string
  unit: 'KG' | 'METER'
  deductionEnabled: boolean
  unitPrice: string
  transport: string
}

type FabricPaymentDraft = {
  key: string
  payment_date: string
  amount: number
  method: 'CASH' | 'BANK_TRANSFER' | 'OTHER'
  note: string
}

function newLine(entryType: FabricLine['entryType'] = 'PURCHASE'): FabricLine {
  return {
    key: crypto.randomUUID(),
    entryType,
    date: todayIso(),
    name: '',
    rollCount: '',
    quantity: '',
    unit: 'KG',
    deductionEnabled: true,
    unitPrice: '',
    transport: '',
  }
}

function message(error: unknown) {
  return error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.'
}

function calculate(line: FabricLine) {
  const rolls = Number(line.rollCount) || 0
  const quantity = Number(line.quantity) || 0
  const price = Number(line.unitPrice) || 0
  const wastage = line.entryType === 'PURCHASE' && line.unit === 'KG' && line.deductionEnabled
    ? rolls * 0.3
    : 0
  const net = Math.max(quantity - wastage, 0)
  const fabricAmount = Math.round(net * price) * (line.entryType === 'RETURN' ? -1 : 1)
  const transport = line.entryType === 'PURCHASE' ? Number(line.transport) || 0 : 0
  return { wastage, net, amount: fabricAmount + transport }
}

export function FabricPage({ onBack }: { onBack?: () => void }) {
  const [lines, setLines] = useState<FabricLine[]>([newLine()])
  const [supplierId, setSupplierId] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [supplierName, setSupplierName] = useState('')
  const [supplierPhone, setSupplierPhone] = useState('')
  const [activeTab, setActiveTab] = useState<'INTAKE' | 'DEBT'>('INTAKE')
  const [supplierError, setSupplierError] = useState('')
  const [supplierBusy, setSupplierBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const suppliers = useQuery({
    queryKey: ['fabric-suppliers'],
    queryFn: () => api<Partner[]>('/materials/fabric/suppliers').then(response => response.data),
  })
  const qc = useQueryClient()
  const supplier = suppliers.data?.find(row => row.id === supplierId)
  const total = useMemo(() => lines.reduce((sum, line) => sum + calculate(line).amount, 0), [lines])

  function patchLine(key: string, patch: Partial<FabricLine>) {
    setLines(rows => rows.map(line => line.key === key ? { ...line, ...patch } : line))
  }

  async function addSupplier(event: FormEvent) {
    event.preventDefault()
    setSupplierError('')
    setSupplierBusy(true)
    try {
      const response = await api<Partner>('/materials/fabric/suppliers', {
        method: 'POST',
        body: { name: supplierName, phone: supplierPhone.trim() || null },
      })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['fabric-suppliers'] }),
        qc.invalidateQueries({ queryKey: ['fabric-debt-summary'] }),
      ])
      setSupplierId(response.data.id)
      setSupplierName('')
      setSupplierPhone('')
      setSupplierOpen(false)
    } catch (caught) {
      setSupplierError(message(caught))
    } finally {
      setSupplierBusy(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!supplierId) {
      setError('Vui lòng chọn nhà vải.')
      return
    }
    for (const line of lines) {
      if (!line.date || !line.name.trim() || Number(line.quantity) <= 0 ||
          Number(line.rollCount) < 0 || !Number.isFinite(Number(line.unitPrice)) ||
          Number(line.unitPrice) < 0 || (line.entryType === 'PURCHASE' && Number(line.quantity) < calculate(line).wastage)) {
        setError('Vui lòng kiểm tra ngày, tên vải, số lượng, số cây và đơn giá trên từng dòng.')
        return
      }
      if (line.entryType === 'PURCHASE' && !Number.isSafeInteger(Number(line.transport) || 0)) {
        setError('Tiền xe phải là số tiền VND nguyên.')
        return
      }
    }

    setBusy(true)
    try {
      const response = await api<FabricReceipt>('/materials/fabric/receipts', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          supplier_id: supplierId,
          lines: lines.map(line => ({
            entry_type: line.entryType,
            receipt_date: line.date,
            fabric_name: line.name.trim(),
            unit: line.unit,
            roll_count: Number(line.rollCount) || 0,
            gross_quantity: Number(line.quantity),
            deduction_enabled: line.deductionEnabled,
            unit_price_amount: Number(line.unitPrice),
            transport_amount: line.entryType === 'PURCHASE' ? Number(line.transport) || 0 : 0,
          })),
        },
      })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['fabric-debt-summary'] }),
        qc.invalidateQueries({ queryKey: ['fabric-statement', supplierId] }),
      ])
      setSuccess(`Đã lưu phiếu ${response.data.receipt_no} · ${formatMoney(response.data.total_amount)}`)
      setLines([newLine()])
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  return <section className="page materials-page fabric-page">
    <header className="blue-header teal fabric-header">
      {onBack ? <button className="btn-back" onClick={onBack}>← Quay lại Phụ liệu</button> : <span/>}
      <span className="title">QUẢN LÝ VẢI</span>
      <button className="header-icon" aria-label="Thêm nhà vải" onClick={() => setSupplierOpen(true)}>+</button>
    </header>

    <nav className="fabric-tabs" role="tablist" aria-label="Quản lý vải">
      <button type="button" role="tab" aria-selected={activeTab === 'INTAKE'} className={activeTab === 'INTAKE' ? 'is-active' : ''} onClick={() => setActiveTab('INTAKE')}>Nhập Vải</button>
      <button type="button" role="tab" aria-selected={activeTab === 'DEBT'} className={activeTab === 'DEBT' ? 'is-active' : ''} onClick={() => setActiveTab('DEBT')}>Công Nợ &amp; Thanh Toán</button>
    </nav>

    {activeTab === 'INTAKE' && <form className="card production-form fabric-form" onSubmit={save}>
      <label>Nhà vải *<span className="fabric-supplier-select">
        <select required className="form-control" value={supplierId} onChange={event => setSupplierId(event.target.value)}>
          <option value="">-- Chọn Nhà Vải --</option>
          {suppliers.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <button type="button" className="btn-plus" aria-label="Thêm nhà vải" onClick={() => setSupplierOpen(true)}>+</button>
      </span></label>
      {suppliers.isLoading && <div className="loading">Đang tải danh sách nhà vải…</div>}
      {suppliers.error && <div className="error-text">{message(suppliers.error)} <button type="button" className="btn-outline" onClick={() => void suppliers.refetch()}>Thử lại</button></div>}

      <div className="fabric-entry-list">
        {lines.map((line, index) => {
          const calculated = calculate(line)
          const isReturn = line.entryType === 'RETURN'
          return <article className={`fabric-entry-card${isReturn ? ' is-return' : ''}`} key={line.key}>
            <div className="fabric-entry-title">
              <h2>{isReturn ? 'Trả Lại Vải' : 'Nhập Vải'} <small>#{index + 1}</small></h2>
              <div className="fabric-entry-actions">
                <label className="fabric-toggle"><input type="checkbox" checked={line.unit === 'METER'} onChange={event => patchLine(line.key, { unit: event.target.checked ? 'METER' : 'KG' })}/> Mét</label>
                <button type="button" className="line-remove" aria-label="Xóa dòng" disabled={lines.length === 1} onClick={() => setLines(rows => rows.filter(row => row.key !== line.key))}>×</button>
              </div>
            </div>
            <div className="fabric-fields">
              <label>Ngày {isReturn ? 'trả' : 'nhập'} *<input required className="form-control" type="date" value={line.date} onChange={event => patchLine(line.key, { date: event.target.value })}/></label>
              <label className="fabric-name">Tên vải *<input required className="form-control" placeholder={isReturn ? 'Tên vải trả' : 'VD: Thun lạnh, Cá sấu…'} value={line.name} onChange={event => patchLine(line.key, { name: event.target.value })}/></label>
              <label>Số cây{isReturn ? ' trả' : ''}<input className="form-control" type="number" min="0" step="0.001" value={line.rollCount} onChange={event => patchLine(line.key, { rollCount: event.target.value })}/></label>
              <label>{isReturn ? 'Số lượng trả' : line.unit === 'KG' ? 'Số Kg' : 'Số Mét'} *<input required className="form-control" type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => patchLine(line.key, { quantity: event.target.value })}/></label>
              {!isReturn && line.unit === 'KG' && <label className="fabric-deduction">Khấu hao (x0.3)<span><input type="checkbox" checked={line.deductionEnabled} onChange={event => patchLine(line.key, { deductionEnabled: event.target.checked })}/> Áp dụng</span></label>}
              <label>{isReturn ? 'Thực trả' : 'Còn lại'} ({line.unit === 'KG' ? 'Kg' : 'Mét'})<output className="form-control">{calculated.net.toFixed(1)}</output></label>
              <label>Đơn giá (đ) *<input required className="form-control" type="number" min="0" step="1" value={line.unitPrice} onChange={event => patchLine(line.key, { unitPrice: event.target.value })}/></label>
              {!isReturn && <label>Tiền xe (đ)<input className="form-control" type="number" step="1" placeholder="Có thể nhập số âm" value={line.transport} onChange={event => patchLine(line.key, { transport: event.target.value })}/></label>}
              <div className="fabric-line-total"><span>Thành tiền</span><strong>{formatMoney(calculated.amount)}</strong></div>
            </div>
          </article>
        })}
      </div>

      <div className="fabric-add-actions">
        <button type="button" className="btn-outline" onClick={() => setLines(rows => [...rows, newLine('PURCHASE')])}>+ THÊM LẦN NHẬP</button>
        <button type="button" className="btn-outline" onClick={() => setLines(rows => [...rows, newLine('RETURN')])}>+ THÊM HÀNG TRẢ</button>
      </div>

      <div className="fabric-total">TỔNG TIỀN PHIẾU: <strong>{formatMoney(total)}</strong></div>
      {success && <div className="success-text">{success}</div>}
      {error && <div className="error-text">{error}</div>}
      <div className="fabric-form-actions">
        <button type="button" className="btn-outline" disabled={!supplierId} onClick={() => setPreviewOpen(true)}>XEM HÓA ĐƠN</button>
        <button className="btn-main" disabled={busy || suppliers.isLoading || !!suppliers.error}>{busy ? 'ĐANG LƯU…' : 'LƯU NHẬP VẢI'}</button>
      </div>
    </form>}

    <FabricDebtTab
      hidden={activeTab !== 'DEBT'}
      supplierId={supplierId}
      onSupplierChange={setSupplierId}
      suppliers={suppliers.data || []}
    />

    {supplierOpen && <div className="fabric-modal-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) setSupplierOpen(false) }}>
      <form className="card fabric-modal" onSubmit={addSupplier}>
        <h2 className="section-title">Thêm nhà vải</h2>
        <label>Tên nhà vải *<input required autoFocus className="form-control" maxLength={250} value={supplierName} onChange={event => setSupplierName(event.target.value)}/></label>
        <label>Số điện thoại<input className="form-control" maxLength={30} value={supplierPhone} onChange={event => setSupplierPhone(event.target.value)}/></label>
        {supplierError && <div className="error-text">{supplierError}</div>}
        <div className="fabric-form-actions"><button type="button" className="btn-outline" onClick={() => setSupplierOpen(false)} disabled={supplierBusy}>Hủy</button><button className="btn-main" disabled={supplierBusy}>{supplierBusy ? 'ĐANG LƯU…' : 'LƯU NHÀ VẢI'}</button></div>
      </form>
    </div>}

    {previewOpen && <div className="fabric-modal-backdrop fabric-print-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) setPreviewOpen(false) }}>
      <div className="card fabric-invoice">
        <h2>HÓA ĐƠN GIAO NHẬN VẢI</h2>
        <p>Nhà cung cấp: <strong>{supplier?.name || '—'}</strong></p>
        <div className="fabric-invoice-table-wrap"><table className="fabric-invoice-table">
          <thead><tr><th>Ngày</th><th>Tên vải</th><th>Loại</th><th>Cây</th><th>Kg/M</th><th>Khấu hao</th><th>Còn lại</th><th>Đơn giá</th><th>Tiền xe</th><th>Thành tiền</th></tr></thead>
          <tbody>{lines.map(line => {
            const calculated = calculate(line)
            return <tr key={line.key}>
              <td>{formatDate(line.date)}</td><td>{line.name || '—'}</td><td>{line.entryType === 'RETURN' ? 'Trả' : 'Nhập'} ({line.unit === 'KG' ? 'Kg' : 'Mét'})</td>
              <td>{line.rollCount || 0}</td><td>{line.quantity || 0}</td><td>{calculated.wastage.toFixed(1)}</td><td>{calculated.net.toFixed(1)}</td>
              <td>{formatMoney(Number(line.unitPrice) || 0)}</td><td>{line.entryType === 'PURCHASE' ? formatMoney(Number(line.transport) || 0) : '—'}</td><td>{formatMoney(calculated.amount)}</td>
            </tr>
          })}</tbody>
          <tfoot><tr><th colSpan={9}>TỔNG TIỀN PHIẾU</th><th>{formatMoney(total)}</th></tr></tfoot>
        </table></div>
        <div className="fabric-form-actions no-print"><button className="btn-outline" onClick={() => setPreviewOpen(false)}>Đóng</button><button className="btn-main" onClick={() => window.print()}>In hóa đơn</button></div>
      </div>
    </div>}
  </section>
}

function FabricDebtTab({
  hidden,
  supplierId,
  onSupplierChange,
  suppliers,
}: {
  hidden: boolean
  supplierId: string
  onSupplierChange: (supplierId: string) => void
  suppliers: Partner[]
}) {
  const qc = useQueryClient()
  const [paymentDate, setPaymentDate] = useState(todayIso())
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<FabricPaymentDraft['method']>('CASH')
  const [paymentNote, setPaymentNote] = useState('')
  const [draftPayments, setDraftPayments] = useState<FabricPaymentDraft[]>([])
  const [draftSupplierId, setDraftSupplierId] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const summary = useQuery({
    queryKey: ['fabric-debt-summary'],
    queryFn: () => api<FabricDebtSummary>('/materials/fabric/debt-summary').then(response => response.data),
  })
  const statement = useQuery({
    queryKey: ['fabric-statement', supplierId],
    queryFn: () => api<FabricStatement>(`/materials/fabric/suppliers/${supplierId}/statement`).then(response => response.data),
    enabled: !!supplierId,
  })

  function addPayment(event: FormEvent) {
    event.preventDefault()
    setError('')
    const amount = Number(paymentAmount)
    if (!supplierId) {
      setError('Vui lòng chọn nhà vải.')
      return
    }
    if (draftPayments.length && draftSupplierId !== supplierId) {
      setError('Phiếu đang có thanh toán của nhà vải khác. Hãy chọn lại nhà vải đó hoặc xóa các dòng tạm.')
      return
    }
    if (!paymentDate || !Number.isSafeInteger(amount) || amount <= 0) {
      setError('Ngày thanh toán và số tiền VND nguyên lớn hơn 0 là bắt buộc.')
      return
    }
    if (!draftPayments.length) setDraftSupplierId(supplierId)
    setDraftPayments(rows => [...rows, {
      key: crypto.randomUUID(),
      payment_date: paymentDate,
      amount,
      method: paymentMethod,
      note: paymentNote.trim(),
    }])
    setPaymentAmount('')
    setPaymentNote('')
  }

  async function confirmPayments() {
    if (!supplierId || !draftPayments.length) return
    if (draftSupplierId !== supplierId) {
      setError('Nhà vải đã thay đổi. Hãy chọn lại nhà vải của phiếu thanh toán hoặc xóa các dòng tạm.')
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const response = await api<FabricPayment[]>('/materials/fabric/payments', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          supplier_id: supplierId,
          payments: draftPayments.map(({ payment_date, amount, method, note }) => ({
            payment_date,
            amount,
            method,
            note: note || null,
          })),
        },
      })
      setSuccess(`Đã lưu ${response.data.length} lần thanh toán · ${formatMoney(response.data.reduce((sum, row) => sum + row.amount, 0))}`)
      setDraftPayments([])
      setDraftSupplierId('')
      setPreviewOpen(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['fabric-debt-summary'] }),
        qc.invalidateQueries({ queryKey: ['fabric-statement', supplierId] }),
      ])
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  const methodLabel = (method: string) => method === 'CASH' ? 'Tiền mặt' : method === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Khác'
  const draftTotal = draftPayments.reduce((sum, row) => sum + row.amount, 0)

  return <section className="fabric-debt" hidden={hidden}>
    <div className="fabric-debt-summary">
      <article className="card fabric-debt-kpi">
        <span>Tổng công nợ phải trả</span>
        <strong>{summary.data ? formatMoney(summary.data.total_debt) : '—'}</strong>
        <small>{summary.data?.supplier_count ?? '—'} nhà vải đang hoạt động</small>
      </article>
      <article className="card fabric-debt-kpi">
        <span>Số dư ròng nhà vải</span>
        <strong>{summary.data ? formatMoney(summary.data.net_balance) : '—'}</strong>
        <small>Tổng số dư gồm cả khoản trả trước</small>
      </article>
    </div>
    {summary.error && <div className="error-text">{message(summary.error)} <button type="button" className="btn-outline" onClick={() => void summary.refetch()}>Thử lại</button></div>}

    <div className="card fabric-debt-card">
      <label>Nhà vải
        <select className="form-control" value={supplierId} onChange={event => onSupplierChange(event.target.value)}>
          <option value="">-- Chọn Nhà Vải --</option>
          {suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </label>
      {statement.isLoading && <div className="loading">Đang tải công nợ…</div>}
      {statement.error && <div className="error-text">{message(statement.error)} <button type="button" className="btn-outline" onClick={() => void statement.refetch()}>Thử lại</button></div>}
      {statement.data && <>
        <div className="fabric-ledger-totals">
          <div><span>Nợ đầu kỳ</span><strong>{formatMoney(statement.data.opening)}</strong></div>
          <div><span>Phát sinh nợ</span><strong>{formatMoney(statement.data.debit)}</strong></div>
          <div><span>Đã thanh toán/giảm trừ</span><strong>{formatMoney(statement.data.credit)}</strong></div>
          <div><span>Còn phải trả</span><strong>{formatMoney(statement.data.closing)}</strong></div>
        </div>
      </>}
    </div>

    <div className="card fabric-debt-card">
      <h2 className="section-title">Ghi nhận thanh toán</h2>
      {draftPayments.length > 0 && draftSupplierId !== supplierId && <div className="error-text">Các dòng thanh toán tạm thuộc nhà vải khác. Hãy chọn lại đúng nhà vải hoặc xóa các dòng tạm trước khi xác nhận.</div>}
      <form className="fabric-payment-form" onSubmit={addPayment}>
        <label>Ngày thanh toán *<input required className="form-control" type="date" value={paymentDate} onChange={event => setPaymentDate(event.target.value)}/></label>
        <label>Số tiền (đ) *<input required className="form-control" type="number" min="1" step="1" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)}/></label>
        <label>Hình thức<select className="form-control" value={paymentMethod} onChange={event => {
          const value = event.target.value
          if (value === 'CASH' || value === 'BANK_TRANSFER' || value === 'OTHER') setPaymentMethod(value)
        }}>
          <option value="CASH">Tiền mặt</option><option value="BANK_TRANSFER">Chuyển khoản</option><option value="OTHER">Khác</option>
        </select></label>
        <label>Ghi chú<input className="form-control" maxLength={500} value={paymentNote} onChange={event => setPaymentNote(event.target.value)}/></label>
        <button className="btn-outline" disabled={!supplierId}>+ THÊM VÀO PHIẾU</button>
      </form>
      {draftPayments.length > 0 && <div className="fabric-draft-payments">
        {draftPayments.map((row, index) => <div key={row.key}>
          <span>#{index + 1} · {formatDate(row.payment_date)} · {methodLabel(row.method)}{row.note ? ` · ${row.note}` : ''}</span>
          <strong>{formatMoney(row.amount)}</strong>
          <button type="button" className="line-remove" aria-label="Xóa thanh toán" onClick={() => {
            const remaining = draftPayments.filter(item => item.key !== row.key)
            setDraftPayments(remaining)
            if (!remaining.length) setDraftSupplierId('')
          }}>×</button>
        </div>)}
        <div className="fabric-total">TỔNG THANH TOÁN: <strong>{formatMoney(draftTotal)}</strong></div>
        <div className="fabric-form-actions"><button type="button" className="btn-main" disabled={draftSupplierId !== supplierId} onClick={() => setPreviewOpen(true)}>XEM PHIẾU / CHỐT THANH TOÁN</button></div>
      </div>}
      {success && <div className="success-text">{success}</div>}
      {error && <div className="error-text">{error}</div>}
    </div>

    {statement.data && <>
      <div className="card fabric-debt-card">
        <h2 className="section-title">Lịch sử nhập và trả vải</h2>
        {statement.data.receipts.length === 0 ? <p className="fabric-empty">Chưa có phiếu nhập/trả vải.</p> : <div className="fabric-history-list">
          {statement.data.receipts.map(receipt => <article key={receipt.id}>
            <header><strong>{receipt.receipt_no}</strong><span>{formatDate(receipt.created_at)} · {receipt.created_by_name || '—'}</span><b>{formatMoney(receipt.total_amount)}</b></header>
            <div className="fabric-history-lines">{receipt.lines.map(line => <div key={line.id}>
              <span>{formatDate(line.receipt_date)} · {line.entry_type === 'RETURN' ? 'Trả' : 'Nhập'} · {line.fabric_name}</span>
              <span>{line.net_quantity} {line.unit === 'KG' ? 'Kg' : 'Mét'} × {formatMoney(line.unit_price_amount)}</span>
              <strong>{formatMoney(line.amount)}</strong>
            </div>)}</div>
          </article>)}
        </div>}
      </div>

      <div className="card fabric-debt-card">
        <h2 className="section-title">Lịch sử công nợ và giao dịch</h2>
        {statement.data.entries.length === 0 ? <p className="fabric-empty">Chưa có giao dịch công nợ.</p> : <div className="fabric-ledger-wrap">
          <table className="fabric-ledger-table">
            <thead><tr><th>Ngày</th><th>Mã giao dịch</th><th>Nội dung</th><th>Nợ</th><th>Thanh toán/Giảm</th><th>Số dư</th><th>Người ghi</th></tr></thead>
            <tbody>{[...statement.data.entries].reverse().map(row => <tr key={row.id}>
              <td>{formatDate(row.occurred_at)}</td><td>{row.transaction_no || '—'}</td><td>{row.description || row.entry_type}</td>
              <td>{row.debit ? formatMoney(row.debit) : '—'}</td><td>{row.credit ? formatMoney(row.credit) : '—'}</td>
              <td>{formatMoney(row.balance)}</td><td>{row.actor_name || '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </div>
    </>}

    {previewOpen && <div className="fabric-modal-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget && !busy) setPreviewOpen(false) }}>
      <div className="card fabric-modal fabric-payment-preview">
        <h2 className="section-title">Xác nhận thanh toán nhà vải</h2>
        <p>Nhà vải: <strong>{statement.data?.supplier.name || suppliers.find(row => row.id === supplierId)?.name || '—'}</strong></p>
        <div className="fabric-ledger-wrap"><table className="fabric-ledger-table">
          <thead><tr><th>Ngày</th><th>Hình thức</th><th>Ghi chú</th><th>Số tiền</th></tr></thead>
          <tbody>{draftPayments.map(row => <tr key={row.key}><td>{formatDate(row.payment_date)}</td><td>{methodLabel(row.method)}</td><td>{row.note || '—'}</td><td>{formatMoney(row.amount)}</td></tr>)}</tbody>
          <tfoot><tr><th colSpan={3}>TỔNG THANH TOÁN</th><th>{formatMoney(draftTotal)}</th></tr></tfoot>
        </table></div>
        <div className="fabric-form-actions">
          <button type="button" className="btn-outline" onClick={() => setPreviewOpen(false)} disabled={busy}>Quay lại</button>
          <button type="button" className="btn-main" onClick={() => void confirmPayments()} disabled={busy}>{busy ? 'ĐANG LƯU…' : 'XÁC NHẬN / LƯU THANH TOÁN'}</button>
        </div>
      </div>
    </div>}
  </section>
}
