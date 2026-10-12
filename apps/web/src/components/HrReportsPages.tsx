import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type AuditLogRow, type Employee, type HrPersonalReport, type HrSummaryReport, type PayrollRun, type RateHistory, type ReportActionItem, type ReportsOverview } from '../api/client'
import { useAuth } from '../api/auth'
import { formatDate, formatMoney, parseWorkUnits, todayIso } from '../lib/format'

function message(error: unknown) { return error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.' }
const currentMonth = () => todayIso().slice(0, 7)

type HrFeature = 'attendance' | 'advances' | 'edit' | 'report' | 'employees' | 'account'

const FEATURES: Array<[HrFeature, string, string, string]> = [
  ['attendance', 'Nhập công', 'Ngày công, tăng ca và thưởng', 'bi-calendar-check'],
  ['advances', 'Nhập ứng', 'Ghi nhận tiền ứng nhân viên', 'bi-cash-coin'],
  ['edit', 'Chỉnh sửa', 'Sửa giá công và phiếu sai', 'bi-pencil-square'],
  ['report', 'Báo cáo', 'Cá nhân và tổng quát xưởng', 'bi-bar-chart'],
  ['employees', 'DS nhân viên', 'Hồ sơ và lịch sử lương', 'bi-people'],
  ['account', 'Tài khoản', 'Phân quyền và bảo mật', 'bi-shield-lock'],
]

export function HrPage() {
  const [feature, setFeature] = useState<HrFeature>('attendance')
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => api<Employee[]>('/employees').then(r => r.data) })
  return <section className="page hr-page"><h1>QUẢN LÝ NHÂN SỰ</h1>
    <div className="hr-hero"><div className="hr-hero-icon"><i className="bi bi-person-badge"/></div><div><b>Trung tâm nhân sự</b><small>Chấm công, ứng lương, báo cáo và phân quyền nhân viên trong một nơi.</small></div></div>
    <div className="hr-feature-grid">{FEATURES.map(([id, label, sub, icon]) => <button key={id} className={feature === id ? 'active' : ''} onClick={() => setFeature(id)}><i className={`bi ${icon}`}/><span><b>{label}</b><small>{sub}</small></span></button>)}</div>
    {employees.isLoading ? <div className="loading">Đang tải…</div> : employees.error ? <div className="empty">{message(employees.error)}</div> : <div className="hr-feature-body">
      {feature === 'attendance' && <AttendanceFeature employees={employees.data!}/>}
      {feature === 'advances' && <AdvancesFeature employees={employees.data!}/>}
      {feature === 'edit' && <EditFeature employees={employees.data!}/>}
      {feature === 'report' && <ReportFeature employees={employees.data!}/>}
      {feature === 'employees' && <EmployeesFeature/>}
      {feature === 'account' && <AccountFeature/>}
    </div>}
  </section>
}

// ---------- Nhập công ----------
function AttendanceFeature({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [month, setMonth] = useState(currentMonth())
  const [workUnits, setWorkUnits] = useState('')
  const [overtime, setOvertime] = useState('0')
  const [bonus, setBonus] = useState('')
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [busy, setBusy] = useState(false)
  async function save(e: FormEvent) {
    e.preventDefault(); setError(''); setSuccess('')
    const units = parseWorkUnits(workUnits)
    if (!employeeId) return setError('Vui lòng chọn nhân viên.')
    if (units === null || units < 0) return setError('Số công không hợp lệ (VD: 23.3 hoặc 23,3).')
    setBusy(true)
    try {
      await api('/attendance', { method: 'PUT', body: { records: [{
        work_date: `${month}-01`, employee_id: employeeId, shift: 'MONTH',
        work_units: units, overtime_hours: Number(overtime || 0), bonus_amount: Number(bonus || 0), notes: null,
      }] } })
      setSuccess('Đã lưu chấm công.'); setWorkUnits(''); setBonus(''); setOvertime('0')
      qc.invalidateQueries({ queryKey: ['attendance'] })
    } catch (caught) { setError(message(caught)) } finally { setBusy(false) }
  }
  return <div className="card hr-form"><h2 className="section-title">Nhập công</h2>
    <div className="hr-form-grid">
      <label>Tên nhân viên *<select required className="form-control" value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Gõ tìm tên nhân viên...</option>{employees.map(row => <option key={row.id} value={row.id}>{row.full_name}</option>)}</select></label>
      <label>Tháng / năm *<input required className="form-control" type="month" value={month} onChange={e => setMonth(e.target.value)}/></label>
      <label>Số công (ngày) *<input className="form-control" inputMode="decimal" placeholder="VD: 23.3 hoặc 23,3" value={workUnits} onChange={e => setWorkUnits(e.target.value)}/></label>
      <label>Tăng ca (giờ)<input className="form-control" type="number" min="0" value={overtime} onChange={e => setOvertime(e.target.value)}/></label>
      <label>Thưởng (VNĐ)<input className="form-control" inputMode="numeric" placeholder="0" value={bonus} onChange={e => setBonus(e.target.value)}/></label>
    </div>
    {success && <div className="success-text">{success}</div>}{error && <div className="error-text">{error}</div>}
    <button className="btn-main" disabled={busy} onClick={save}>{busy ? 'ĐANG LƯU…' : 'XÁC NHẬN CHẤM CÔNG'}</button>
  </div>
}

// ---------- Nhập ứng ----------
function AdvancesFeature({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const advances = useQuery({ queryKey: ['salary-advances'], queryFn: () => api<any[]>('/salary-advances').then(r => r.data) })
  async function save(e: FormEvent) {
    e.preventDefault(); setError('')
    const value = Number(amount)
    if (!employeeId) return setError('Vui lòng chọn nhân viên.')
    if (!Number.isFinite(value) || value <= 0) return setError('Số tiền ứng phải lớn hơn 0.')
    setBusy(true)
    try {
      await api('/salary-advances', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { advance_date: date, employee_id: employeeId, amount: value, note: reason.trim() || null } })
      setAmount(''); setReason(''); qc.invalidateQueries({ queryKey: ['salary-advances'] })
    } catch (caught) { setError(message(caught)) } finally { setBusy(false) }
  }
  return <div className="hr-layout">
    <form className="card material-action" onSubmit={save}><h2 className="section-title">Nhập ứng</h2>
      <label>Nhân viên *<select required className="form-control" value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Gõ tìm tên nhân viên...</option>{employees.map(row => <option key={row.id} value={row.id}>{row.full_name}</option>)}</select></label>
      <label>Ngày ứng *<input required className="form-control" type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
      <label>Số tiền ứng (VNĐ) *<input required className="form-control" inputMode="numeric" placeholder="VD: 500000" value={amount} onChange={e => setAmount(e.target.value)}/></label>
      <label>Lý do<input className="form-control" placeholder="VD: Mua sữa cho con..." value={reason} onChange={e => setReason(e.target.value)}/></label>
      {error && <div className="error-text">{error}</div>}<button className="btn-main" disabled={busy}>{busy ? 'ĐANG LƯU…' : 'XÁC NHẬN CHO ỨNG'}</button>
    </form>
    <div className="card"><h2 className="section-title">Danh sách đã ứng</h2>
      <div className="advance-table"><div className="advance-head"><span>Tên NV</span><span>Ngày ứng</span><span>Số tiền</span><span>Lý do</span></div>
        {advances.data?.map(row => <div className="advance-row" key={row.id}><span>{row.employee_name}</span><span>{formatDate(row.advance_date)}</span><strong>{formatMoney(row.amount)}</strong><span>{row.note || 'Không ghi'}</span></div>)}
      </div>
    </div>
  </div>
}

// ---------- Chỉnh sửa ----------
function EditFeature({ employees }: { employees: Employee[] }) {
  const [tab, setTab] = useState<'rate' | 'attendance' | 'advance'>('rate')
  return <div className="card"><div className="tabs"><button className={tab === 'rate' ? 'active' : ''} onClick={() => setTab('rate')}>Đổi Giá</button><button className={tab === 'attendance' ? 'active' : ''} onClick={() => setTab('attendance')}>Sửa Công</button><button className={tab === 'advance' ? 'active' : ''} onClick={() => setTab('advance')}>Sửa Ứng</button></div>{tab === 'rate' && <RateEdit employees={employees}/>}{tab === 'attendance' && <AttendanceEdit employees={employees}/>}{tab === 'advance' && <AdvanceEdit employees={employees}/>}</div>
}

function RateEdit({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(todayIso())
  const [rate, setRate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const history = useQuery({ queryKey: ['rate-history', employeeId], enabled: !!employeeId, queryFn: () => api<RateHistory[]>(`/employees/${employeeId}/rate-history`).then(r => r.data) })
  async function save() {
    setError('')
    const value = Number(rate)
    if (!employeeId) return setError('Vui lòng chọn nhân viên.')
    if (!Number.isFinite(value) || value < 0) return setError('Giá công không hợp lệ.')
    setBusy(true)
    try {
      await api(`/employees/${employeeId}/rate-history`, { method: 'POST', body: { effective_date: effectiveDate, new_daily_rate_amount: value, reason: reason.trim() || null } })
      setRate(''); setReason(''); qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['rate-history', employeeId] })
    } catch (caught) { setError(message(caught)) } finally { setBusy(false) }
  }
  return <div className="hr-form-grid">
    <label>Nhân viên *<select className="form-control" value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Chọn nhân viên...</option>{employees.map(row => <option key={row.id} value={row.id}>{row.full_name}</option>)}</select></label>
    <label>Ngày bắt đầu áp dụng *<input className="form-control" type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)}/></label>
    <label>Giá công mới (VNĐ/ngày) *<input className="form-control" inputMode="numeric" placeholder="VD: 300000" value={rate} onChange={e => setRate(e.target.value)}/></label>
    <label>Lý do<input className="form-control" placeholder="VD: Làm tốt, tăng lương" value={reason} onChange={e => setReason(e.target.value)}/></label>
    {error && <div className="error-text">{error}</div>}
    <button className="btn-main" disabled={busy} onClick={save}>LƯU GIÁ MỚI</button>
    {history.data && history.data.length > 0 && <div className="hr-history"><b>Lịch sử giá công</b>{history.data.map(row => <div key={row.id}><span>{formatDate(row.effective_date)}</span><span>{formatMoney(row.old_daily_rate_amount)} → {formatMoney(row.new_daily_rate_amount)}</span><small>{row.reason || ''}</small></div>)}</div>}
  </div>
}

function AttendanceEdit({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [month, setMonth] = useState(currentMonth())
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [busy, setBusy] = useState(false)
  const attendance = useQuery({ queryKey: ['attendance-month', employeeId, month], enabled: !!employeeId, queryFn: () => api<any[]>(`/attendance?month=${month}&employee_id=${employeeId}`).then(r => r.data) })
  const [units, setUnits] = useState(''); const [overtime, setOvertime] = useState('0'); const [bonus, setBonus] = useState('')
  const record = attendance.data?.[0]
  async function save() {
    setError(''); setSuccess('')
    const u = parseWorkUnits(units)
    if (!employeeId) return setError('Vui lòng chọn nhân viên.')
    if (u === null) return setError('Số công không hợp lệ.')
    setBusy(true)
    try {
      await api('/attendance', { method: 'PUT', body: { records: [{ work_date: `${month}-01`, employee_id: employeeId, shift: 'MONTH', work_units: u, overtime_hours: Number(overtime || 0), bonus_amount: Number(bonus || 0), notes: null }] } })
      setSuccess('Đã sửa công.'); qc.invalidateQueries({ queryKey: ['attendance-month', employeeId, month] })
    } catch (caught) { setError(message(caught)) } finally { setBusy(false) }
  }
  return <div className="hr-form-grid">
    <label>Nhân viên<select className="form-control" value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Chọn nhân viên...</option>{employees.map(row => <option key={row.id} value={row.id}>{row.full_name}</option>)}</select></label>
    <label>Tháng<input className="form-control" type="month" value={month} onChange={e => setMonth(e.target.value)}/></label>
    {record && <div className="hr-current"><b>Đang lưu:</b> {record.work_units} công · {record.overtime_hours} giờ TC · thưởng {formatMoney(record.bonus_amount || 0)}</div>}
    <label>Số công<input className="form-control" placeholder="VD: 23.3" value={units} onChange={e => setUnits(e.target.value)}/></label>
    <label>Tăng ca<input className="form-control" type="number" min="0" value={overtime} onChange={e => setOvertime(e.target.value)}/></label>
    <label>Thưởng<input className="form-control" inputMode="numeric" placeholder="0" value={bonus} onChange={e => setBonus(e.target.value)}/></label>
    {success && <div className="success-text">{success}</div>}{error && <div className="error-text">{error}</div>}
    <button className="btn-main" disabled={busy} onClick={save}>LƯU SỬA CÔNG</button>
  </div>
}

function AdvanceEdit({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const advances = useQuery({ queryKey: ['salary-advances'], queryFn: () => api<any[]>('/salary-advances').then(r => r.data) })
  async function update(row: any, patch: any) {
    setError(''); setBusy(true)
    try { await api(`/salary-advances/${row.id}`, { method: 'PATCH', body: patch }); qc.invalidateQueries({ queryKey: ['salary-advances'] }) } catch (caught) { setError(message(caught)) } finally { setBusy(false) }
  }
  const rows = employeeId ? (advances.data ?? []).filter((row: any) => row.employee_id === employeeId) : (advances.data ?? [])
  return <div className="hr-form-grid">
    <label>Nhân viên<select className="form-control" value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Tất cả nhân viên</option>{employees.map(row => <option key={row.id} value={row.id}>{row.full_name}</option>)}</select></label>
    {error && <div className="error-text">{error}</div>}
    <div className="advance-table"><div className="advance-head"><span>Tên NV</span><span>Ngày</span><span>Số tiền</span><span>Trạng thái</span><span/></div>
      {rows.map(row => <div className="advance-row" key={row.id}><span>{row.employee_name}</span><span>{formatDate(row.advance_date)}</span><strong>{formatMoney(row.amount)}</strong><span>{row.status}</span>{row.status === 'APPROVED' && <button className="btn-outline" disabled={busy} onClick={() => update(row, { status: 'CANCELLED' })}>Hủy</button>}</div>)}
    </div>
  </div>
}

// ---------- Báo cáo ----------
function ReportFeature({ employees }: { employees: Employee[] }) {
  const [tab, setTab] = useState<'personal' | 'summary' | 'payroll'>('personal')
  const [employeeId, setEmployeeId] = useState('')
  const [from, setFrom] = useState(currentMonth())
  const [to, setTo] = useState(currentMonth())
  const [submit, setSubmit] = useState(false)
  const personal = useQuery({
    queryKey: ['hr-personal', employeeId, from, to], enabled: submit && tab === 'personal' && !!employeeId,
    queryFn: () => api<HrPersonalReport>('/reports/personal', { query: { employee_id: employeeId, from_month: `${from}-01`, to_month: `${to}-01` } }).then(r => r.data),
  })
  const summary = useQuery({
    queryKey: ['hr-summary', from, to], enabled: submit && tab === 'summary',
    queryFn: () => api<HrSummaryReport>('/reports/summary', { query: { from_month: `${from}-01`, to_month: `${to}-01` } }).then(r => r.data),
  })
  return <div className="card"><div className="tabs"><button className={tab === 'personal' ? 'active' : ''} onClick={() => { setTab('personal'); setSubmit(false) }}>Cá Nhân</button><button className={tab === 'summary' ? 'active' : ''} onClick={() => { setTab('summary'); setSubmit(false) }}>Tổng Quát</button><button className={tab === 'payroll' ? 'active' : ''} onClick={() => setTab('payroll')}>Bảng lương</button></div>
    {tab === 'payroll' ? <PayrollFeature/> : <><div className="hr-report-filter">
      {tab === 'personal' && <label>Tên nhân viên *<select className="form-control" value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Chọn nhân viên...</option>{employees.map(row => <option key={row.id} value={row.id}>{row.full_name}</option>)}</select></label>}
      <label>Từ tháng<input className="form-control" type="month" value={from} onChange={e => setFrom(e.target.value)}/></label>
      <label>Đến tháng<input className="form-control" type="month" value={to} onChange={e => setTo(e.target.value)}/></label>
      <button className="btn-main" onClick={() => setSubmit(true)}>XEM BÁO CÁO</button>
    </div>
    {tab === 'personal' && personal.data && <PersonalReport data={personal.data}/>}
    {tab === 'summary' && summary.data && <SummaryReport data={summary.data}/>}</>}
  </div>
}

function PayrollFeature() {
  const { user } = useAuth(); const qc = useQueryClient(); const [month, setMonth] = useState(currentMonth()); const [error, setError] = useState('')
  const runs = useQuery({ queryKey: ['payroll-runs'], queryFn: () => api<PayrollRun[]>('/payroll-runs').then(r => r.data) })
  async function create() { setError(''); try { await api('/payroll-runs', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { period_month: `${month}-01` } }); qc.invalidateQueries({ queryKey: ['payroll-runs'] }) } catch (caught) { setError(message(caught)) } }
  async function approve(run: PayrollRun) { setError(''); try { await api(`/payroll-runs/${run.id}/approve`, { method: 'POST', body: { version: run.version } }); qc.invalidateQueries({ queryKey: ['payroll-runs'] }) } catch (caught) { setError(message(caught)) } }
  return <><div className="card payroll-create"><label>Tháng lương<input className="form-control" type="month" value={month} onChange={e => setMonth(e.target.value)}/></label><button className="btn-main" onClick={create}>TÍNH BẢNG LƯƠNG</button></div>{error && <div className="error-text">{error}</div>}{runs.data?.map(run => <article className="card payroll-run" key={run.id}><header><span><b>{run.payroll_no}</b><small>{run.period_month.slice(0, 7)} · {run.status}</small></span><strong>{formatMoney(run.total_net_amount)}</strong>{run.status === 'DRAFT' && user?.role === 'OWNER' && <button className="btn-outline" onClick={() => approve(run)}>Duyệt & khóa</button>}</header><div className="payroll-lines">{run.lines.map(line => <div key={line.id}><span><b>{line.employee_name}</b><small>{line.work_units} công + {line.overtime_hours} giờ TC</small></span><span>Lương {formatMoney(line.base_amount + line.overtime_amount)}</span><span>Ứng {formatMoney(line.advance_amount)}</span><strong>{formatMoney(line.net_amount)}</strong></div>)}</div></article>)}</>
}

function PersonalReport({ data }: { data: HrPersonalReport }) {
  return <div className="report-metrics"><div className="card"><small>Tổng số công</small><strong>{data.total_work_units}</strong></div><div className="card"><small>Tổng tăng ca</small><strong>{data.total_overtime_hours}h</strong></div><div className="card"><small>Tổng thưởng</small><strong>{formatMoney(data.total_bonus_amount)}</strong></div><div className="card"><small>Tổng tiền ứng</small><strong>{formatMoney(data.total_advance_amount)}</strong></div><div className="card"><small>Lương dự kiến</small><strong>{formatMoney(data.gross_amount)}</strong></div><div className="card"><small>Còn lại</small><strong>{formatMoney(data.net_amount)}</strong></div>
    <div className="card report-table"><h3>Chi tiết theo tháng</h3>{data.months.map(row => <div key={row.month}><span><b>{row.month}</b><small>{row.work_units} công · {row.overtime_hours}h TC · thưởng {formatMoney(row.bonus_amount)}</small></span><span>Ứng {formatMoney(row.advance_amount)}</span></div>)}</div>
  </div>
}

function SummaryReport({ data }: { data: HrSummaryReport }) {
  return <div className="report-metrics"><div className="card"><small>Tổng nhân viên</small><strong>{data.employee_count}</strong></div><div className="card"><small>Tổng ngày công</small><strong>{data.total_work_units}</strong></div><div className="card"><small>Tổng tăng ca</small><strong>{data.total_overtime_hours}h</strong></div><div className="card"><small>Tổng thưởng</small><strong>{formatMoney(data.total_bonus_amount)}</strong></div><div className="card"><small>Tổng ứng</small><strong>{formatMoney(data.total_advance_amount)}</strong></div><div className="card"><small>Tổng lương dự kiến</small><strong>{formatMoney(data.total_gross_amount)}</strong></div>
    <div className="card report-table"><h3>Danh sách nhân viên</h3>{data.employees.map(row => <div key={row.employee_id}><span><b>{row.employee_name}</b><small>{row.employee_code}</small></span><span>{row.total_work_units} công</span><strong>{formatMoney(row.net_amount)}</strong></div>)}</div>
  </div>
}

// ---------- DS nhân viên ----------
function EmployeesFeature() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN' || (user?.permissions ?? []).includes('hr.manage')
  const [q, setQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [rateEmployee, setRateEmployee] = useState<string | null>(null)
  const [error, setError] = useState('')
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => api<Employee[]>('/employees').then(r => r.data) })
  const filtered = useMemo(() => { const needle = q.trim().toLowerCase(); return (employees.data ?? []).filter(row => !needle || row.full_name.toLowerCase().includes(needle) || row.employee_code.toLowerCase().includes(needle)) }, [employees.data, q])

  async function toggleActive(row: Employee) {
    if (!window.confirm(`Cho nghỉ nhân viên "${row.full_name}"?`)) return
    setError('')
    try { await api(`/employees/${row.id}`, { method: 'PATCH', body: { status: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } }); qc.invalidateQueries({ queryKey: ['employees'] }) } catch (caught) { setError(message(caught)) }
  }

  return <div>
    <div className="customer-tools"><input className="form-control search" placeholder="Tìm nhân viên..." value={q} onChange={e => setQ(e.target.value)}/>{canManage && <button className="btn-outline" onClick={() => { setShowForm(v => !v); setEditing(null) }}>Thêm nhân viên</button>}</div>
    {error && <div className="error-text">{error}</div>}
    {(showForm || editing) && <EmployeeForm editing={editing} onDone={() => { setShowForm(false); setEditing(null); qc.invalidateQueries({ queryKey: ['employees'] }) }}/>}
    <div className="employee-list">{filtered.map(row => <div className="card employee-card" key={row.id}>
      <div className="employee-avatar">{row.full_name.charAt(0)}</div>
      <div className="employee-info"><b>{row.full_name}</b><small>{row.employee_code} · {row.position} · {row.phone || 'Chưa có SĐT'}</small><small>Vào: {formatDate(row.start_date)}</small></div>
      <strong>{formatMoney(row.daily_rate_amount)}/ngày</strong>
      <span className={`type-badge ${row.status === 'ACTIVE' ? 'badge-tan-xuan' : 'badge-khach-dat'}`}>{row.status === 'ACTIVE' ? 'Đang làm' : 'Đã nghỉ'}</span>
      {canManage && <button className="btn-outline" onClick={() => setEditing(row)}>Sửa</button>}
      <button className="btn-outline" onClick={() => setRateEmployee(rateEmployee === row.id ? null : row.id)}>LS Lương</button>
      {canManage && <button className="btn-outline" onClick={() => toggleActive(row)}>{row.status === 'ACTIVE' ? 'Cho nghỉ' : 'Kích hoạt'}</button>}
      {rateEmployee === row.id && <RateHistoryPanel employeeId={row.id}/>}
    </div>)}</div>
  </div>
}

function EmployeeForm({ editing, onDone }: { editing: Employee | null; onDone: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ code: editing?.employee_code ?? '', name: editing?.full_name ?? '', position: editing?.position ?? 'KHO', rate: String(editing?.daily_rate_amount ?? ''), phone: editing?.phone ?? '' })
  const [error, setError] = useState('')
  async function save(e: FormEvent) {
    e.preventDefault(); setError('')
    try {
      if (editing) {
        await api(`/employees/${editing.id}`, { method: 'PATCH', body: { full_name: form.name, phone: form.phone || null, position: form.position, notes: null } })
      } else {
        await api('/employees', { method: 'POST', body: { employee_code: form.code, full_name: form.name, phone: form.phone || null, position: form.position, daily_rate_amount: Number(form.rate || 0), start_date: todayIso(), notes: null, user_id: null } })
      }
      onDone(); qc.invalidateQueries({ queryKey: ['employees'] })
    } catch (caught) { setError(message(caught)) }
  }
  return <form className="card material-action" onSubmit={save}><h2 className="section-title">{editing ? 'Sửa nhân viên' : 'Thêm nhân viên'}</h2>
    {!editing && <label>Mã nhân viên<input className="form-control" value={form.code} onChange={e => setForm(v => ({ ...v, code: e.target.value }))}/></label>}
    <label>Họ tên *<input required className="form-control" value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))}/></label>
    <label>Vị trí<input className="form-control" value={form.position} onChange={e => setForm(v => ({ ...v, position: e.target.value }))}/></label>
    {!editing && <label>Lương ngày / giá công<input className="form-control" type="number" min="0" value={form.rate} onChange={e => setForm(v => ({ ...v, rate: e.target.value }))}/></label>}
    <label>Số điện thoại<input className="form-control" value={form.phone} onChange={e => setForm(v => ({ ...v, phone: e.target.value }))}/></label>
    {error && <div className="error-text">{error}</div>}
    <div className="action-row"><button className="btn-main">{editing ? 'LƯU THAY ĐỔI' : 'THÊM NHÂN VIÊN'}</button><button type="button" className="btn-outline" onClick={onDone}>Đóng</button></div>
  </form>
}

function RateHistoryPanel({ employeeId }: { employeeId: string }) {
  const history = useQuery({ queryKey: ['rate-history', employeeId], queryFn: () => api<RateHistory[]>(`/employees/${employeeId}/rate-history`).then(r => r.data) })
  return <div className="hr-history">{history.data && history.data.length ? history.data.map(row => <div key={row.id}><span>{formatDate(row.effective_date)}</span><span>{formatMoney(row.old_daily_rate_amount)} → {formatMoney(row.new_daily_rate_amount)}</span><small>{row.reason || ''}</small></div>) : <div className="empty">Chưa có lịch sử đổi giá.</div>}</div>
}

// ---------- Tài khoản ----------
function AccountFeature() {
  const { user } = useAuth()
  return <div className="card account-summary"><h2 className="section-title">Tài khoản</h2>
    <div className="account-rows"><div><span>Username</span><b>{user?.username}</b></div><div><span>Tên hiển thị</span><b>{user?.display_name}</b></div><div><span>Role</span><b>{user?.role}</b></div><div><span>Trạng thái</span><b>{user?.status}</b></div></div>
    <p className="muted">Phân quyền nhân viên và tài khoản được quản lý trong mục <b>Tài khoản / phân quyền</b> ở thanh bên.</p>
  </div>
}

type ReportsTab = 'overview' | 'actions' | 'audit'
type ReportsPeriod = 'today' | '7days' | '30days' | 'this_month' | 'last_month' | 'custom'
const AUDIT_MODULE_OPTIONS = [
  ['ORDER', 'Đơn hàng'], ['CUSTOMER', 'Khách hàng'], ['INVOICE', 'Hóa đơn'],
  ['PAYMENT', 'Thanh toán'], ['DEBT', 'Công nợ'], ['INVENTORY', 'Kho'],
  ['MEDIA', 'Hình ảnh / File'], ['PRODUCTION', 'QL Rập'], ['WORKSHOP', 'Nhà may'],
  ['CUTTING', 'Thợ cắt'], ['MATERIALS', 'Phụ liệu'], ['HR', 'Nhân sự'],
  ['ADMIN', 'Tài khoản'], ['AUTH', 'Đăng nhập'], ['SYSTEM', 'Hệ thống'],
] as const
const AUDIT_ACTION_OPTIONS = [
  ['CREATE', 'Tạo mới'], ['UPDATE', 'Cập nhật'], ['DELETE', 'Xóa'],
  ['CLOSE', 'Chốt hóa đơn'], ['PAYMENT', 'Thanh toán'], ['SALARY_ADVANCE', 'Ứng tiền'],
  ['RECEIPT', 'Nhập kho'],
] as const

function addIsoDays(value: string, amount: number) {
  const day = new Date(`${value}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + amount)
  return day.toISOString().slice(0, 10)
}

function lastMonthRange(today: string) {
  const [year, month] = today.slice(0, 7).split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 2, 1))
  const last = new Date(Date.UTC(year, month - 1, 0))
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)] as const
}

function formatAuditTimestamp(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function ReportsPage({ onBack, onOpenOrders }: { onBack: () => void; onOpenOrders: () => void }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<ReportsTab>('overview')
  const [periodPreset, setPeriodPreset] = useState<ReportsPeriod>('today')
  const [fromDate, setFromDate] = useState(todayIso())
  const [toDate, setToDate] = useState(todayIso())
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null)
  const [auditActorId, setAuditActorId] = useState('')
  const [auditModule, setAuditModule] = useState('')
  const [auditAction, setAuditAction] = useState('')
  const [auditSearch, setAuditSearch] = useState('')
  const canViewAudit = Boolean(user?.permissions.includes('reports.audit'))
  const dateQuery = { from_date: fromDate, to_date: toDate }
  const overview = useQuery({
    queryKey: ['reports', 'overview', fromDate, toDate],
    queryFn: () => api<ReportsOverview>('/reports/overview', { query: dateQuery }).then(r => r.data),
  })
  const actionItems = useQuery({
    queryKey: ['reports', 'action-items', fromDate, toDate],
    enabled: tab === 'actions',
    queryFn: () => api<{ count: number; items: ReportActionItem[] }>('/reports/action-items', { query: dateQuery }).then(r => r.data),
  })
  const audits = useQuery({
    queryKey: ['reports', 'audit', fromDate, toDate, auditActorId, auditModule, auditAction, auditSearch],
    enabled: tab === 'audit' && canViewAudit,
    queryFn: () => api<AuditLogRow[]>('/audit-logs', { query: {
      ...dateQuery,
      actor_user_id: auditActorId || undefined,
      module: auditModule || undefined,
      action: auditAction || undefined,
      q: auditSearch.trim() || undefined,
    } }).then(r => r.data),
  })
  const auditActors = useQuery({
    queryKey: ['reports', 'audit-actors', fromDate, toDate],
    enabled: tab === 'audit' && canViewAudit,
    queryFn: () => api<AuditLogRow[]>('/audit-logs', { query: { ...dateQuery, limit: '500' } }).then(r => r.data),
  })
  const auditDetail = useQuery({
    queryKey: ['reports', 'audit-detail', selectedAuditId],
    enabled: tab === 'audit' && canViewAudit && Boolean(selectedAuditId),
    queryFn: () => api<AuditLogRow>(`/audit-logs/${selectedAuditId}`).then(r => r.data),
  })

  function applyPreset(next: Exclude<ReportsPeriod, 'custom'>) {
    const today = todayIso()
    let range: readonly [string, string] = [today, today]
    if (next === '7days') range = [addIsoDays(today, -6), today]
    if (next === '30days') range = [addIsoDays(today, -29), today]
    if (next === 'this_month') range = [`${today.slice(0, 7)}-01`, today]
    if (next === 'last_month') range = lastMonthRange(today)
    setPeriodPreset(next)
    setFromDate(range[0])
    setToDate(range[1])
  }

  function updateFromDate(value: string) {
    if (!value) return
    setPeriodPreset('custom')
    setFromDate(value)
  }

  function updateToDate(value: string) {
    if (!value) return
    setPeriodPreset('custom')
    setToDate(value)
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['reports'] })
  }

  function showAuditError() {
    return 'Không thể tải nhật ký thao tác.'
  }

  const cash = overview.data?.cashflow
  const orderMetrics = overview.data?.orders
  const financialCards = [
    ['Doanh thu hóa đơn', cash?.invoice_revenue],
    ['Tiền vào', cash?.money_in],
    ['Tiền ra', cash?.money_out],
    ['Dòng tiền thuần', cash?.net_cashflow],
    ['Công nợ tổng', cash?.total_debt],
  ] as const
  const orderCards = orderMetrics ? [
    ['Tổng số đơn', orderMetrics.total_orders],
    ['Đơn mới', orderMetrics.new_orders],
    ['Đang soạn', orderMetrics.picking_orders],
    ['Đã soạn', orderMetrics.picked_orders],
    ['HĐ chưa gửi', orderMetrics.invoice_pending],
    ['Nợ đơn', orderMetrics.debt_orders],
    ['Hủy', orderMetrics.cancelled_orders],
  ] as const : []

  return <section className="page reports-page">
    <div className="reports-title-row">
      <button className="btn-outline" onClick={onBack}><i className="bi bi-arrow-left"/> Quay lại</button>
      <h1>BÁO CÁO THỐNG KÊ</h1>
    </div>
    <div className="reports-period card">
      <div className="reports-period-presets" aria-label="Chọn khoảng thời gian">
        {([
          ['today', 'Hôm nay'], ['7days', '7 ngày'], ['30days', '30 ngày'],
          ['this_month', 'Tháng này'], ['last_month', 'Tháng trước'],
        ] as const).map(([value, label]) => <button key={value} className={periodPreset === value ? 'active' : ''} onClick={() => applyPreset(value)}>{label}</button>)}
      </div>
      <label>Từ ngày<input type="date" value={fromDate} onChange={e => updateFromDate(e.target.value)}/></label>
      <label>Đến ngày<input type="date" value={toDate} onChange={e => updateToDate(e.target.value)}/></label>
      <button className="btn-main" onClick={refresh}><i className="bi bi-arrow-clockwise"/> Làm mới</button>
    </div>
    <div className="tabs">
      <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Tổng quan</button>
      <button className={tab === 'actions' ? 'active' : ''} onClick={() => setTab('actions')}>Cần xử lý</button>
      {canViewAudit && <button className={tab === 'audit' ? 'active' : ''} onClick={() => { setTab('audit'); setSelectedAuditId(null) }}>Audit log</button>}
    </div>
    {tab === 'overview' && <div>
      {overview.isLoading ? <div className="report-metrics">{Array.from({ length: 8 }, (_, index) => <div className="card report-skeleton" key={index}/>)}</div>
        : overview.error ? <div className="card report-error"><span>{message(overview.error)}</span><button className="btn-outline" onClick={() => void overview.refetch()}>Thử lại</button></div>
          : <div className="report-overview">
            <div className="report-metrics">
              {financialCards.map(([label, amount]) => <div className="card report-metric" key={label}><small>{label}</small><strong>{cash?.available && amount != null ? formatMoney(amount) : 'Chưa đủ quyền'}</strong></div>)}
              {orderCards.map(([label, count]) => <div className="card report-metric" key={label}><small>{label}</small><strong>{count}</strong><span>Trong khoảng đã chọn</span></div>)}
            </div>
          </div>}
    </div>}
    {tab === 'actions' && <div className="card report-actions">
      {actionItems.isLoading ? <div className="report-skeleton"/> : actionItems.error
        ? <div className="report-error"><span>{message(actionItems.error)}</span><button className="btn-outline" onClick={() => void actionItems.refetch()}>Thử lại</button></div>
        : actionItems.data?.items.length
          ? <><h2>{actionItems.data.count} việc cần xử lý</h2>{actionItems.data.items.map(item => <article className="report-action-row" key={item.id}>
            <div><b>{item.reference} · {item.customer_name}</b><span>{item.description}</span><small>{formatDate(item.occurred_at)} · Cần xử lý</small></div>
            <button className="btn-outline" onClick={onOpenOrders}>Mở danh sách đơn</button>
          </article>)}</>
          : <div className="report-empty">Chưa có dữ liệu trong khoảng thời gian này.</div>}
    </div>}
    {tab === 'audit' && canViewAudit && <div className="report-audit">
      <div className="card report-audit-filters">
        <label>Từ ngày<input type="date" value={fromDate} onChange={e => updateFromDate(e.target.value)}/></label>
        <label>Đến ngày<input type="date" value={toDate} onChange={e => updateToDate(e.target.value)}/></label>
        <label>Người thao tác<select value={auditActorId} onChange={e => setAuditActorId(e.target.value)}>
          <option value="">Tất cả người thao tác</option>
          {(auditActors.data ?? []).filter(row => row.actor_user_id).reduce<AuditLogRow[]>((actors, row) => {
            if (!actors.some(actor => actor.actor_user_id === row.actor_user_id)) actors.push(row)
            return actors
          }, []).map(row => <option key={row.actor_user_id!} value={row.actor_user_id!}>{row.actor_name || 'Không rõ người thao tác'}</option>)}
        </select></label>
        <label>Module<select value={auditModule} onChange={e => setAuditModule(e.target.value)}>
          <option value="">Tất cả module</option>
          {AUDIT_MODULE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Hành động<select value={auditAction} onChange={e => setAuditAction(e.target.value)}>
          <option value="">Tất cả hành động</option>
          {AUDIT_ACTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="report-audit-search">Tìm mã đơn / khách / mâm / chứng từ<input value={auditSearch} onChange={e => setAuditSearch(e.target.value)} placeholder="Nhập mã hoặc nội dung"/></label>
      </div>
      <div className="card report-audit-list">
        <div className="report-audit-columns"><span>Thời gian</span><span>Người thao tác</span><span>Module</span><span>Hành động</span><span>Đối tượng / mã liên quan</span><span>Mô tả</span><span>Chi tiết</span></div>
        {audits.isLoading ? <div className="report-skeleton"/> : audits.error
          ? <div className="report-error"><span>{showAuditError()}</span><button className="btn-outline" onClick={() => void audits.refetch()}>Thử lại</button></div>
          : audits.data?.length
            ? audits.data.map(row => <article className="report-audit-row" key={row.id}>
              <time>{formatAuditTimestamp(row.occurred_at)}</time>
              <span>{row.actor_name || 'Không rõ người thao tác'}</span>
              <span>{row.module_label}</span>
              <span>{row.action_label}</span>
              <span>{row.entity_label} · {row.entity_code || row.entity_id}</span>
              <span>{row.description_vi}</span>
              <button className="btn-outline" onClick={() => setSelectedAuditId(row.id)}>Xem</button>
            </article>)
            : <div className="report-empty">Chưa có nhật ký thao tác.</div>}
      </div>
      {selectedAuditId && <div className="report-audit-modal" role="presentation" onClick={() => setSelectedAuditId(null)}>
        <section className="card report-audit-detail" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title" onClick={event => event.stopPropagation()}>
          <header><h2 id="audit-detail-title">Chi tiết nhật ký thao tác</h2><button className="btn-outline" onClick={() => setSelectedAuditId(null)}>Đóng</button></header>
          {auditDetail.isLoading ? <div className="report-skeleton"/> : auditDetail.error
            ? <div className="report-error"><span>{showAuditError()}</span><button className="btn-outline" onClick={() => void auditDetail.refetch()}>Thử lại</button></div>
            : auditDetail.data && <><dl className="report-audit-metadata">
              <div><dt>Thời gian</dt><dd>{formatAuditTimestamp(auditDetail.data.occurred_at)}</dd></div>
              <div><dt>Người thao tác</dt><dd>{auditDetail.data.actor_name || 'Không rõ người thao tác'}</dd></div>
              <div><dt>Module</dt><dd>{auditDetail.data.module_label}</dd></div>
              <div><dt>Hành động</dt><dd>{auditDetail.data.action_label}</dd></div>
              <div><dt>Đối tượng</dt><dd>{auditDetail.data.entity_label}</dd></div>
              <div><dt>Mã liên quan</dt><dd>{auditDetail.data.entity_code || auditDetail.data.entity_id}</dd></div>
              <div><dt>Mô tả</dt><dd>{auditDetail.data.description_vi}</dd></div>
            </dl>
            <h3>Dữ liệu trước</h3><pre>{auditDetail.data.before == null ? 'Chưa có dữ liệu' : JSON.stringify(auditDetail.data.before, null, 2)}</pre>
            <h3>Dữ liệu sau</h3><pre>{auditDetail.data.after == null ? 'Chưa có dữ liệu' : JSON.stringify(auditDetail.data.after, null, 2)}</pre>
            <details><summary>Thông tin kỹ thuật</summary><pre>{JSON.stringify({
              action: auditDetail.data.action,
              module: auditDetail.data.module,
              entity_type: auditDetail.data.entity_type,
              entity_id: auditDetail.data.entity_id,
              request_id: auditDetail.data.request_id,
            }, null, 2)}</pre></details>
          </>}
        </section>
      </div>}
    </div>}
  </section>
}
