import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import html2canvas from 'html2canvas'
import { api, ApiError, type CuttingPaymentRow, type CuttingReportRow, type MaterialHistory, type ProductionBatch, type ProductionMaster, type ProductionReceipt, type WorkshopDebtStatement, type WorkshopSettlement } from '../api/client'
import { useAuth } from '../api/auth'
import { formatDateShort, formatMoney, todayIso } from '../lib/format'
import { beginDialogSave, finishDialogSave, type SaveDialogState } from './productionUi'
import { CreateBatch } from './CreateBatch'

type Tab = 'create' | 'progress' | 'customer' | 'workshops' | 'cutting' | 'patterns'
type MaterialLine = { name: string; totalRequired: string; quantity: string; deliverFull: boolean }

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.'
}

export function ProductionPage() {
  const [tab, setTab] = useState<Tab>('create')
  const [createMode, setCreateMode] = useState<'HOUSE' | 'CUSTOMER_ORDER'>('HOUSE')
  const [createKey, setCreateKey] = useState(0)
  const master = useQuery({ queryKey: ['production-master'], queryFn: () => api<ProductionMaster>('/production/master-data').then(r => r.data) })
  function openCreate(mode: 'HOUSE' | 'CUSTOMER_ORDER') { setCreateMode(mode); setCreateKey(k => k + 1); setTab('create') }
  return <section className="page production-page">
    <h1>Quản lý Rập</h1>
    <p className="muted">Trung tâm quản lý rập — tạo phiếu rập, theo dõi tiến độ và đối soát gia công trong một nơi.</p>
    <div className="tabs">
      <button className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>Thêm rập mới</button>
      <button className={tab === 'progress' ? 'active' : ''} onClick={() => setTab('progress')}>Tiến độ đơn</button>
      <button className={tab === 'customer' ? 'active' : ''} onClick={() => setTab('customer')}>Khách đặt</button>
      <button className={tab === 'workshops' ? 'active' : ''} onClick={() => setTab('workshops')}>Nhà may</button>
      <button className={tab === 'cutting' ? 'active' : ''} onClick={() => setTab('cutting')}>Thợ cắt</button>
      <button className={tab === 'patterns' ? 'active' : ''} onClick={() => setTab('patterns')}>Mã rập / Ảnh</button>
    </div>
    {master.isLoading ? <div className="loading">Đang tải dữ liệu QL Rập…</div> : master.error ? <div className="empty">{errorMessage(master.error)}</div> : <>
      {tab === 'create' && <CreateBatch key={createKey} master={master.data!} initialMode={createMode} onCreated={() => setTab('progress')}/>} 
      {tab === 'progress' && <Progress master={master.data!}/>} 
      {tab === 'customer' && <CustomerOrders onNew={() => openCreate('CUSTOMER_ORDER')}/>} 
      {tab === 'workshops' && <Workshops master={master.data!}/>} 
      {tab === 'cutting' && <Cutting/>} 
      {tab === 'patterns' && <PatternGallery/>} 
    </>}
  </section>
}

type ProgressSummary = { workshop_id: string; workshop_name: string; total: number; house: number; customer: number }
type PaymentFilter = 'all' | 'unpaid' | 'paid'

const PRODUCTION_STATUS_LABEL: Record<string, string> = {
  CUTTING_INCOMPLETE: 'Đang cắt / chưa đủ',
  COMPLETED: 'Đã xong',
  FORCE_CLOSED: 'Ép chốt',
}
const RECEIPT_STATUS_LABEL: Record<string, string> = {
  NOT_RECEIVED: 'Chưa nhận',
  RECEIVED_PARTIAL: 'Nhận một phần',
  RECEIVED_FULL: 'Đã nhận đủ',
}
const SETTLEMENT_STATUS_LABEL: Record<string, string> = {
  UNPAID: 'Chưa TT',
  SETTLED_UNPAID: 'Chưa TT',
  SETTLED_PAID: 'Đã TT',
  PAID: 'Đã TT',
}

function statusLabel(map: Record<string, string>, value: string | null | undefined): string {
  return (value && map[value]) || value || '—'
}

function Progress({ master }: { master: ProductionMaster }) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [workshopId, setWorkshopId] = useState('')
  const [payment, setPayment] = useState<PaymentFilter>('all')
  const [selected, setSelected] = useState<ProductionBatch | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(timer)
  }, [q])

  const summary = useQuery({ queryKey: ['production-batches-summary'], queryFn: () => api<ProgressSummary[]>('/production/batches/summary').then(r => r.data) })
  const batches = useQuery({
    queryKey: ['production-batches', debouncedQ, workshopId, payment],
    queryFn: () => api<ProductionBatch[]>('/production/batches', { query: { q: debouncedQ || undefined, workshop_id: workshopId || undefined, payment_status: payment } }).then(r => r.data),
  })
  async function reload() { await qc.invalidateQueries({ queryKey: ['production-batches'] }); await qc.invalidateQueries({ queryKey: ['production-batches-summary'] }); setSelected(null) }

  const rows = summary.data ?? []
  const totalAll = rows.reduce((a, r) => a + r.total, 0)
  const houseAll = rows.reduce((a, r) => a + r.house, 0)
  const customerAll = rows.reduce((a, r) => a + r.customer, 0)

  return <>
    <div className="rap-hero"><h2>TIẾN ĐỘ ĐƠN</h2><p>Tiến độ rập theo nhà may — tìm nhanh mã rập, kiểm tra số lượng nhận và tình trạng thanh toán.</p></div>

    <div className="rap-dashboard">
      <button className={`rap-stat-card ${workshopId === '' ? 'active' : ''}`} onClick={() => setWorkshopId('')}>
        <b>Tất cả</b>
        <span>Tổng: {totalAll}</span><span>Nhà: {houseAll}</span><span>KD: {customerAll}</span>
      </button>
      {summary.isLoading ? <div className="loading">Đang tải dashboard…</div> : summary.data!.map(row => (
        <button key={row.workshop_id} className={`rap-stat-card ${workshopId === row.workshop_id ? 'active' : ''}`} onClick={() => setWorkshopId(row.workshop_id)}>
          <b>{row.workshop_name}</b>
          <span>Tổng: {row.total}</span><span>Nhà: {row.house}</span><span>KD: {row.customer}</span>
        </button>
      ))}
    </div>

    <input className="form-control search" placeholder="Tìm Mã rập, Tên SP, Nhà may, Số lớp…" value={q} onChange={e => setQ(e.target.value)}/>
    <div className="segmented payment-filter">
      <button className={payment === 'all' ? 'active' : ''} onClick={() => setPayment('all')}>Tất cả</button>
      <button className={payment === 'unpaid' ? 'active' : ''} onClick={() => setPayment('unpaid')}>Chưa TT</button>
      <button className={payment === 'paid' ? 'active' : ''} onClick={() => setPayment('paid')}>Đã TT</button>
    </div>

    {batches.isLoading ? <div className="loading">Đang tải mâm…</div> : batches.error ? <div className="empty">{errorMessage(batches.error)}</div> : batches.data!.length === 0 ? <div className="empty">Không có mâm nào khớp bộ lọc.</div> : <div className="production-list">{batches.data!.map(batch => (
      <button className="card rap-card" key={batch.id} onClick={() => setSelected(batch)}>
        <div className="rap-thumb">{batch.thumbnail ? <img src={batch.thumbnail} alt=""/> : <span className="rap-noimg"><i className="bi bi-scissors"/></span>}</div>
        <div className="rap-card-body">
          <div className="rap-card-title"><b>{batch.pattern_code}</b><small>{batch.batch_no}</small></div>
          <div>{batch.product_name}</div>
          <div className="rap-card-meta">
            <span>Loại: {batch.batch_type === 'CUSTOMER_ORDER' ? 'Khách đặt' : 'Hàng nhà'}</span>
            <span>Cắt: {formatDateShort(batch.cut_date)}</span>
            <span>Xưởng: {batch.workshop.name}</span>
            <span>Thợ: {batch.cutting_team.name}</span>
          </div>
          <div className="rap-card-meta">
            <span>Lớp: {batch.layer_expression}</span>
            {batch.size_expression && <span>Size: {batch.size_expression}</span>}
            {batch.ratio_expression && <span>Tỉ lệ: {batch.ratio_expression}</span>}
          </div>
          <div className="rap-card-status">
            <span>{statusLabel(PRODUCTION_STATUS_LABEL, batch.production_status)}</span>
            <span>{statusLabel(RECEIPT_STATUS_LABEL, batch.receipt_status)}</span>
            <span>{batch.payment_status === 'paid' ? 'Đã TT' : statusLabel(SETTLEMENT_STATUS_LABEL, batch.settlement_status)}</span>
          </div>
        </div>
        <div className="rap-card-progress"><span>Đã giao</span><b>{batch.delivered_quantity}/{batch.planned_quantity}</b><small>Còn {batch.remaining_quantity}</small></div>
      </button>
    ))}</div>}
    {selected && <BatchDrawer batchId={selected.id} master={master} onClose={() => setSelected(null)} onSaved={reload}/>} 
  </>
}

function CustomerOrders({ onNew }: { onNew: () => void }) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [workshopId, setWorkshopId] = useState('')
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ProductionBatch | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(timer)
  }, [q])

  const summary = useQuery({ queryKey: ['production-batches-summary'], queryFn: () => api<ProgressSummary[]>('/production/batches/summary').then(r => r.data) })
  const batches = useQuery({
    queryKey: ['production-customer-orders', debouncedQ, workshopId],
    queryFn: () => api<ProductionBatch[]>('/production/batches', { query: { batch_type: 'CUSTOMER_ORDER', q: debouncedQ || undefined, workshop_id: workshopId || undefined } }).then(r => r.data),
  })

  async function reload() {
    await qc.invalidateQueries({ queryKey: ['production-customer-orders'] })
    await qc.invalidateQueries({ queryKey: ['production-batches-summary'] })
  }

  async function startPicking(batch: ProductionBatch) {
    try {
      await api(`/production/customer-orders/${batch.id}/start-picking`, { method: 'POST' })
      await reload()
    } catch (caught) { window.alert(errorMessage(caught)) }
  }
  async function markDebt(batch: ProductionBatch) {
    try {
      await api(`/production/customer-orders/${batch.id}/mark-debt-order`, { method: 'POST' })
      await reload()
    } catch (caught) { window.alert(errorMessage(caught)) }
  }
  async function doDelete() {
    if (!confirmDelete) return
    try {
      await api(`/production/customer-orders/${confirmDelete.id}/delete`, { method: 'POST' })
      setConfirmDelete(null)
      await reload()
    } catch (caught) { window.alert(errorMessage(caught)) }
  }

  const rows = summary.data ?? []
  const totalAll = rows.reduce((a, r) => a + r.total, 0)
  const houseAll = rows.reduce((a, r) => a + r.house, 0)
  const customerAll = rows.reduce((a, r) => a + r.customer, 0)
  const today = todayIso()

  return <>
    <div className="rap-hero rap-hero-orange"><h2>KHÁCH ĐẶT</h2><p>Rập dành cho khách đặt — theo dõi đúng khách hàng, ngày giao và tiến độ nhận hàng của từng mâm.</p></div>

    <div className="rap-dashboard">
      <button className={`rap-stat-card ${workshopId === '' ? 'active' : ''}`} onClick={() => setWorkshopId('')}>
        <b>Tất cả</b>
        <span>Tổng: {totalAll}</span><span>Nhà: {houseAll}</span><span>KD: {customerAll}</span>
      </button>
      {summary.isLoading ? <div className="loading">Đang tải dashboard…</div> : summary.data!.map(row => (
        <button key={row.workshop_id} className={`rap-stat-card ${workshopId === row.workshop_id ? 'active' : ''}`} onClick={() => setWorkshopId(row.workshop_id)}>
          <b>{row.workshop_name}</b>
          <span>Tổng: {row.total}</span><span>Nhà: {row.house}</span><span>KD: {row.customer}</span>
        </button>
      ))}
    </div>

    <div className="action-row">
      <input className="form-control search" placeholder="Tìm khách, mã rập, mã mâm, mã hóa đơn…" value={q} onChange={e => setQ(e.target.value)}/>
      <button className="btn-main" onClick={onNew}>+ Thêm rập khách đặt</button>
    </div>

    {batches.isLoading ? <div className="loading">Đang tải khách đặt…</div> : batches.error ? <div className="empty">{errorMessage(batches.error)}</div> : batches.data!.length === 0 ? <div className="empty">Chưa có mâm khách đặt.</div> : <div className="production-list">{batches.data!.map(batch => <CustomerOrderCard key={batch.id} batch={batch} today={today} onOpenImage={setLightbox} onStartPicking={() => startPicking(batch)} onMarkDebt={() => markDebt(batch)} onDelete={() => setConfirmDelete(batch)}/>)}</div>}
    {lightbox && <div className="modal-layer" onClick={() => setLightbox(null)}><div className="lightbox"><img src={lightbox} alt=""/></div></div>}
    {confirmDelete && <div className="modal-layer"><div className="modal-card"><h2>Xóa đơn khách đặt</h2><p>{confirmDelete.customer_name} · {confirmDelete.pattern_code} · {confirmDelete.product_name}</p><p className="muted">Đơn chưa phát sinh nghiệp vụ sẽ được xóa mềm; nếu đã phát sinh sẽ chuyển trạng thái hủy để giữ dữ liệu.</p><div className="modal-actions"><button className="btn-outline" onClick={() => setConfirmDelete(null)}>Hủy</button><button className="btn-main" onClick={doDelete}>XÁC NHẬN XÓA</button></div></div></div>}
  </>
}

function CustomerOrderCard({ batch, today, onOpenImage, onStartPicking, onMarkDebt, onDelete }: {
  batch: ProductionBatch; today: string; onOpenImage: (url: string) => void
  onStartPicking: () => void; onMarkDebt: () => void; onDelete: () => void
}) {
  const progress = batch.planned_quantity > 0 ? Math.min(batch.delivered_quantity / batch.planned_quantity, 1) : 0
  const overdue = !!batch.expected_delivery_date && batch.expected_delivery_date < today && batch.remaining_quantity > 0
  const progressClass = progress >= 1 ? 'done' : progress > 0 ? 'warn' : 'empty'
  return <div className="card rap-customer-card">
    <div className="rap-customer-head">
      <div><b>{batch.customer_name || '—'}</b>{batch.synced_order_no && <small className="rap-order-no">{batch.synced_order_no}</small>}</div>
      <div className="rap-customer-pattern"><b>{batch.pattern_code}</b><small>{batch.product_name}</small></div>
    </div>
    <div className="rap-card-meta">
      <span>Cắt: {formatDateShort(batch.cut_date)}</span>
      <span>Xưởng: {batch.workshop.name}</span>
      <span className={overdue ? 'rap-overdue' : ''}>Giao: {formatDateShort(batch.expected_delivery_date)}</span>
      {batch.ratio_expression && <span>Tỉ lệ: {batch.ratio_expression}</span>}
    </div>
    {batch.images && batch.images.length > 0 && <div className="rap-customer-images">{batch.images.map(img => <img key={img.id} src={img.url} alt="" onClick={() => onOpenImage(img.url)}/>)}</div>}
    <div className={`rap-progress ${progressClass}`}><div className="rap-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }}/></div>
    <div className="rap-progress-label"><span>Tiến độ xưởng: {batch.delivered_quantity}/{batch.planned_quantity}</span>{batch.remaining_quantity <= 0 ? <b className="rap-done">Đủ hàng</b> : <b>Còn {batch.remaining_quantity}</b>}</div>
    <div className="rap-customer-actions">
      <button className="btn-main" onClick={onStartPicking}>Bắt đầu soạn hàng</button>
      <button className="btn-outline" onClick={onMarkDebt}>Nợ đơn</button>
      <button className="btn-outline" onClick={onDelete}>Xóa đơn</button>
    </div>
  </div>
}

type PatternNote = { id: string; note_no: string; title: string; content: string; created_at: string; image_count: number; cover_image: { id: string; url: string; original_name: string | null } | null }
type PatternNoteDetail = PatternNote & { images: Array<{ id: string; url: string; original_name: string | null }> }

function PatternGallery() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(timer)
  }, [q])

  const notes = useQuery({ queryKey: ['pattern-notes', debouncedQ], queryFn: () => api<PatternNote[]>('/pattern-notes', { query: { q: debouncedQ || undefined } }).then(r => r.data) })
  const rows = notes.data ?? []

  return <>
    <div className="rap-hero rap-settle-head"><div><h2>Mã Rập / Ảnh</h2><p>Kho ghi chú mẫu riêng — tìm nhanh và xem ảnh theo từng mã rập.</p></div><button className="btn-main" onClick={() => setAddOpen(true)}>+ Thêm Nội dung</button></div>
    <div className="action-row">
      <input className="form-control search" placeholder="Tìm theo Tên gốc hoặc nội dung..." value={q} onChange={e => setQ(e.target.value)}/>
      <span className="muted">{rows.length} ghi chú</span>
    </div>
    {notes.isLoading ? <div className="pattern-grid">{Array.from({ length: 6 }).map((_, i) => <div className="pattern-card skeleton" key={i}/>)}</div> : notes.error ? <div className="empty">Không thể tải Mã Rập / Ảnh. <button className="btn-outline" onClick={() => notes.refetch()}>Thử lại</button></div> : rows.length === 0 ? <div className="empty">Chưa có ghi chú mã rập nào.</div> : <div className="pattern-grid">{rows.map(n => <button className="pattern-card" key={n.id} onClick={() => setSelected(n.id)}>
      {n.cover_image ? <div className="pattern-cover"><img src={n.cover_image.url} alt="" loading="lazy"/>{n.image_count > 1 && <span className="pattern-count">📷 {n.image_count}</span>}</div> : <div className="pattern-cover pattern-empty"><i className="bi bi-image"/>{n.image_count > 1 && <span className="pattern-count">📷 {n.image_count}</span>}</div>}
      <div className="pattern-body"><b>{n.title}</b><p>{n.content || 'Không có nội dung ghi chú'}</p><small>{new Date(n.created_at).toLocaleString('vi-VN')}</small></div>
    </button>)}</div>}
    {selected && <PatternNoteModal noteId={selected} onClose={() => setSelected(null)}/>}
    {addOpen && <PatternNoteAddModal onClose={() => setAddOpen(false)} onSaved={async () => { setAddOpen(false); await qc.invalidateQueries({ queryKey: ['pattern-notes'] }) }}/>}
  </>
}

function PatternNoteAddModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [uploads, setUploads] = useState<Array<{ key: string; file: File; preview: string }>>([])
  const [state, setState] = useState<SaveDialogState>({ open: true, busy: false, error: '' })

  function addFiles(files: File[]) {
    const accepted = files.filter(f => ['image/jpeg', 'image/png'].includes(f.type) && f.size <= 10 * 1024 * 1024)
    if (accepted.length !== files.length) setState(s => ({ ...s, error: 'Chỉ nhận ảnh JPEG/PNG, mỗi ảnh không quá 10 MB.' }))
    setUploads(cur => [...cur, ...accepted.map(file => ({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file) }))])
  }
  function onPaste(e: ClipboardEvent) {
    const files: File[] = []
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.kind === 'file' && (item.type === 'image/jpeg' || item.type === 'image/png')) {
        const file = item.getAsFile(); if (file) files.push(file)
      }
    }
    if (files.length) { e.preventDefault(); addFiles(files) }
  }
  function removeUpload(key: string) {
    setUploads(cur => { const t = cur.find(i => i.key === key); if (t) URL.revokeObjectURL(t.preview); return cur.filter(i => i.key !== key) })
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setState(beginDialogSave(state))
    if (!title.trim()) { setState(finishDialogSave(state, false, 'Tên gốc / mã rập là bắt buộc.')); return }
    try {
      const mediaIds: string[] = []
      for (const item of uploads) {
        const fd = new FormData(); fd.append('file', item.file)
        const uploaded = await api<{ id: string }>('/media/upload', { method: 'POST', body: fd })
        mediaIds.push(uploaded.data.id)
      }
      await api('/pattern-notes', { method: 'POST', body: { title: title.trim(), content: content.trim(), media_ids: mediaIds, client_token: crypto.randomUUID() } })
      setState(finishDialogSave(state, true)); onSaved()
    } catch (caught) { setState(finishDialogSave(state, false, errorMessage(caught))) }
  }

  return <div className="modal-layer"><form className="modal-card" onSubmit={save} onPaste={onPaste}>
    <h2>Thêm nội dung mã rập</h2>
    <label>Tên gốc / mã rập *<input autoFocus required className="form-control" placeholder="VD: TRG141-K2 hoặc ÁO KHOÁC NAM" value={title} onChange={e => setTitle(e.target.value)}/></label>
    <label>Nội dung ghi chú<textarea className="form-control" rows={4} placeholder="Nhập ghi chú..." value={content} onChange={e => setContent(e.target.value)}/></label>
    <label>Ảnh rập / ảnh mẫu · Tải lên / Chụp / Copy dán (Ctrl + V)</label>
    <label className="upload-picker"><i className="bi bi-images"/> Chọn ảnh JPEG/PNG<input type="file" accept="image/jpeg,image/png" multiple onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}/></label>
    {uploads.length > 0 && <div className="upload-grid">{uploads.map(item => <div className="upload-preview" key={item.key}><img src={item.preview} alt=""/><button type="button" onClick={() => removeUpload(item.key)}>×</button></div>)}</div>}
    {state.error && <div className="error-text">{state.error}</div>}
    <div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={state.busy}>Hủy</button><button className="btn-main" disabled={state.busy}>{state.busy ? 'ĐANG LƯU…' : 'Lưu nội dung'}</button></div>
  </form></div>
}

function PatternNoteModal({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['pattern-note', noteId], queryFn: () => api<PatternNoteDetail>(`/pattern-notes/${noteId}`).then(r => r.data) })
  const [lightbox, setLightbox] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const d = detail.data
  return <div className="modal-layer" onClick={onClose}><div className="modal-card wide" onClick={e => e.stopPropagation()}>
    <button className="btn-back" onClick={onClose}>×</button>
    {detail.isLoading ? <div className="loading">Đang tải…</div> : detail.error ? <div className="empty">{errorMessage(detail.error)}</div> : d ? <>
      <h2>{d.title}</h2>
      <small className="muted">{d.created_at ? new Date(d.created_at).toLocaleString('vi-VN') : ''}</small>
      <p>{d.content || 'Không có nội dung ghi chú.'}</p>
      {d.images && d.images.length > 0 ? <div className="pattern-modal-images">{d.images.map(img => <img key={img.id} src={img.url} alt="" onClick={() => setLightbox(img.url)}/>)}</div> : <div className="empty">Không có ảnh.</div>}
    </> : null}
  </div>
  {lightbox && <div className="modal-layer" onClick={() => setLightbox(null)}><div className="lightbox"><img src={lightbox} alt=""/></div></div>}</div>
}

function BatchDrawer({ batchId, master, onClose, onSaved }: { batchId: string; master: ProductionMaster; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth()
  const isOwner = !!user && ['OWNER', 'ADMIN'].includes(user.role)
  const detail = useQuery({ queryKey: ['production-batch', batchId], queryFn: () => api<ProductionBatch>(`/production/batches/${batchId}`).then(r => r.data) })
  const [receiptOpen, setReceiptOpen] = useState(false); const [materialOpen, setMaterialOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false); const [editOpen, setEditOpen] = useState(false)
  const [forceOpen, setForceOpen] = useState(false); const [importOpen, setImportOpen] = useState(false)
  return <div className="drawer-layer"><section className="drawer"><header className="blue-header"><button className="btn-back" onClick={onClose}>← Quay lại</button><span className="title">Chi tiết mâm</span></header>{detail.isLoading ? <div className="loading">Đang tải…</div> : detail.error ? <div className="empty">{errorMessage(detail.error)}</div> : <>
    <div className="card production-detail"><h2>{detail.data!.batch_no}</h2><p>{detail.data!.pattern_code} · {detail.data!.product_name}</p><div className="money-grid"><span>Kế hoạch<b>{detail.data!.planned_quantity}</b></span><span>Đã nhập<b>{detail.data!.delivered_quantity}</b></span><span>Còn lại<b>{detail.data!.remaining_quantity}</b></span><span>Tiền công<b>{formatMoney(detail.data!.workshop_amount)}</b></span></div><p>Nhà may: <b>{detail.data!.workshop.name}</b> · Thợ cắt: <b>{detail.data!.cutting_team.name}</b></p>{detail.data!.images && detail.data!.images.length > 0 && <div className="upload-grid">{detail.data!.images.map(img => <div className="upload-preview" key={img.id}><img src={img.url} alt={img.original_name || ''}/></div>)}</div>}<div className="action-row"><button className="btn-main" onClick={() => setReceiptOpen(true)}>Nhập</button><button className="btn-outline" onClick={() => setHistoryOpen(true)}>Lịch sử</button><button className="btn-outline" onClick={() => setEditOpen(true)}>Sửa TT</button><button className="btn-outline" onClick={() => setMaterialOpen(true)}>Thêm phụ liệu</button>{detail.data!.delivered_quantity > (detail.data!.imported_quantity ?? 0) && <button className="btn-outline" onClick={() => setImportOpen(true)}>Nhập kho</button>}{isOwner && <button className="btn-outline" onClick={() => setForceOpen(true)}>Ép chốt</button>}</div></div>
    {receiptOpen && <ReceiptModal batch={detail.data!} onClose={() => setReceiptOpen(false)} onSaved={onSaved}/>} 
    {historyOpen && <HistoryModal batch={detail.data!} onClose={() => setHistoryOpen(false)}/>} 
    {editOpen && <EditBatchModal batch={detail.data!} master={master} onClose={() => setEditOpen(false)} onSaved={onSaved}/>} 
    {materialOpen && <MaterialModal batch={detail.data!} catalog={master.material_catalog} onClose={() => setMaterialOpen(false)} onSaved={onSaved}/>} 
    {importOpen && <ImportStockModal batch={detail.data!} onClose={() => setImportOpen(false)} onSaved={onSaved}/>} 
    {forceOpen && <ForceCloseModal batch={detail.data!} onClose={() => setForceOpen(false)} onSaved={onSaved}/>} 
  </>}</section></div>
}

function ForceCloseModal({ batch, onClose, onSaved }: { batch: ProductionBatch; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('')
  const [state, setState] = useState<SaveDialogState>({ open: true, busy: false, error: '' })
  async function save(event: FormEvent) {
    event.preventDefault(); setState(beginDialogSave(state))
    try { await api(`/production/batches/${batch.id}/force-close`, { method: 'POST', body: { reason } }); setState(finishDialogSave(state, true)); onSaved() }
    catch (caught) { setState(finishDialogSave(state, false, errorMessage(caught))) }
  }
  return <div className="modal-layer"><form className="modal-card" onSubmit={save}>
    <h2>Ép chốt mâm hàng</h2>
    <p className="muted">{batch.batch_no} · {batch.product_name}</p>
    <label>Lý do ép chốt *<textarea required className="form-control" rows={3} value={reason} onChange={e => setReason(e.target.value)}/></label>
    {state.error && <div className="error-text">{state.error}</div>}
    <div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={state.busy}>Hủy bỏ</button><button className="btn-main" disabled={state.busy || !reason.trim()}>{state.busy ? 'ĐANG LƯU…' : 'Xác nhận'}</button></div>
  </form></div>
}

function ImportStockModal({ batch, onClose, onSaved }: { batch: ProductionBatch; onClose: () => void; onSaved: () => void }) {
  const imported = batch.imported_quantity ?? 0
  const importable = Math.max(batch.delivered_quantity - imported, 0)
  const [quantity, setQuantity] = useState(String(importable || 0))
  const [note, setNote] = useState('')
  const [state, setState] = useState<SaveDialogState>({ open: true, busy: false, error: '' })
  async function save(event: FormEvent) {
    event.preventDefault(); setState(beginDialogSave(state))
    const value = Number(quantity)
    if (!Number.isFinite(value) || value <= 0) { setState(finishDialogSave(state, false, 'Nhập số lượng nhập kho lớn hơn 0.')); return }
    if (value > importable) { setState(finishDialogSave(state, false, `Không được nhập kho vượt số đã nhận còn có thể nhập (${importable}).`)); return }
    try { await api(`/production/batches/${batch.id}/import-to-inventory`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { quantity: value, notes: note || null } }); setState(finishDialogSave(state, true)); onSaved() }
    catch (caught) { setState(finishDialogSave(state, false, errorMessage(caught))) }
  }
  return <div className="modal-layer"><form className="modal-card" onSubmit={save}>
    <h2>Nhập kho thành phẩm</h2>
    <div className="rap-receipt-info">
      <span>Mã mâm: <b>{batch.batch_no}</b></span>
      <span>Tên sản phẩm: <b>{batch.product_name}</b></span>
      <span>Số lượng đã nhận: <b>{batch.delivered_quantity}</b></span>
      <span>Đã nhập kho: <b>{imported}</b></span>
      <span>Còn có thể nhập: <b>{importable}</b></span>
    </div>
    <label>Số lượng nhập kho lần này<input autoFocus className="form-control" type="number" step="any" value={quantity} onChange={e => setQuantity(e.target.value)}/></label>
    <label>Ghi chú<textarea className="form-control" rows={2} value={note} onChange={e => setNote(e.target.value)}/></label>
    {state.error && <div className="error-text">{state.error}</div>}
    <div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={state.busy}>Hủy</button><button className="btn-main" disabled={state.busy}>{state.busy ? 'ĐANG LƯU…' : 'XÁC NHẬN NHẬP KHO'}</button></div>
  </form></div>
}

function ReceiptModal({ batch, onClose, onSaved }: { batch: ProductionBatch; onClose: () => void; onSaved: () => void }) {
  const plan = batch.size_plans?.[0]
  const [quantity, setQuantity] = useState(String(batch.remaining_quantity || 0))
  const [note, setNote] = useState('')
  const [state, setState] = useState<SaveDialogState>({ open: true, busy: false, error: '' })
  async function save(event: FormEvent) {
    event.preventDefault(); setState(beginDialogSave(state))
    const value = Number(quantity)
    if (!Number.isFinite(value) || value === 0) { setState(finishDialogSave(state, false, 'Nhập số lượng khác 0 (số dương để nhận, số âm để điều chỉnh giảm).')); return }
    try {
      await api(`/production/batches/${batch.id}/receipts`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { receipt_date: todayIso(), warehouse_id: batch.planned_warehouse_id, color_id: null, lines: [{ batch_size_plan_id: plan?.id || null, product_variant_id: plan?.product_variant_id || null, received_now: value, import_to_stock: false }], notes: note || null } })
      setState(finishDialogSave(state, true)); onSaved()
    } catch (caught) { setState(finishDialogSave(state, false, errorMessage(caught))) }
  }
  return <div className="modal-layer"><form className="modal-card" onSubmit={save}>
    <h2>Nhận hàng theo số lượng quần</h2>
    <div className="rap-receipt-info">
      <span>Mã: <b>{batch.batch_no}</b></span>
      {batch.size_expression && <span>Size kế hoạch: <b>{batch.size_expression}</b></span>}
      {batch.ratio_expression && <span>Tỉ lệ tham khảo: <b>{batch.ratio_expression}</b></span>}
      <span>Kế hoạch: <b>{batch.layer_expression} / {batch.planned_quantity} cái</b></span>
      <span>Đã nhận: <b>{batch.delivered_quantity} cái</b></span>
      <span>Còn thiếu: <b>{batch.remaining_quantity} cái</b></span>
    </div>
    <label>Số lượng quần nhận / điều chỉnh *<input autoFocus className="form-control" type="number" step="any" placeholder="VD: 100 hoặc -1 để trừ" value={quantity} onChange={e => setQuantity(e.target.value)}/></label>
    <div className="rap-receipt-actions">
      <button type="button" className="btn-outline" onClick={() => setQuantity(String(batch.remaining_quantity || 0))}>Tự điền còn thiếu</button>
      <button type="button" className="btn-outline" onClick={() => setQuantity('')}>Xóa số</button>
    </div>
    <label>Ghi chú<textarea className="form-control" rows={2} placeholder="VD: nhà may giao đợt 1 / còn thiếu màu..." value={note} onChange={e => setNote(e.target.value)}/></label>
    {state.error && <div className="error-text">{state.error}</div>}
    <div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={state.busy}>Đóng</button><button className="btn-main" disabled={state.busy}>{state.busy ? 'ĐANG LƯU…' : 'LƯU PHIẾU NHẬN'}</button></div>
  </form></div>
}

function HistoryModal({ batch, onClose }: { batch: ProductionBatch; onClose: () => void }) {
  const history = useQuery({ queryKey: ['receipt-history', batch.id], queryFn: () => api<ProductionReceipt[]>(`/production/batches/${batch.id}/receipts`).then(r => r.data) })
  const rows = history.data ?? []
  const ascending = [...rows].reverse()
  let running = 0
  const afterByReceipt = new Map<string, number>()
  for (const row of ascending) { running += row.actual_quantity; afterByReceipt.set(row.id, running) }
  return <div className="modal-layer"><div className="modal-card"><h2>Lịch sử nhập mâm hàng</h2>
    <p className="muted">{batch.pattern_code} · {batch.product_name}</p>
    {history.isLoading ? <div className="loading">Đang tải…</div> : history.error ? <div className="empty">{errorMessage(history.error)}</div> : rows.length === 0 ? <div className="empty">Chưa có lần nhập hàng nào.</div> : <div className="history-list">{rows.map(row => <div className="compact-row" key={row.id}><span><b>{row.receipt_no}</b><small>{row.receipt_date} · {row.received_by || '—'}{row.notes ? ` · ${row.notes}` : ''}</small></span><strong>{row.actual_quantity > 0 ? '+' : ''}{row.actual_quantity}</strong><small>Sau: {afterByReceipt.get(row.id) ?? row.actual_quantity}</small></div>)}</div>}
    <div className="modal-actions"><button className="btn-outline" onClick={onClose}>Đóng</button></div>
  </div></div>
}

function EditBatchModal({ batch, master, onClose, onSaved }: { batch: ProductionBatch; master: ProductionMaster; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ product_name: batch.product_name, pattern_code: batch.pattern_code, layer_expression: batch.layer_expression, workshop_id: batch.workshop.id, cutting_team_id: batch.cutting_team.id, cut_date: batch.cut_date, workshop_unit_price_amount: String(batch.workshop_unit_price_amount), notes: batch.notes || '' })
  const [state, setState] = useState<SaveDialogState>({ open: true, busy: false, error: '' })
  function update(name: string, value: string) { setForm(current => ({ ...current, [name]: value })) }
  async function save(event: FormEvent) {
    event.preventDefault(); setState(beginDialogSave(state))
    try {
      await api(`/production/batches/${batch.id}`, { method: 'PATCH', body: { version: batch.version, product_name: form.product_name, pattern_code: form.pattern_code, layer_expression: form.layer_expression, workshop_id: form.workshop_id, cutting_team_id: form.cutting_team_id, cut_date: form.cut_date, workshop_unit_price_amount: Number(form.workshop_unit_price_amount) || 0, notes: form.notes || null } })
      setState(finishDialogSave(state, true)); onSaved()
    } catch (caught) { setState(finishDialogSave(state, false, errorMessage(caught))) }
  }
  return <div className="modal-layer"><form className="modal-card wide" onSubmit={save}>
    <h2>Sửa thông tin</h2>
    <div className="production-grid">
      <label>Nhà may<select className="form-control" value={form.workshop_id} onChange={e => update('workshop_id', e.target.value)}>{master.workshops.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <label>Thợ cắt<select className="form-control" value={form.cutting_team_id} onChange={e => update('cutting_team_id', e.target.value)}>{master.cutting_teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Ngày cắt<input className="form-control" type="date" value={form.cut_date} onChange={e => update('cut_date', e.target.value)}/></label>
      <label>Đơn giá nhà may<input className="form-control" type="number" min="0" value={form.workshop_unit_price_amount} onChange={e => update('workshop_unit_price_amount', e.target.value)}/></label>
      <label>Mã rập<input required className="form-control" value={form.pattern_code} onChange={e => update('pattern_code', e.target.value)}/></label>
      <label>Tên sản phẩm<input required className="form-control" value={form.product_name} onChange={e => update('product_name', e.target.value)}/></label>
      <label>Số lớp<input required className="form-control" placeholder="VD: 20x5=100" value={form.layer_expression} onChange={e => update('layer_expression', e.target.value)}/></label>
    </div>
    <label>Ghi chú<textarea className="form-control" rows={2} value={form.notes} onChange={e => update('notes', e.target.value)}/></label>
    {state.error && <div className="error-text">{state.error}</div>}
    <div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={state.busy}>Hủy</button><button className="btn-main" disabled={state.busy}>{state.busy ? 'ĐANG LƯU…' : 'LƯU THAY ĐỔI'}</button></div>
  </form></div>
}

function MaterialModal({ batch, catalog, onClose, onSaved }: { batch: ProductionBatch; catalog: string[]; onClose: () => void; onSaved: () => void }) {
  const history = useQuery({ queryKey: ['material-history', batch.id], queryFn: () => api<MaterialHistory>(`/production/batches/${batch.id}/material-deliveries`).then(r => r.data) })
  const [lines, setLines] = useState<MaterialLine[]>([{ name: catalog[0] || 'Phụ liệu khác', totalRequired: '1', quantity: '1', deliverFull: false }]); const [receivedBy, setReceivedBy] = useState('')
  const [state, setState] = useState<SaveDialogState>({ open: true, busy: false, error: '' })
  function patchLine(index: number, patch: Partial<MaterialLine>) { setLines(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row)) }
  async function save(event: FormEvent) { event.preventDefault(); setState(beginDialogSave(state)); try { await api(`/production/batches/${batch.id}/material-deliveries`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { delivery_date: todayIso(), received_by: receivedBy || null, notes: null, items: lines.map(row => ({ name: row.name, total_required: Number(row.totalRequired), quantity: row.deliverFull ? null : Number(row.quantity), deliver_full: row.deliverFull })) } }); setState(finishDialogSave(state, true)); onSaved() } catch (caught) { setState(finishDialogSave(state, false, errorMessage(caught))) } }
  return <div className="modal-layer"><form className="modal-card wide" onSubmit={save}><h2>Giao phụ liệu · {batch.batch_no}</h2>{history.data?.totals.map(row => <div className="compact-row" key={row.name}><span>{row.name}</span><small>Đã giao {row.delivered}/{row.total_required}</small><b>Còn {row.remaining}</b></div>)}<label>Người nhận<input className="form-control" value={receivedBy} onChange={e => setReceivedBy(e.target.value)}/></label>{lines.map((line, index) => <div className="material-line" key={index}><select className="form-control" value={line.name} onChange={e => patchLine(index, { name: e.target.value })}>{catalog.map(name => <option key={name}>{name}</option>)}</select><input className="form-control" type="number" min="0.001" step="0.001" title="Tổng cần" value={line.totalRequired} onChange={e => patchLine(index, { totalRequired: e.target.value })}/><input className="form-control" type="number" min="0.001" step="0.001" disabled={line.deliverFull} title="Giao lần này" value={line.quantity} onChange={e => patchLine(index, { quantity: e.target.value })}/><label className="check"><input type="checkbox" checked={line.deliverFull} onChange={e => patchLine(index, { deliverFull: e.target.checked })}/> Giao đủ phần còn lại</label><button type="button" className="line-remove" onClick={() => setLines(rows => rows.filter((_, i) => i !== index))}>×</button></div>)}<button type="button" className="btn-outline" onClick={() => setLines(rows => [...rows, { name: catalog[0] || 'Phụ liệu khác', totalRequired: '1', quantity: '1', deliverFull: false }])}>+ Thêm phụ liệu</button>{state.error && <div className="error-text">{state.error}</div>}<div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={state.busy}>Hủy</button><button className="btn-main" disabled={state.busy || lines.length === 0}>{state.busy ? 'ĐANG LƯU…' : 'LƯU PHIẾU GIAO'}</button></div></form></div>
}

type WorkshopCandidates = { batches: ProductionBatch[]; supplemental_deliveries: Array<{ id: string; delivery_no: string; amount: number }> }

function Workshops({ master }: { master: ProductionMaster }) {
  const [tab, setTab] = useState<'chot' | 'congno'>('chot')
  return <>
    <div className="rap-hero rap-hero-green"><h2>NHÀ MAY</h2><p>Chốt công, đối chiếu công nợ và thanh toán cho từng nhà may.</p></div>
    <div className="segmented payment-filter">
      <button className={tab === 'chot' ? 'active' : ''} onClick={() => setTab('chot')}>Chốt TT</button>
      <button className={tab === 'congno' ? 'active' : ''} onClick={() => setTab('congno')}>Công nợ & Thanh toán</button>
    </div>
    {tab === 'chot' ? <ChotTT master={master}/> : <CongNo master={master}/>}
  </>
}

function ChotTT({ master }: { master: ProductionMaster }) {
  const qc = useQueryClient()
  const [workshopId, setWorkshopId] = useState(master.workshops[0]?.id || '')
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [copyMsg, setCopyMsg] = useState('')
  const [success, setSuccess] = useState('')
  const [supplementBatch, setSupplementBatch] = useState<ProductionBatch | null>(null)
  const candidates = useQuery({ queryKey: ['workshop-candidates', workshopId], enabled: Boolean(workshopId), queryFn: () => api<WorkshopCandidates>(`/workshops/${workshopId}/settlement-candidates`).then(r => r.data) })
  const settled = useQuery({ queryKey: ['workshop-settled', workshopId], enabled: Boolean(workshopId), queryFn: () => api<ProductionBatch[]>(`/workshops/${workshopId}/settled-batches`).then(r => r.data) })
  const batches = candidates.data?.batches ?? []
  const total = batches.reduce((a, b) => a + b.delivered_quantity * b.workshop_unit_price_amount, 0)
  const workshop = master.workshops.find(w => w.id === workshopId)

  function buildTableText(): string {
    const lines = [`Xưởng: ${workshop?.name || ''}`, 'STT\tMÃ RẬP\tSỐ LỚP\tNHẬN\tĐƠN GIÁ\tTHÀNH TIỀN']
    batches.forEach((b, i) => lines.push(`${i + 1}\t${b.pattern_code}\t${b.layer_expression}\t${b.delivered_quantity}\t${b.workshop_unit_price_amount}\t${(b.delivered_quantity * b.workshop_unit_price_amount).toLocaleString('vi-VN')}`))
    lines.push(`TỔNG CẦN THANH TOÁN: ${total.toLocaleString('vi-VN')}đ`)
    return lines.join('\n')
  }
  async function copyTable() {
    if (!batches.length) return
    const text = buildTableText()
    try { await navigator.clipboard.writeText(text); setCopyMsg('Đã copy bảng kê vào clipboard.') }
    catch { setCopyMsg('Trình duyệt chặn clipboard:\n' + text) }
  }

  async function createSettlement() {
    if (!window.confirm(`Chốt TT xưởng ${workshop?.name || ''} với ${selected.length} mâm?`)) return
    setBusy(true); setError(''); setSuccess('')
    try {
      const result = await api<WorkshopSettlement>('/workshop-settlements', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { workshop_id: workshopId, batch_ids: selected, supplemental_ids: [], settlement_date: todayIso(), notes: null } })
      setSelected([])
      setSuccess(`Đã chốt bảng kê ${result.data.settlement_no} · ${formatMoney(result.data.total_amount)}.`)
      await qc.invalidateQueries({ queryKey: ['workshop-candidates'] })
      await qc.invalidateQueries({ queryKey: ['workshop-settled'] })
      await qc.invalidateQueries({ queryKey: ['workshop-settlements'] })
      await qc.invalidateQueries({ queryKey: ['workshop-debt', workshopId] })
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  return <>
    <div className="card">
      <label>Chọn nhà may *<select className="form-control" value={workshopId} onChange={e => { setWorkshopId(e.target.value); setSelected([]); setCopyMsg(''); setSuccess('') }}><option value="">-- Chọn Nhà May --</option>{master.workshops.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    </div>
    {!workshopId ? <div className="empty">Vui lòng chọn nhà may...</div> : <>
      <div className="card">
        <div className="rap-settle-head"><h2 className="section-title">Xưởng: {workshop?.name}</h2><div className="rap-settle-tools"><button className="btn-outline" onClick={copyTable} disabled={!batches.length}>Copy bảng</button></div></div>
        {candidates.isLoading ? <div className="loading">Đang tải…</div> : candidates.error ? <div className="empty">{errorMessage(candidates.error)}</div> : batches.length === 0 ? <div className="empty">Không có mâm đủ điều kiện chốt.</div> : <>
          <table className="rap-table">
            <thead><tr><th/><th>STT</th><th>Mã rập</th><th>Số lớp</th><th>Nhận</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
            <tbody>{batches.map((batch, i) => <tr key={batch.id}><td><input type="checkbox" checked={selected.includes(batch.id)} onChange={e => setSelected(rows => e.target.checked ? [...rows, batch.id] : rows.filter(id => id !== batch.id))}/></td><td>{i + 1}</td><td>{batch.pattern_code}<small className="rap-sub">{batch.batch_no}</small></td><td>{batch.layer_expression}</td><td>{batch.delivered_quantity}</td><td>{batch.workshop_unit_price_amount.toLocaleString('vi-VN')}</td><td>{formatMoney(batch.delivered_quantity * batch.workshop_unit_price_amount)}</td></tr>)}</tbody>
          </table>
          <div className="rap-settle-total">TỔNG CẦN THANH TOÁN: <b>{formatMoney(total)}</b></div>
          {error && <div className="error-text">{error}</div>}
          {success && <div className="success-text">{success}</div>}
          {copyMsg && <div className="success-text">{copyMsg}</div>}
          <button className="btn-main" disabled={busy || !selected.length} onClick={createSettlement}>{busy ? 'ĐANG CHỐT…' : 'CHỐT TT XƯỞNG NÀY'}</button>
        </>}
      </div>
      <div className="card">
        <h2 className="section-title">Mâm đã chốt</h2>
        {settled.isLoading ? <div className="loading">Đang tải…</div> : settled.data!.length === 0 ? <div className="empty">Chưa có mâm nào được chốt.</div> : <div className="production-list">{settled.data!.map(batch => <div className="compact-row" key={batch.id}><span><b>{batch.batch_no}</b><small>{batch.pattern_code} · {batch.product_name}</small></span><strong>{batch.delivered_quantity}</strong><button className="btn-outline" onClick={() => setSupplementBatch(batch)}>Thêm dòng</button></div>)}</div>}
      </div>
      {supplementBatch && <SupplementModal batch={supplementBatch} onClose={() => setSupplementBatch(null)} onSaved={async () => { setSupplementBatch(null); await qc.invalidateQueries({ queryKey: ['workshop-settled'] }); await qc.invalidateQueries({ queryKey: ['workshop-candidates'] }) }}/>}
    </>}
  </>
}

function SupplementModal({ batch, onClose, onSaved }: { batch: ProductionBatch; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(todayIso())
  const [quantity, setQuantity] = useState('1')
  const [price, setPrice] = useState(String(batch.workshop_unit_price_amount || 0))
  const [note, setNote] = useState('')
  const [state, setState] = useState<SaveDialogState>({ open: true, busy: false, error: '' })
  async function save(event: FormEvent) {
    event.preventDefault(); setState(beginDialogSave(state))
    const qty = Number(quantity); const unit = Number(price)
    if (!Number.isFinite(qty) || qty <= 0) { setState(finishDialogSave(state, false, 'Số lượng thêm phải lớn hơn 0.')); return }
    if (!Number.isFinite(unit) || unit <= 0) { setState(finishDialogSave(state, false, 'Đơn giá phải lớn hơn 0.')); return }
    try {
      await api('/supplemental-workshop-deliveries', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { batch_id: batch.id, delivery_date: date, quantity: qty, unit_price_amount: unit, notes: note || null, expected_batch_version: batch.version } })
      setState(finishDialogSave(state, true)); onSaved()
    } catch (caught) { setState(finishDialogSave(state, false, errorMessage(caught))) }
  }
  return <div className="modal-layer"><form className="modal-card" onSubmit={save}>
    <h2>Thêm dòng hàng giao thêm</h2>
    <p className="muted">Mã rập: {batch.pattern_code} · Đã nhận hiện tại: {batch.delivered_quantity}<br/>Bảng kê gốc sẽ không bị thay đổi; dòng mới tạo bảng kê bổ sung riêng.</p>
    <label>Ngày giao<input required className="form-control" type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
    <label>Số lượng thêm<input autoFocus required className="form-control" type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)}/></label>
    <label>Đơn giá<input required className="form-control" type="number" min="1" value={price} onChange={e => setPrice(e.target.value)}/></label>
    <label>Ghi chú<textarea className="form-control" rows={2} value={note} onChange={e => setNote(e.target.value)}/></label>
    {state.error && <div className="error-text">{state.error}</div>}
    <div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={state.busy}>Hủy</button><button className="btn-main" disabled={state.busy}>{state.busy ? 'ĐANG LƯU…' : 'LƯU DÒNG MỚI'}</button></div>
  </form></div>
}

function CongNo({ master }: { master: ProductionMaster }) {
  const qc = useQueryClient()
  const [workshopId, setWorkshopId] = useState(master.workshops[0]?.id || '')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'settlement' | 'payment'>('all')
  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const workshop = master.workshops.find(w => w.id === workshopId)
  const debt = useQuery({ queryKey: ['workshop-debt', workshopId], enabled: Boolean(workshopId), queryFn: () => api<WorkshopDebtStatement>(`/workshops/${workshopId}/debt-ledger`).then(r => r.data) })
  const settlements = useQuery({ queryKey: ['workshop-settlements', workshopId], enabled: Boolean(workshopId), queryFn: () => api<WorkshopSettlement[]>('/workshop-settlements', { query: { workshop_id: workshopId } }).then(r => r.data) })

  async function reload() {
    await qc.invalidateQueries({ queryKey: ['workshop-debt', workshopId] })
    await qc.invalidateQueries({ queryKey: ['workshop-settlements', workshopId] })
    await qc.invalidateQueries({ queryKey: ['production-master'] })
  }

  const d = debt.data
  const entries = d?.entries ?? []
  const filtered = entries.filter(e => {
    if (filter === 'settlement' && e.entry_type !== 'WORKSHOP_SETTLEMENT') return false
    if (filter === 'payment' && e.entry_type !== 'WORKSHOP_PAYMENT') return false
    if (q) { const hay = `${e.description || ''} ${e.reference_type || ''} ${e.entry_type}`.toLowerCase(); if (!hay.includes(q.toLowerCase())) return false }
    return true
  }).slice().reverse()

  const rows = settlements.data ?? []
  const unpaidRows = rows.filter(r => r.balance_amount > 0)

  return <>
    <div className="card">
      <label>Chọn nhà may *<select className="form-control" value={workshopId} onChange={e => setWorkshopId(e.target.value)}><option value="">-- Chọn Nhà May --</option>{master.workshops.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    </div>
    {!workshopId ? <div className="empty">Vui lòng chọn nhà may...</div> : <>
      <div className="rap-congno-tools">
        <button className="btn-outline" onClick={() => setAdvanceOpen(true)}>Ứng trước</button>
        <button className="btn-outline" onClick={() => setPayOpen(true)} disabled={!unpaidRows.length}>Thanh toán bảng kê</button>
      </div>

      <div className="card"><h2 className="section-title">Công nợ hiện tại</h2><div className="rap-debt-current">{formatMoney(d?.closing ?? 0)}</div><small className="muted">Tổng chốt - toàn bộ thanh toán / ứng trước</small></div>

      <div className="rap-reconcile">
        <div className="card"><small>Phát sinh từ chốt</small><b>+{formatMoney(d?.debit ?? 0)}</b></div>
        <div className="card"><small>Đã thanh toán / ứng</small><b>-{formatMoney(d?.credit ?? 0)}</b></div>
        <div className="card"><small>Số dư hiện tại</small><b>{formatMoney(d?.closing ?? 0)}</b></div>
      </div>

      <div className="card">
        <h2 className="section-title">Bảng giao dịch</h2>
        <input className="form-control search" placeholder="Tìm mã, ghi chú, người thao tác..." value={q} onChange={e => setQ(e.target.value)}/>
        <div className="segmented payment-filter">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Tất cả giao dịch</button>
          <button className={filter === 'settlement' ? 'active' : ''} onClick={() => setFilter('settlement')}>Chốt</button>
          <button className={filter === 'payment' ? 'active' : ''} onClick={() => setFilter('payment')}>Thanh toán / ứng</button>
        </div>
        {debt.isLoading ? <div className="loading">Đang tải…</div> : filtered.length === 0 ? <div className="empty">Chưa có giao dịch.</div> : <table className="rap-table">
          <thead><tr><th>Ngày</th><th>Loại / nguồn</th><th>Nội dung</th><th>Cộng nợ</th><th>Trừ nợ</th><th>Số dư</th></tr></thead>
          <tbody>{filtered.map(e => <tr key={e.id}><td>{formatDateShort(e.occurred_at)}</td><td>{e.entry_type === 'WORKSHOP_SETTLEMENT' ? 'Chốt công' : e.entry_type === 'WORKSHOP_PAYMENT' ? 'Thanh toán / ứng' : e.entry_type}</td><td>{e.description || '—'}</td><td>{e.debit ? '+' + formatMoney(e.debit) : ''}</td><td>{e.credit ? '-' + formatMoney(e.credit) : ''}</td><td><b>{formatMoney(e.balance)}</b></td></tr>)}</tbody>
        </table>}
      </div>

      <div className="card">
        <h2 className="section-title">Sổ công nợ theo chốt</h2>
        {settlements.isLoading ? <div className="loading">Đang tải…</div> : rows.length === 0 ? <div className="empty">Chưa có bảng kê chốt nào.</div> : <div className="production-list">{rows.map(s => <div className="card rap-settlement" key={s.id}><div className="rap-settlement-head"><b>{s.settlement_no}</b><span>{formatDateShort(s.settlement_date)}</span></div><div className="rap-settlement-body"><span>Chốt <b>{s.total_quantity}</b> mâm · {formatMoney(s.total_amount)}</span><span>Còn lại: <b>{formatMoney(s.balance_amount)}</b></span></div><div className="rap-settlement-status">{s.balance_amount <= 0 ? <b className="rap-done">ĐÃ THANH TOÁN XONG</b> : <b className="rap-debt-badge">CÒN NỢ</b>}</div></div>)}</div>}
      </div>
    </>}
    {advanceOpen && <AdvanceModal workshop={workshop} onClose={() => setAdvanceOpen(false)} onSaved={reload}/>}
    {payOpen && <PayModal workshop={workshop} settlements={unpaidRows} onClose={() => setPayOpen(false)} onSaved={reload}/>}
  </>
}

function AdvanceModal({ workshop, onClose, onSaved }: { workshop: { id: string; name: string } | undefined; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(todayIso())
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState('CASH')
  const [state, setState] = useState<SaveDialogState>({ open: true, busy: false, error: '' })
  async function save(event: FormEvent) {
    event.preventDefault(); setState(beginDialogSave(state))
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) { setState(finishDialogSave(state, false, 'Số tiền phải lớn hơn 0.')); return }
    try {
      await api('/workshop-payments', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { workshop_id: workshop!.id, amount: value, method, allocations: [], note: reason || 'Ứng trước', paid_at: date ? `${date}T12:00:00` : null } })
      setState(finishDialogSave(state, true)); onSaved()
    } catch (caught) { setState(finishDialogSave(state, false, errorMessage(caught))) }
  }
  return <div className="modal-layer"><form className="modal-card" onSubmit={save}>
    <h2>Ứng trước nhà may</h2>
    <p className="muted">Xưởng: {workshop?.name}</p>
    <label>Ngày *<input required className="form-control" type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
    <label>Số tiền (đ) *<input autoFocus required className="form-control" type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)}/></label>
    <label>Hình thức<select className="form-control" value={method} onChange={e => setMethod(e.target.value)}><option value="CASH">Tiền mặt</option><option value="BANK_TRANSFER">Chuyển khoản</option></select></label>
    <label>Lý do<textarea className="form-control" rows={2} value={reason} onChange={e => setReason(e.target.value)}/></label>
    {state.error && <div className="error-text">{state.error}</div>}
    <div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={state.busy}>Hủy</button><button className="btn-main" disabled={state.busy}>{state.busy ? 'ĐANG LƯU…' : 'XÁC NHẬN ỨNG TRƯỚC'}</button></div>
  </form></div>
}

function PayModal({ workshop, settlements, onClose, onSaved }: { workshop: { id: string; name: string } | undefined; settlements: WorkshopSettlement[]; onClose: () => void; onSaved: () => void }) {
  const [settlementId, setSettlementId] = useState(settlements[0]?.id || '')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [note, setNote] = useState('')
  const [state, setState] = useState<SaveDialogState>({ open: true, busy: false, error: '' })
  const selected = settlements.find(s => s.id === settlementId)
  async function save(event: FormEvent) {
    event.preventDefault(); setState(beginDialogSave(state))
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) { setState(finishDialogSave(state, false, 'Số tiền phải lớn hơn 0.')); return }
    const allocation = selected ? Math.min(value, selected.balance_amount) : 0
    const allocations = allocation > 0 ? [{ target_id: selected!.id, allocated_amount: allocation }] : []
    try {
      await api('/workshop-payments', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { workshop_id: workshop!.id, amount: value, method, allocations, note: note || null } })
      setState(finishDialogSave(state, true)); onSaved()
    } catch (caught) { setState(finishDialogSave(state, false, errorMessage(caught))) }
  }
  return <div className="modal-layer"><form className="modal-card" onSubmit={save}>
    <h2>Thanh toán nhà may</h2>
    <p className="muted">Xưởng: {workshop?.name}</p>
    <label>Bảng kê<select className="form-control" value={settlementId} onChange={e => { setSettlementId(e.target.value); setAmount(String(settlements.find(s => s.id === e.target.value)?.balance_amount || '')) }}>{settlements.map(s => <option key={s.id} value={s.id}>{s.settlement_no} · còn {formatMoney(s.balance_amount)}</option>)}</select></label>
    <label>Số tiền (đ) *<input required className="form-control" type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)}/></label>
    <label>Hình thức<select className="form-control" value={method} onChange={e => setMethod(e.target.value)}><option value="CASH">Tiền mặt</option><option value="BANK_TRANSFER">Chuyển khoản</option></select></label>
    <label>Ghi chú<textarea className="form-control" rows={2} value={note} onChange={e => setNote(e.target.value)}/></label>
    {selected && Number(amount) > selected.balance_amount && <small className="muted">Số tiền vượt số dư bảng kê; phần dư sẽ giữ làm ứng chưa phân bổ.</small>}
    {state.error && <div className="error-text">{state.error}</div>}
    <div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={state.busy}>Hủy</button><button className="btn-main" disabled={state.busy}>{state.busy ? 'ĐANG LƯU…' : 'XÁC NHẬN THANH TOÁN'}</button></div>
  </form></div>
}

type CuttingMonthlyReport = {
  month: string
  pending_count: number
  total_quantity: number
  total_batches: number
  teams: Array<{
    team_id: string
    team_name: string
    default_unit_price_amount: number
    total_quantity: number
    batch_count: number
    batches: Array<{ batch_id: string; batch_no: string; pattern_code: string; product_name: string; quantity: number }>
  }>
}

function Cutting() {
  const [tab, setTab] = useState<'chot' | 'congno'>('chot')
  return <>
    <div className="rap-hero rap-hero-dark"><h2>THỢ CẮT</h2><p>Chốt công cắt theo tháng và đối chiếu công nợ thợ cắt.</p></div>
    <div className="segmented payment-filter">
      <button className={tab === 'chot' ? 'active' : ''} onClick={() => setTab('chot')}>Chốt TT</button>
      <button className={tab === 'congno' ? 'active' : ''} onClick={() => setTab('congno')}>Công nợ & Thanh toán</button>
    </div>
    {tab === 'chot' ? <CuttingChot/> : <CuttingCongNo/>}
  </>
}

function currentMonth(): string { return todayIso().slice(0, 7) }

function CuttingChot() {
  const qc = useQueryClient()
  const [month, setMonth] = useState(currentMonth())
  const [settleMsg, setSettleMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const report = useQuery({ queryKey: ['cutting-monthly-report', month], queryFn: () => api<CuttingMonthlyReport>('/cutting/monthly-report', { query: { month } }).then(r => r.data) })
  const reportRef = useRef<HTMLDivElement>(null)
  const [copyMsg, setCopyMsg] = useState('')

  async function settleMonth() {
    if (!report.data?.pending_count) return
    if (!window.confirm(`Chốt ${report.data.pending_count} mâm chưa chốt cho tháng ${month}?`)) return
    setBusy(true); setSettleMsg('')
    try {
      const result = await api<{ settled: number; total_amount: number }>('/cutting/monthly-settlements', { method: 'POST', body: { month } })
      setSettleMsg(`Đã chốt ${result.data.settled} mâm · tổng ${formatMoney(result.data.total_amount)}.`)
      await qc.invalidateQueries({ queryKey: ['cutting-monthly-report'] })
      await qc.invalidateQueries({ queryKey: ['cutting-debt-summary'] })
    } catch (caught) { setSettleMsg(errorMessage(caught)) } finally { setBusy(false) }
  }

  async function copyImage() {
    if (!reportRef.current) return
    try {
      const canvas = await html2canvas(reportRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopyMsg('Đã copy ảnh báo cáo vào clipboard.')
    } catch {
      setCopyMsg('Trình duyệt không hỗ trợ copy ảnh; hãy chụp màn hình khu báo cáo.')
    }
  }

  const r = report.data
  const monthLabel = month ? `Tháng ${Number(month.slice(5))}/${month.slice(0, 4)}` : ''

  return <>
    <div className="card">
      <div className="rap-settle-head">
        <label>Chọn tháng<input className="form-control" type="month" value={month} onChange={e => setMonth(e.target.value)}/></label>
        <div className="rap-settle-tools">
          <button className="btn-outline" onClick={copyImage} disabled={!r?.teams?.length}>Copy ảnh</button>
          <button className="btn-main" onClick={settleMonth} disabled={busy || !r?.pending_count}>{busy ? 'ĐANG CHỐT…' : `CHỐT ${r?.pending_count ?? 0} MÂM CHƯA CHỐT`}</button>
        </div>
      </div>
    </div>
    {copyMsg && <div className="success-text">{copyMsg}</div>}
    {settleMsg && <div className={settleMsg.startsWith('Đã') ? 'success-text' : 'error-text'}>{settleMsg}</div>}
    <div ref={reportRef} className="rap-report-wrap">
      <div className="rap-report-head">BÁO CÁO THỢ CẮT<br/><b>{monthLabel}</b><small>Sản lượng cắt, thành tiền, ứng/thanh toán và số còn lại</small></div>
      {report.isLoading ? <div className="loading">Đang tải…</div> : report.error ? <div className="empty">{errorMessage(report.error)}</div> : !r?.teams?.length ? <div className="empty">Tháng này chưa có mâm chưa chốt.</div> : <div className="cutting-grid">
        {r.teams.map(team => <div className="card cutting-team" key={team.team_id}>
          <b>{team.team_name}</b>
          <div className="cutting-qty">{team.batches.map(b => <span key={b.batch_id}>{b.quantity}</span>)}</div>
          <div className="cutting-total">Tổng: <b>{team.total_quantity}</b> · {team.batch_count} mâm</div>
        </div>)}
        <div className="card cutting-team cutting-grand">
          <b>TỔNG TẤT CẢ</b>
          <div className="cutting-total">Tổng: <b>{r.total_quantity}</b> · {r.total_batches} mâm</div>
        </div>
      </div>}
    </div>
    <div className="card rap-settle-head">
      <span className="muted">Bấm Copy ảnh để lấy toàn bộ báo cáo gửi đi.</span>
    </div>
  </>
}

function CuttingCongNo() {
  const qc = useQueryClient()
  const debt = useQuery({ queryKey: ['cutting-debt-summary'], queryFn: () => api<{ teams: Array<{ team_id: string; team_name: string; debit: number; credit: number; balance: number }>; total_balance: number }>('/cutting/debt-summary').then(r => r.data) })
  const monthly = useQuery({ queryKey: ['cutting-monthly-debt'], queryFn: () => api<{ months: Array<{ month: string; settled: number; paid: number; remaining: number; done: boolean }>; total_remaining: number }>('/cutting/monthly-debt').then(r => r.data) })
  const [reportsOpen, setReportsOpen] = useState(false)
  const [paymentsOpen, setPaymentsOpen] = useState(false)
  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [activeMonth, setActiveMonth] = useState<string>('')

  async function reload() {
    await qc.invalidateQueries({ queryKey: ['cutting-debt-summary'] })
    await qc.invalidateQueries({ queryKey: ['cutting-monthly-debt'] })
  }

  const months = monthly.data?.months ?? []
  const pending = months.filter(m => !m.done)
  const done = months.filter(m => m.done)

  return <>
    <div className="card rap-settle-head"><h2 className="section-title">Công nợ đội cắt còn lại</h2><div className="rap-debt-current">{formatMoney(monthly.data?.total_remaining ?? 0)}</div></div>
    <div className="rap-congno-tools">
      <button className="btn-outline" onClick={() => setAdvanceOpen(true)}>Ứng trước</button>
    </div>
    <div className="card"><h2 className="section-title">Công nợ theo tháng</h2>
      {monthly.isLoading ? <div className="loading">Đang tải…</div> : months.length === 0 ? <div className="empty">Chưa có dữ liệu công nợ thợ cắt.</div> : <>
        {pending.length > 0 && <h3 className="section-title">Cần xử lý</h3>}
        {pending.map(m => <div className="card rap-settlement" key={m.month}>
          <div className="rap-settlement-head"><b>Tháng {Number(m.month.slice(5))}/{m.month.slice(0, 4)}</b></div>
          <div className="rap-settlement-body"><span>Chốt: <b>{formatMoney(m.settled)}</b></span><span>Đã ứng/trả: <b>{formatMoney(m.paid)}</b></span><span>Còn lại: <b>{formatMoney(m.remaining)}</b></span></div>
          <div className="rap-settlement-actions">
            <button className="btn-outline" onClick={() => { setActiveMonth(m.month); setReportsOpen(true) }}>Chi tiết chốt tháng</button>
            <button className="btn-outline" onClick={() => { setActiveMonth(m.month); setPaymentsOpen(true) }}>Xem ứng / thanh toán</button>
            <button className="btn-outline" onClick={() => { setActiveMonth(m.month); setAdvanceOpen(true) }}>Ứng thêm</button>
          </div>
        </div>)}
        {done.length > 0 && <h3 className="section-title">Đã thanh toán xong ({done.length} tháng)</h3>}
        {done.map(m => <div className="card rap-settlement" key={m.month}>
          <div className="rap-settlement-head"><b>Tháng {Number(m.month.slice(5))}/{m.month.slice(0, 4)}</b><b className="rap-done">ĐÃ THANH TOÁN XONG</b></div>
          <div className="rap-settlement-actions">
            <button className="btn-outline" onClick={() => { setActiveMonth(m.month); setReportsOpen(true) }}>Chi tiết chốt tháng</button>
            <button className="btn-outline" onClick={() => { setActiveMonth(m.month); setPaymentsOpen(true) }}>Xem ứng / thanh toán</button>
          </div>
        </div>)}
      </>}
    </div>
    {reportsOpen && <CuttingReportsModal month={activeMonth} onClose={() => setReportsOpen(false)}/>}
    {paymentsOpen && <CuttingPaymentsModal month={activeMonth} onClose={() => setPaymentsOpen(false)}/>}
    {advanceOpen && <CuttingAdvanceModal teams={debt.data?.teams ?? []} defaultMonth={activeMonth} onClose={() => setAdvanceOpen(false)} onSaved={reload}/>}
  </>
}

function CuttingReportsModal({ month, onClose }: { month: string; onClose: () => void }) {
  const reports = useQuery({ queryKey: ['cutting-monthly-reports', month], queryFn: () => api<CuttingReportRow[]>('/cutting/monthly-reports', { query: { month } }).then(r => r.data) })
  const rows = reports.data ?? []
  const total = rows.reduce((a, r) => a + r.amount, 0)
  return <div className="modal-layer"><div className="modal-card wide"><h2>Chi tiết chốt tháng</h2><p className="muted">Tháng {Number(month.slice(5))}/{month.slice(0, 4)}</p>
    {reports.isLoading ? <div className="loading">Đang tải…</div> : rows.length === 0 ? <div className="empty">Tháng này chưa có mẻ chốt nào.</div> : <table className="rap-table">
      <thead><tr><th>Mã chốt</th><th>Ngày</th><th>Thợ</th><th>Mâm</th><th>Số lượng</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td>{r.report_no}</td><td>{formatDateShort(r.report_date)}</td><td>{r.team_name}</td><td>{r.batch_no || r.pattern_code}</td><td>{r.quantity}</td><td>{r.unit_price_amount.toLocaleString('vi-VN')}</td><td>{formatMoney(r.amount)}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={6} className="rap-settle-total">Tổng</td><td><b>{formatMoney(total)}</b></td></tr></tfoot>
    </table>}
    <div className="modal-actions"><button className="btn-outline" onClick={onClose}>Đóng</button></div>
  </div></div>
}

function CuttingPaymentsModal({ month, onClose }: { month: string; onClose: () => void }) {
  const payments = useQuery({ queryKey: ['cutting-monthly-payments', month], queryFn: () => api<CuttingPaymentRow[]>('/cutting/monthly-payments', { query: { month } }).then(r => r.data) })
  const rows = payments.data ?? []
  const total = rows.reduce((a, r) => a + r.amount, 0)
  return <div className="modal-layer"><div className="modal-card wide"><h2>Chi tiết thanh toán</h2><p className="muted">Tháng {Number(month.slice(5))}/{month.slice(0, 4)}</p>
    {payments.isLoading ? <div className="loading">Đang tải…</div> : rows.length === 0 ? <div className="empty">Tháng này chưa có ứng/thanh toán.</div> : <table className="rap-table">
      <thead><tr><th>Ngày</th><th>Loại</th><th>Thợ</th><th>Số tiền</th><th>Lý do</th><th>Người nhập</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td>{formatDateShort(r.occurred_at)}</td><td>Ứng</td><td>{r.team_name}</td><td>{formatMoney(r.amount)}</td><td>{r.description || '—'}</td><td>{r.entered_by || '—'}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={3} className="rap-settle-total">Tổng</td><td><b>{formatMoney(total)}</b></td><td colSpan={2}/></tr></tfoot>
    </table>}
    <div className="modal-actions"><button className="btn-outline" onClick={onClose}>Đóng</button></div>
  </div></div>
}

function CuttingAdvanceModal({ teams, defaultMonth, onClose, onSaved }: { teams: Array<{ team_id: string; team_name: string }>; defaultMonth: string; onClose: () => void; onSaved: () => void }) {
  const [teamId, setTeamId] = useState(teams[0]?.team_id || '')
  const [month, setMonth] = useState(defaultMonth || currentMonth())
  const [date, setDate] = useState(todayIso())
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [state, setState] = useState<SaveDialogState>({ open: true, busy: false, error: '' })
  async function save(event: FormEvent) {
    event.preventDefault(); setState(beginDialogSave(state))
    const value = Number(amount)
    if (!teamId) { setState(finishDialogSave(state, false, 'Chọn thợ cắt.')); return }
    if (!Number.isFinite(value) || value <= 0) { setState(finishDialogSave(state, false, 'Số tiền phải lớn hơn 0.')); return }
    try {
      await api('/cutting-payments', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { cutting_team_id: teamId, amount: value, method: 'CASH', allocations: [], note: reason || `Ứng tiền công thợ cắt ${month}`, paid_at: date ? `${date}T12:00:00` : null } })
      setState(finishDialogSave(state, true)); onSaved()
    } catch (caught) { setState(finishDialogSave(state, false, errorMessage(caught))) }
  }
  return <div className="modal-layer"><form className="modal-card" onSubmit={save}>
    <h2>Ứng tiền thợ cắt</h2>
    <label>Thợ cắt<select className="form-control" value={teamId} onChange={e => setTeamId(e.target.value)}>{teams.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}</select></label>
    <label>Tháng ứng<input className="form-control" type="month" value={month} onChange={e => setMonth(e.target.value)}/></label>
    <label>Ngày ứng<input required className="form-control" type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
    <label>Số tiền ứng (đ)<input autoFocus required className="form-control" type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)}/></label>
    <label>Lý do<textarea className="form-control" rows={2} value={reason} onChange={e => setReason(e.target.value)}/></label>
    {state.error && <div className="error-text">{state.error}</div>}
    <div className="modal-actions"><button type="button" className="btn-outline" onClick={onClose} disabled={state.busy}>Hủy</button><button className="btn-main" disabled={state.busy}>{state.busy ? 'ĐANG LƯU…' : 'XÁC NHẬN ỨNG'}</button></div>
  </form></div>
}
