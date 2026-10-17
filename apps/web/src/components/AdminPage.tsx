import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type User } from '../api/client'
import { PERMISSION_GROUPS, permissionDescription, permissionLabel, roleLabel } from '../lib/permissions'

type Role = { id: string; code: string; name: string; description: string | null; is_system: boolean; permissions: string[] }
type Permission = { id: string; code: string; module: string; action: string }
function message(error: unknown) { return error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.' }

export function AdminPage() {
  const [tab, setTab] = useState<'users' | 'roles' | 'password'>('users')
  return <section className="page admin-page"><h1>Tài khoản / phân quyền</h1><div className="tabs"><button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Tài khoản</button><button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Vai trò & quyền</button><button className={tab === 'password' ? 'active' : ''} onClick={() => setTab('password')}>Đổi mật khẩu</button></div>{tab === 'users' && <Users/>}{tab === 'roles' && <Roles/>}{tab === 'password' && <ChangePassword/>}</section>
}

function Users() {
  const qc = useQueryClient(); const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api<User[]>('/users').then(r => r.data) }); const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles').then(r => r.data) })
  const [form, setForm] = useState({ username: '', password: '', display_name: '', role: 'MEMBER' }); const [error, setError] = useState('')
  async function create(event: FormEvent) { event.preventDefault(); setError(''); try { await api('/users', { method: 'POST', body: { username: form.username, password: form.password, display_name: form.display_name, phone: null, role_codes: [form.role] } }); setForm({ username: '', password: '', display_name: '', role: 'MEMBER' }); qc.invalidateQueries({ queryKey: ['admin-users'] }) } catch (caught) { setError(message(caught)) } }
  async function setRole(user: User, role: string) { setError(''); try { await api(`/users/${user.id}/roles`, { method: 'PUT', body: { role_codes: [role] } }); qc.invalidateQueries({ queryKey: ['admin-users'] }) } catch (caught) { setError(message(caught)) } }
  async function toggle(user: User) { setError(''); try { await api(`/users/${user.id}`, { method: 'PATCH', body: { status: user.status === 'ACTIVE' ? 'LOCKED' : 'ACTIVE' } }); qc.invalidateQueries({ queryKey: ['admin-users'] }) } catch (caught) { setError(message(caught)) } }
  return <div className="admin-layout"><form className="card material-action" onSubmit={create}><h2 className="section-title">Tạo tài khoản</h2><label>Tên đăng nhập<input required className="form-control" value={form.username} onChange={e => setForm(v => ({ ...v, username: e.target.value }))}/></label><label>Họ tên<input required className="form-control" value={form.display_name} onChange={e => setForm(v => ({ ...v, display_name: e.target.value }))}/></label><label>Mật khẩu tạm<input required className="form-control" type="password" minLength={8} value={form.password} onChange={e => setForm(v => ({ ...v, password: e.target.value }))}/></label><label>Vai trò<select className="form-control" value={form.role} onChange={e => setForm(v => ({ ...v, role: e.target.value }))}>{roles.data?.map(role => <option key={role.id} value={role.code}>{roleLabel(role.code, role.name)}</option>)}</select></label>{error && <div className="error-text">{error}</div>}<button className="btn-main">TẠO TÀI KHOẢN</button></form><div className="card"><h2 className="section-title">Tài khoản hiện có</h2>{users.data?.map(user => <div className="admin-user" key={user.id}><span><b>{user.display_name}</b><small>{user.username} · {user.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}</small></span><select className="form-control" value={user.role} onChange={e => setRole(user, e.target.value)}>{roles.data?.map(role => <option key={role.id} value={role.code}>{roleLabel(role.code, role.name)}</option>)}</select><button className="btn-outline" onClick={() => toggle(user)}>{user.status === 'ACTIVE' ? 'Khóa' : 'Mở'}</button></div>)}</div></div>
}

function Roles() {
  const qc = useQueryClient(); const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles').then(r => r.data) }); const permissions = useQuery({ queryKey: ['permissions'], queryFn: () => api<Permission[]>('/permissions').then(r => r.data) }); const [selected, setSelected] = useState<Role | null>(null); const [error, setError] = useState('')
  async function toggle(code: string) { if (!selected) return; const values = selected.permissions.includes(code) ? selected.permissions.filter(item => item !== code) : [...selected.permissions, code]; setSelected({ ...selected, permissions: values }) }
  async function save() { if (!selected) return; setError(''); try { const response = await api<Role>(`/roles/${selected.id}`, { method: 'PATCH', body: { permission_codes: selected.permissions } }); setSelected(response.data); qc.invalidateQueries({ queryKey: ['roles'] }) } catch (caught) { setError(message(caught)) } }
  const permissionMap = new Map((permissions.data ?? []).map(p => [p.code, p]))
  const groupedCodes = PERMISSION_GROUPS.flatMap(g => g.codes)
  const extraCodes = (permissions.data ?? []).map(p => p.code).filter(code => !groupedCodes.includes(code))
  const sections = [...PERMISSION_GROUPS.map(g => ({ title: g.title, codes: g.codes.filter(code => permissionMap.has(code)) })), ...(extraCodes.length ? [{ title: 'Khác', codes: extraCodes }] : [])].filter(s => s.codes.length)
  return <div className="role-layout"><div className="card role-list">{roles.data?.map(role => <button key={role.id} className={selected?.id === role.id ? 'active' : ''} onClick={() => setSelected(role)}><b>{roleLabel(role.code, role.name)}</b><span>{role.description || 'Vai trò hệ thống'}</span><small>{role.permissions.length} quyền</small></button>)}</div><div className="card"><h2 className="section-title">{selected ? `Quyền của ${roleLabel(selected.code, selected.name)}` : 'Chọn vai trò'}</h2>{selected && <><div className="permission-groups">{sections.map(section => <div className="permission-group" key={section.title}><h3 className="permission-group-title">{section.title}</h3><div className="permission-grid">{section.codes.map(code => <label key={code} title={code}><input type="checkbox" checked={selected.permissions.includes(code)} onChange={() => toggle(code)}/><span><b>{permissionLabel(code)}</b><small>{permissionDescription(code)}</small></span></label>)}</div></div>)}</div>{error && <div className="error-text">{error}</div>}<button className="btn-main" onClick={save}>LƯU PHÂN QUYỀN</button></>}</div></div>
}

function ChangePassword() {
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState(''); const [status, setStatus] = useState(''); const [error, setError] = useState('')
  async function save(event: FormEvent) { event.preventDefault(); setError(''); setStatus(''); if (next !== confirm) return setError('Mật khẩu xác nhận không khớp.'); try { await api('/auth/change-password', { method: 'POST', body: { current_password: current, new_password: next } }); setStatus('Đã đổi mật khẩu. Các phiên làm mới cũ đã bị thu hồi.'); setCurrent(''); setNext(''); setConfirm('') } catch (caught) { setError(message(caught)) } }
  return <form className="card material-action password-form" onSubmit={save}><h2 className="section-title">Đổi mật khẩu của tôi</h2><label>Mật khẩu hiện tại<input required className="form-control" type="password" value={current} onChange={e => setCurrent(e.target.value)}/></label><label>Mật khẩu mới<input required className="form-control" type="password" minLength={8} value={next} onChange={e => setNext(e.target.value)}/></label><label>Xác nhận<input required className="form-control" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}/></label>{status && <div className="success-text">{status}</div>}{error && <div className="error-text">{error}</div>}<button className="btn-main">ĐỔI MẬT KHẨU</button></form>
}

export function AccountPage() {
  return <section className="page admin-page"><h1>Tài khoản của tôi</h1><ChangePassword/></section>
}
