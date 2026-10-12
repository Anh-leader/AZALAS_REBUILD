import { useState } from 'react'
import { ZipperPage } from './ZipperPage'
import { EmbroideryPage } from './EmbroideryPage'
import { PrintingPartnerPage, type PrintingPartnerKey } from './PrintingPartnerPage'
import { FabricPage } from './FabricPage'

type View = 'overview' | 'zipper' | 'embroidery' | 'printing-nhat' | 'printing-tung' | 'fabric'

const CARDS: Array<{ view: Exclude<View, 'overview'>; code: string; label: string; sub: string; icon: string }> = [
  { view: 'zipper', code: 'DÂY KÉO', label: 'Dây kéo', sub: 'Nhập hàng và công nợ theo tháng', icon: 'bi-box-seam' },
  { view: 'embroidery', code: 'THÊU', label: 'Thêu', sub: 'Chốt tháng, ứng và thanh toán', icon: 'bi-brush' },
  { view: 'printing-nhat', code: 'NHẬT - IN', label: 'Nhật - In', sub: 'Dữ liệu riêng của Nhật', icon: 'bi-printer' },
  { view: 'printing-tung', code: 'TÙNG - IN', label: 'Tùng - In', sub: 'Dữ liệu riêng của Tùng', icon: 'bi-printer-fill' },
  { view: 'fabric', code: 'VẢI', label: 'Vải', sub: 'Nhập vải theo phiếu', icon: 'bi-layers' },
]

export function MaterialsPage() {
  const [view, setView] = useState<View>('overview')
  if (view === 'zipper') return <ZipperPage onBack={() => setView('overview')}/>
  if (view === 'embroidery') return <EmbroideryPage onBack={() => setView('overview')}/>
  if (view === 'printing-nhat' || view === 'printing-tung') {
    const partner: PrintingPartnerKey = view === 'printing-tung' ? 'tung' : 'nhat'
    return <PrintingPartnerPage partner={partner} onBack={() => setView('overview')}/>
  }
  if (view === 'fabric') return <FabricPage onBack={() => setView('overview')}/>
  if (view !== 'overview') {
    const card = CARDS.find(c => c.view === view)!
    return <Placeholder label={card.label} onBack={() => setView('overview')}/>
  }
  return <section className="page materials-page">
    <h1>Quản lý phụ liệu</h1>
    <div className="hr-hero"><div className="hr-hero-icon"><i className="bi bi-box-seam"/></div><div><b>Quản lý phụ liệu</b><small>Chọn nhóm nghiệp vụ để nhập hàng, chốt tháng và theo dõi công nợ.</small></div></div>
    <div className="materials-card-grid">{CARDS.map(card => <button key={card.view} className="card materials-card" onClick={() => setView(card.view)}><i className={`bi ${card.icon}`}/><span><b>{card.code}</b><small>{card.sub}</small></span></button>)}</div>
  </section>
}

function Placeholder({ label, onBack }: { label: string; onBack: () => void }) {
  return <section className="page materials-page">
    <div className="card"><button className="btn-back" onClick={onBack}>← Quay lại Phụ liệu</button><div className="empty">Chức năng {label} chưa được triển khai trong phiên bản này.</div></div>
  </section>
}
