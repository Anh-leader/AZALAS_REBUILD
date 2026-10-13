import { useMemo, useState, type ChangeEvent, type ClipboardEvent, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Customer, type ProductionBatch, type ProductionMaster } from '../api/client'
import { uploadMediaFile } from '../api/media'
import { formatMoney, todayIso } from '../lib/format'
import { normalizeSize, parseColorLayers, parseQuantityExpression, SIZE_ORDER, type ColorLayers } from '../lib/rpParse'

type UploadEntry = { key: string; file: File; preview: string; mediaId?: string; uploading?: boolean; error?: string }
type ModelRow = { key: string; hieu: string; sizeFrom: string; sizeTo: string; ratio: string; colorsText: string }

function message(error: unknown) { return error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.' }

const SIZES = SIZE_ORDER.map(s => s)

function sizeRangeBetween(from: string, to: string): string[] {
  const a = SIZES.indexOf(normalizeSize(from)); const b = SIZES.indexOf(normalizeSize(to))
  if (a < 0 || b < 0 || a > b) return []
  return SIZES.slice(a, b + 1)
}

function ratioDigits(ratio: string): number[] {
  return (ratio || '').trim().split('').map(ch => Number(ch)).filter(n => Number.isFinite(n) && n >= 0)
}

export function CreateBatch({ master, onCreated, initialMode }: { master: ProductionMaster; onCreated: () => void; initialMode?: 'HOUSE' | 'CUSTOMER_ORDER' }) {
  const qc = useQueryClient()
  const customers = useQuery({ queryKey: ['customers', 'production'], queryFn: () => api<Customer[]>('/customers', { query: { sort: 'name_asc' } }).then(r => r.data) })
  const [mode, setMode] = useState<'HOUSE' | 'CUSTOMER_ORDER'>(initialMode ?? 'HOUSE')
  const [form, setForm] = useState({
    cut_date: todayIso(), workshop_id: '', cutting_team_id: '', pattern_code: '', product_id: '',
    product_name: '', workshop_unit_price_amount: '0', planned_warehouse_id: '', fabric_type_id: '',
    notes: '', expected_delivery_date: '', customer_id: '', hieu: '',
    size_from: 'M', size_to: '3XL', ratio_common: '',
    layer_expression: '',
  })
  const [colorMode, setColorMode] = useState<'common' | 'per-model'>('common')
  const [commonColorsText, setCommonColorsText] = useState('')
  const [models, setModels] = useState<ModelRow[]>([{ key: crypto.randomUUID(), hieu: '', sizeFrom: 'M', sizeTo: '3XL', ratio: '', colorsText: '' }])
  const [uploads, setUploads] = useState<UploadEntry[]>([])
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('')
  const [preview, setPreview] = useState(false)

  function update(name: string, value: string) { setForm(current => ({ ...current, [name]: value })) }
  function patchModel(key: string, patch: Partial<ModelRow>) { setModels(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row)) }
  function reloadMaster() { qc.invalidateQueries({ queryKey: ['production-master'] }) }
  async function createCategory(path: string, name: string) {
    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase()
    if (path === 'workshops') await api('/workshops', { method: 'POST', body: { workshop_code: `NM-${suffix}`, name, phone: null, address: null, notes: null } })
    else if (path === 'cutting-teams') await api('/cutting-teams', { method: 'POST', body: { team_code: `CAT-${suffix}`, name, phone: null, default_unit_price_amount: 0, notes: null } })
    else await api('/fabric-types', { method: 'POST', body: { code: null, name, notes: null } })
  }
  async function createCustomer(name: string) {
    await api('/customers', { method: 'POST', body: { name, phone: null, address: null, carrier_name: null, carrier_phone: null } })
  }
  function reloadCustomers() { qc.invalidateQueries({ queryKey: ['customers', 'production'] }) }

  function choosePattern(productId: string) {
    const pattern = master.patterns.find(row => row.product_id === productId)
    setForm(current => ({ ...current, product_id: productId, pattern_code: pattern?.pattern_code || '', product_name: pattern?.name || '' }))
  }

  function addFiles(files: File[]) {
    const room = 20 - uploads.length
    const accepted = files.slice(0, room).filter(file => ['image/jpeg', 'image/png'].includes(file.type) && file.size <= 10 * 1024 * 1024)
    if (accepted.length !== files.length) setError('Chỉ nhận tối đa 20 ảnh JPEG/PNG, mỗi ảnh không quá 10 MB.')
    setUploads(current => [...current, ...accepted.map(file => ({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file) }))])
  }
  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? [])); event.target.value = ''
  }
  function onPaste(event: ClipboardEvent) {
    const files: File[] = []
    for (const item of Array.from(event.clipboardData?.items ?? [])) {
      if (item.kind === 'file' && (item.type === 'image/jpeg' || item.type === 'image/png')) {
        const file = item.getAsFile(); if (file) files.push(file)
      }
    }
    if (files.length) { event.preventDefault(); addFiles(files) }
  }
  function removeUpload(key: string) {
    setUploads(current => { const target = current.find(item => item.key === key); if (target) URL.revokeObjectURL(target.preview); return current.filter(item => item.key !== key) })
  }

  function addModel() { setModels(rows => [...rows, { key: crypto.randomUUID(), hieu: '', sizeFrom: 'M', sizeTo: '3XL', ratio: '', colorsText: '' }]) }
  function removeModel(key: string) { setModels(rows => (rows.length > 1 ? rows.filter(row => row.key !== key) : rows)) }

  const commonColors = useMemo<ColorLayers[]>(() => { try { return parseColorLayers(commonColorsText) } catch { return [] } }, [commonColorsText])

  function buildPlan() {
    const plans: Array<{ color: string; variant_code: string; size: string; layers: number; ratio: number; planned_quantity: number }> = []
    if (mode === 'CUSTOMER_ORDER') {
      const qty = parseQuantityExpression(form.layer_expression)
      const variant = form.hieu.trim()
      const sizes = sizeRangeBetween(form.size_from, form.size_to)
      const digits = ratioDigits(form.ratio_common)
      if (sizes.length && digits.length === sizes.length) {
        const sum = digits.reduce((a, b) => a + b, 0) || 1
        sizes.forEach((size, i) => {
          const ratio = digits[i]
          if (ratio <= 0) return
          plans.push({ color: '', variant_code: variant, size, layers: qty, ratio, planned_quantity: Math.round(qty * ratio / sum) })
        })
      } else if (sizes.length && !form.ratio_common.trim()) {
        // Cắt lẻ: không chia tỉ lệ, ghi một dòng tổng theo dải size.
        const size = sizes.length === 1 ? sizes[0] : `${form.size_from}-${form.size_to}`
        plans.push({ color: '', variant_code: variant, size, layers: qty, ratio: 1, planned_quantity: qty })
      }
      return { plans, total: qty, layerExpression: String(qty) }
    }
    const colors = colorMode === 'common' ? commonColors : []
    const totalLayersByColor = new Map<string, number>()
    for (const c of colors) totalLayersByColor.set(c.color, c.layers.reduce((a, b) => a + b, 0))
    let total = 0
    for (const model of models) {
      const hieu = model.hieu.trim()
      const sizes = sizeRangeBetween(model.sizeFrom, model.sizeTo)
      const digits = ratioDigits(model.ratio)
      if (!sizes.length) throw new Error('Size đầu / size cuối không hợp lệ.')
      if (digits.length !== sizes.length) throw new Error(`Tỉ lệ của hiệu "${hieu || '?'}" phải có đúng ${sizes.length} chữ số.`)
      const perModelColors = colorMode === 'per-model' ? parseColorLayers(model.colorsText) : colors
      for (const c of perModelColors) {
        const layers = c.layers.reduce((a, b) => a + b, 0)
        sizes.forEach((size, i) => {
          const ratio = digits[i]
          const qty = layers * ratio
          plans.push({ color: c.color, variant_code: hieu, size, layers, ratio, planned_quantity: qty })
          total += qty
        })
      }
    }
    return { plans, total, layerExpression: String(total) }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('')
    try {
      let computed: { plans: any[]; total: number; layerExpression: string }
      try { computed = buildPlan() } catch (caught) { setBusy(false); return setError(message(caught)) }
      if (!uploads.length) { setBusy(false); return setError('Chưa có ảnh rập/sản phẩm. Vui lòng chọn hoặc paste ảnh.') }
      if (!form.cut_date || !form.workshop_id || !form.cutting_team_id || !form.pattern_code || !form.planned_warehouse_id || !form.fabric_type_id) {
        setBusy(false); return setError('Chưa đủ thông tin kế hoạch: ngày cắt, nhà may, thợ cắt, mã rập, kho, loại vải là bắt buộc.') }
      const price = Number(form.workshop_unit_price_amount)
      if (!Number.isFinite(price) || price <= 0) { setBusy(false); return setError('Bắt buộc nhập đơn giá nhà may (đ/chiếc).') }
      if (mode === 'CUSTOMER_ORDER' && (!form.customer_id || !form.expected_delivery_date)) { setBusy(false); return setError('Khách đặt cần chọn khách và ngày giao dự kiến.') }
      const productName = form.product_name.trim() || form.pattern_code.trim()
      const completed = [...uploads]
      for (let index = 0; index < completed.length; index += 1) {
        if (completed[index].mediaId) continue
        completed[index] = { ...completed[index], uploading: true }; setUploads([...completed])
        try {
          const response = await uploadMediaFile(completed[index].file, 'production')
          completed[index] = { ...completed[index], mediaId: response.id, uploading: false }; setUploads([...completed])
        } catch (caught) {
          completed[index] = { ...completed[index], uploading: false, error: message(caught) }
          setUploads([...completed]); throw caught
        }
      }
      await api<ProductionBatch>('/production/batches', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: {
        mode, cut_date: form.cut_date, workshop_id: form.workshop_id, cutting_team_id: form.cutting_team_id,
        pattern_code: form.pattern_code, product_id: form.product_id || null, product_name: productName,
        layer_expression: computed.layerExpression,
        size_expression: mode === 'HOUSE' ? models.map(m => `${m.sizeFrom}-${m.sizeTo}`).join('|') : `${form.size_from}-${form.size_to}`,
        ratio_expression: mode === 'HOUSE' ? models.map(m => m.ratio).filter(Boolean).join('|') : (form.ratio_common.trim() || null),
        expected_delivery_date: mode === 'CUSTOMER_ORDER' ? form.expected_delivery_date : null,
        customer_id: mode === 'CUSTOMER_ORDER' ? form.customer_id : null,
        workshop_unit_price_amount: price, planned_warehouse_id: form.planned_warehouse_id,
        fabric_type_id: form.fabric_type_id, notes: form.notes || null,
        media_ids: completed.map(item => item.mediaId),
        size_plans: computed.plans,
      } })
      completed.forEach(item => URL.revokeObjectURL(item.preview))
      setSuccess('Đã lưu phiếu rập thành công.')
      setUploads([]); setCommonColorsText(''); setModels([{ key: crypto.randomUUID(), hieu: '', sizeFrom: 'M', sizeTo: '3XL', ratio: '', colorsText: '' }])
      setForm(current => ({ ...current, layer_expression: '', ratio_common: '' }))
      await qc.invalidateQueries({ queryKey: ['production-batches'] })
      onCreated()
    } catch (caught) { setError(message(caught)) } finally { setBusy(false) }
  }

  return <form className="card production-form" onSubmit={submit} onPaste={onPaste}>
    <h2 className="section-title"><i className="bi bi-scissors"/>Thêm rập mới</h2>
    <div className="field"><label>Loại phiếu</label><div className="segmented"><button type="button" className={mode === 'HOUSE' ? 'active' : ''} onClick={() => setMode('HOUSE')}>Hàng nhà</button><button type="button" className={mode === 'CUSTOMER_ORDER' ? 'active' : ''} onClick={() => setMode('CUSTOMER_ORDER')}>Khách đặt</button></div></div>

    <div className="field"><label>Ảnh rập/sản phẩm * · Tải lên / Chụp / Copy dán (Ctrl + V)</label>
      <label className="upload-picker"><i className="bi bi-images"/> Chọn ảnh JPEG/PNG<input type="file" accept="image/jpeg,image/png" multiple onChange={chooseFiles} disabled={uploads.length >= 20}/></label>
      {uploads.length > 0 && <div className="upload-grid">{uploads.map(item => <div className={`upload-preview ${item.error ? 'failed' : ''}`} key={item.key}><img src={item.preview} alt=""/><button type="button" onClick={() => removeUpload(item.key)}>×</button><small>{item.uploading ? 'Đang tải…' : item.error ? 'Lỗi – sẽ thử lại' : item.mediaId ? 'Đã tải' : item.file.name}</small></div>)}</div>}
    </div>

    <div className="production-grid">
      <label>Ngày cắt *<input required className="form-control" type="date" value={form.cut_date} onChange={e => update('cut_date', e.target.value)}/></label>
      <QuickAdd label="Nhà may *" value={form.workshop_id} options={master.workshops} onAdd={name => createCategory('workshops', name)} onCreated={reloadMaster} onChange={v => update('workshop_id', v)}/>
      <QuickAdd label="Thợ cắt *" value={form.cutting_team_id} options={master.cutting_teams} onAdd={name => createCategory('cutting-teams', name)} onCreated={reloadMaster} onChange={v => update('cutting_team_id', v)}/>
      <QuickAdd label="Loại vải *" value={form.fabric_type_id} options={master.fabrics} onAdd={name => createCategory('fabric-types', name)} onCreated={reloadMaster} onChange={v => update('fabric_type_id', v)}/>
      <label>Kho nhập dự kiến *<select required className="form-control" value={form.planned_warehouse_id} onChange={e => update('planned_warehouse_id', e.target.value)}><option value="">-- Chọn kho --</option>{master.warehouses.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>Sản phẩm<select className="form-control" value={form.product_id} onChange={e => choosePattern(e.target.value)}><option value="">-- Nhập thủ công --</option>{master.patterns.map(row => <option value={row.product_id} key={row.product_id}>{row.pattern_code} · {row.name}</option>)}</select></label>
      <label>Tên sản phẩm<input className="form-control" placeholder="VD: Quần NAI" value={form.product_name} onChange={e => update('product_name', e.target.value)}/></label>
      <label>Mã rập chung *<input required className="form-control" placeholder="VD: 859DUI" value={form.pattern_code} onChange={e => update('pattern_code', e.target.value)}/></label>
      <label>Đơn giá nhà may (đ/chiếc) *<input required className="form-control" min="0" type="number" placeholder="VD: 12000" value={form.workshop_unit_price_amount} onChange={e => update('workshop_unit_price_amount', e.target.value)}/></label>
      {mode === 'CUSTOMER_ORDER' && <>
        <QuickAdd label="Khách đặt *" value={form.customer_id} options={customers.data?.map(row => ({ id: row.id, name: row.name })) ?? []} onAdd={name => createCustomer(name)} onCreated={reloadCustomers} onChange={v => update('customer_id', v)}/>
        <label>Ngày giao dự kiến *<input required className="form-control" type="date" value={form.expected_delivery_date} onChange={e => update('expected_delivery_date', e.target.value)}/></label>
        <label>Hiệu nếu có<input className="form-control" placeholder="VD: NAI" value={form.hieu} onChange={e => update('hieu', e.target.value)}/></label>
        <label>Size từ<select className="form-control" value={form.size_from} onChange={e => update('size_from', e.target.value)}>{SIZES.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Đến size<select className="form-control" value={form.size_to} onChange={e => update('size_to', e.target.value)}>{SIZES.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Tỉ lệ size (nếu có)<input className="form-control" placeholder="VD: 12221" value={form.ratio_common} onChange={e => update('ratio_common', e.target.value)}/></label>
        <label>Số lớp × số chiếc / tổng SL *<input required className="form-control" placeholder="VD: 100x7=700 hoặc 700" value={form.layer_expression} onChange={e => update('layer_expression', e.target.value)}/></label>
      </>}
    </div>

    {mode === 'HOUSE' && <ColorSizeEditor colorMode={colorMode} setColorMode={setColorMode} commonColorsText={commonColorsText} setCommonColorsText={setCommonColorsText} models={models} patchModel={patchModel} addModel={addModel} removeModel={removeModel} commonColors={commonColors}/>}

    <label>Ghi chú phiếu<textarea className="form-control" value={form.notes} onChange={e => update('notes', e.target.value)}/></label>
    {success && <div className="success-text">{success}</div>}{error && <div className="error-text">{error}</div>}
    <div className="action-row">
      <button type="button" className="btn-outline" onClick={() => setPreview(true)}>1 · Xem trước phiếu</button>
      <button className="btn-main" disabled={busy || customers.isLoading}>{busy ? 'ĐANG TẢI ẢNH & LƯU…' : 'LƯU PHIẾU'}</button>
    </div>
    {preview && <PreviewModal mode={mode} form={form} master={master} commonColors={commonColors} models={models} colorMode={colorMode} onClose={() => setPreview(false)}/>}
  </form>
}

function QuickAdd({ label, value, options, onAdd, onCreated, onChange }: { label: string; value: string; options: { id: string; name: string; code?: string }[]; onAdd: (name: string) => void; onCreated: () => void; onChange: (v: string) => void }) {
  const [adding, setAdding] = useState(false); const [name, setName] = useState(''); const [err, setErr] = useState('')
  async function save() {
    setErr(''); if (!name.trim()) return setErr('Nhập tên.')
    try { await onAdd(name.trim()); setName(''); setAdding(false); onCreated() } catch (caught) { setErr(message(caught)) }
  }
  return <label>{label}
    <div className="quick-add">
      {adding
        ? <><input autoFocus className="form-control" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} placeholder="Nhập tên mới…"/><button type="button" className="btn-outline" onClick={save}>Lưu</button><button type="button" className="btn-outline" onClick={() => setAdding(false)}>×</button></>
        : <><select required className="form-control" value={value} onChange={e => onChange(e.target.value)}><option value="">-- Chọn --</option>{options.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button type="button" className="btn-outline" onClick={() => setAdding(true)}>+</button></>}
    </div>
    {err && <small className="error-text">{err}</small>}
  </label>
}

function ColorSizeEditor({ colorMode, setColorMode, commonColorsText, setCommonColorsText, models, patchModel, addModel, removeModel, commonColors }: {
  colorMode: 'common' | 'per-model'; setColorMode: (m: 'common' | 'per-model') => void
  commonColorsText: string; setCommonColorsText: (t: string) => void
  models: ModelRow[]; patchModel: (k: string, p: Partial<ModelRow>) => void; addModel: () => void; removeModel: (k: string) => void
  commonColors: ColorLayers[]
}) {
  return <div className="card-inner">
    <div className="field"><label>Kiểu nhập màu và tỷ lệ size</label><div className="segmented"><button type="button" className={colorMode === 'common' ? 'active' : ''} onClick={() => setColorMode('common')}>Màu chung toàn phiếu</button><button type="button" className={colorMode === 'per-model' ? 'active' : ''} onClick={() => setColorMode('per-model')}>Màu riêng theo mẫu</button></div></div>
    {colorMode === 'common' && <div className="field"><label>Màu / lớp chung toàn phiếu</label><textarea className="form-control" rows={3} placeholder={'CAM 10 20 30\nĐEN 20 10 20'} value={commonColorsText} onChange={e => setCommonColorsText(e.target.value)}/><button type="button" className="btn-outline" onClick={() => setCommonColorsText(commonColorsText)}>Tách màu chung</button>{commonColors.length > 0 && <div className="color-chips">{commonColors.map(c => <span className="chip" key={c.color}><b>{c.color}</b>{c.layers.join(' ')}</span>)}</div>}</div>}
    <div className="field"><label>Mẫu / hiệu trong phiếu</label>
      {models.map((model, index) => <div className="model-card" key={model.key}>
        <div className="model-head"><b>Mẫu / hiệu {index + 1}</b>{models.length > 1 && <button type="button" className="btn-outline" onClick={() => removeModel(model.key)}>Xóa mẫu</button>}</div>
        <div className="production-grid">
          <label>Chọn hiệu *<input className="form-control" placeholder="VD: NAI, DAS, Nike..." value={model.hieu} onChange={e => patchModel(model.key, { hieu: e.target.value })}/></label>
          <label>Size đầu<select className="form-control" value={model.sizeFrom} onChange={e => patchModel(model.key, { sizeFrom: e.target.value })}>{SIZES.map(s => <option key={s}>{s}</option>)}</select></label>
          <label>Size cuối<select className="form-control" value={model.sizeTo} onChange={e => patchModel(model.key, { sizeTo: e.target.value })}>{SIZES.map(s => <option key={s}>{s}</option>)}</select></label>
          <label>Tỉ lệ size riêng *<input className="form-control" placeholder="VD: 12221" value={model.ratio} onChange={e => patchModel(model.key, { ratio: e.target.value })}/></label>
        </div>
        {colorMode === 'per-model' && <label>Màu / lớp riêng của hiệu {index + 1}<textarea className="form-control" rows={2} placeholder={'CAM 10 20 30\nĐEN 20 10 20'} value={model.colorsText} onChange={e => patchModel(model.key, { colorsText: e.target.value })}/></label>}
      </div>)}
      <button type="button" className="btn-outline" onClick={addModel}>+ Thêm mẫu/hiệu</button>
    </div>
  </div>
}

function PreviewModal({ mode, form, master, commonColors, models, colorMode, onClose }: {
  mode: 'HOUSE' | 'CUSTOMER_ORDER'; form: any; master: ProductionMaster; commonColors: ColorLayers[]; models: ModelRow[]; colorMode: 'common' | 'per-model'; onClose: () => void
}) {
  const workshop = master.workshops.find(w => w.id === form.workshop_id); const team = master.cutting_teams.find(t => t.id === form.cutting_team_id)
  const warehouse = master.warehouses.find(w => w.id === form.planned_warehouse_id); const fabric = master.fabrics.find(f => f.id === form.fabric_type_id)
  return <div className="modal-layer"><div className="modal-card wide" onClick={e => e.stopPropagation()}>
    <h2>Xem trước phiếu rập</h2>
    <div className="compact-row"><span>Loại phiếu</span><b>{mode === 'HOUSE' ? 'Hàng nhà' : 'Khách đặt'}</b></div>
    <div className="compact-row"><span>Ngày cắt</span><b>{form.cut_date}</b></div>
    <div className="compact-row"><span>Nhà may</span><b>{workshop?.name || '—'}</b></div>
    <div className="compact-row"><span>Thợ cắt</span><b>{team?.name || '—'}</b></div>
    <div className="compact-row"><span>Mã rập</span><b>{form.pattern_code || '—'}</b></div>
    <div className="compact-row"><span>Kho nhập</span><b>{warehouse?.name || '—'}</b></div>
    <div className="compact-row"><span>Loại vải</span><b>{fabric?.name || '—'}</b></div>
    <div className="compact-row"><span>Đơn giá</span><b>{formatMoney(Number(form.workshop_unit_price_amount) || 0)}</b></div>
    <h3 className="section-title">Màu / lớp</h3>
    {colorMode === 'common' ? commonColors.map(c => <div className="compact-row" key={c.color}><span>{c.color}</span><b>{c.layers.join(' ')} (tổng {c.layers.reduce((a, b) => a + b, 0)})</b></div>) : models.map(m => <div key={m.key}><b>{m.hieu || 'Hiệu'}</b>{m.colorsText.split('\n').filter(Boolean).map(line => <div className="compact-row" key={line}><span>{line}</span></div>)}</div>)}
    <h3 className="section-title">Mẫu / hiệu</h3>
    {models.map(m => <div className="compact-row" key={m.key}><span>{m.hieu || `Mẫu ${models.indexOf(m) + 1}`}</span><b>{m.sizeFrom}–{m.sizeTo} · tỉ lệ {m.ratio || '—'}</b></div>)}
    <div className="modal-actions"><button className="btn-outline" onClick={onClose}>Đóng</button></div>
  </div></div>
}
