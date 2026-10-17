import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'

export type PendingOrderImage = {
  key: string
  file: File
  preview: string
  source: 'file' | 'clipboard'
  fingerprint?: string
  mediaId?: string
  error?: string
  uploading?: boolean
}

type ClipboardData = {
  items: ArrayLike<Pick<DataTransferItem, 'kind' | 'type' | 'getAsFile'>>
  files: ArrayLike<File>
}

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_SIZE = 10 * 1024 * 1024

export function collectClipboardImageFiles(data: ClipboardData | null, timestamp: Date): { files: File[]; unsupported: boolean } {
  if (!data) return { files: [], unsupported: false }
  const candidates: File[] = []
  let unsupported = false
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) candidates.push(file)
    else if (item.type.startsWith('image/')) unsupported = true
  }
  candidates.push(...Array.from(data.files))

  const seen = new Set<string>()
  const seenUnnamed = new WeakSet<File>()
  const files: File[] = []
  for (const candidate of candidates) {
    if (!ACCEPTED_IMAGE_TYPES.has(candidate.type)) {
      if (candidate.type.startsWith('image/')) unsupported = true
      continue
    }
    const generatedClipboardName = /^clipboard-\d{8}-\d{6}-\d+\./.test(candidate.name)
    if (candidate.name && !generatedClipboardName) {
      const identity = `${candidate.name}|${candidate.size}|${candidate.type}|${candidate.lastModified}`
      if (seen.has(identity)) continue
      seen.add(identity)
    } else {
      if (seenUnnamed.has(candidate)) continue
      seenUnnamed.add(candidate)
    }
    if (!candidate.name) {
      const extension = candidate.type === 'image/jpeg' ? 'jpg' : candidate.type.slice('image/'.length)
      const stamp = [
        timestamp.getFullYear(),
        String(timestamp.getMonth() + 1).padStart(2, '0'),
        String(timestamp.getDate()).padStart(2, '0'),
        '-',
        String(timestamp.getHours()).padStart(2, '0'),
        String(timestamp.getMinutes()).padStart(2, '0'),
        String(timestamp.getSeconds()).padStart(2, '0'),
      ].join('')
      files.push(new File([candidate], `clipboard-${stamp}-${files.length + 1}.${extension}`, {
        type: candidate.type,
        lastModified: candidate.lastModified,
      }))
    } else {
      files.push(candidate)
    }
  }
  return { files, unsupported }
}

export async function fingerprintOrderImage(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193)
    second = Math.imul(second ^ byte, 0x85ebca6b)
  }
  return `blob:${file.size}|${file.type}|${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`
}

export function validOrderImage(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.has(file.type) && file.size > 0 && file.size <= MAX_IMAGE_SIZE
}

export function limitOrderImageBatch(files: File[], currentCount: number): { accepted: File[]; invalid: boolean; overLimit: boolean } {
  const valid = files.filter(validOrderImage)
  const room = Math.max(0, 20 - currentCount)
  return {
    accepted: valid.slice(0, room),
    invalid: valid.length !== files.length,
    overLimit: valid.length > room,
  }
}

export function OrderImagePasteArea({
  images,
  onAdd,
  onRemove,
  disabled = false,
}: {
  images: PendingOrderImage[]
  onAdd: (files: File[], source: PendingOrderImage['source'], fingerprints: string[]) => void
  onRemove: (key: string) => void
  disabled?: boolean
}) {
  const [notice, setNotice] = useState('')
  const [active, setActive] = useState(false)
  const pendingFingerprints = useRef(new Set<string>())

  async function addFiles(files: File[], source: PendingOrderImage['source'], unsupported = false) {
    if (disabled) return
    const valid = files.filter(validOrderImage)
    const fingerprints = await Promise.all(valid.map(file => fingerprintOrderImage(file)))
    const known = new Set(await Promise.all(images.map(image => image.fingerprint
      ? Promise.resolve(image.fingerprint)
      : fingerprintOrderImage(image.file))))
    const uniqueFiles: File[] = []
    const uniqueFingerprints: string[] = []
    let duplicates = 0
    fingerprints.forEach((fingerprint, index) => {
      if (known.has(fingerprint) || pendingFingerprints.current.has(fingerprint)) {
        duplicates += 1
        return
      }
      pendingFingerprints.current.add(fingerprint)
      uniqueFiles.push(valid[index])
      uniqueFingerprints.push(fingerprint)
    })
    const result = limitOrderImageBatch(uniqueFiles, images.length)
    const acceptedFingerprints = uniqueFingerprints.slice(0, result.accepted.length)
    const acceptedSet = new Set(acceptedFingerprints)
    uniqueFingerprints.forEach(fingerprint => {
      if (!acceptedSet.has(fingerprint)) pendingFingerprints.current.delete(fingerprint)
    })
    const invalid = unsupported || result.invalid || valid.length !== files.length
    if (result.accepted.length) {
      onAdd(result.accepted, source, acceptedFingerprints)
      window.setTimeout(() => acceptedFingerprints.forEach(fingerprint => pendingFingerprints.current.delete(fingerprint)), 0)
    }
    if (!result.accepted.length) {
      if (duplicates) setNotice('Ảnh đã có trong đơn nên được bỏ qua.')
      else if (result.overLimit) setNotice('Tối đa 20 ảnh.')
      else if (invalid) setNotice('Ảnh không hợp lệ. Chỉ hỗ trợ JPEG, PNG, WEBP, tối đa 10 MB mỗi ảnh.')
      else setNotice(source === 'clipboard' ? 'Clipboard không có ảnh để dán.' : 'Không có tệp ảnh để thêm.')
      return
    }
    if (result.overLimit) setNotice(`Đã thêm ${result.accepted.length} ảnh${source === 'clipboard' ? ' từ clipboard' : ''}. Tối đa 20 ảnh.`)
    else if (duplicates) setNotice(`Đã thêm ${result.accepted.length} ảnh; ảnh trùng đã được bỏ qua.`)
    else if (invalid) setNotice(`Đã thêm ${result.accepted.length} ảnh${source === 'clipboard' ? ' từ clipboard' : ''}. Ảnh không hợp lệ đã bị bỏ qua.`)
    else if (source === 'clipboard') setNotice(`Đã thêm ${result.accepted.length} ảnh từ clipboard.`)
    else setNotice(`Đã thêm ${result.accepted.length} ảnh.`)
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    const result = collectClipboardImageFiles(event.clipboardData, new Date())
    void addFiles(result.files, 'clipboard', result.unsupported)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setActive(false)
    void addFiles(Array.from(event.dataTransfer.files), 'file')
  }

  return <div className="order-image-paste">
    <label className="upload-picker"><i className="bi bi-images"/> Chọn ảnh JPEG/PNG/WEBP
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => {
        void addFiles(Array.from(event.target.files ?? []), 'file')
        event.target.value = ''
      }} disabled={disabled || images.length >= 20}/>
    </label>
    <div
      className={`order-image-paste-zone${active ? ' active' : ''}`}
      tabIndex={disabled ? -1 : 0}
      role="button"
      aria-disabled={disabled}
      aria-label="Vùng dán ảnh đơn hàng"
      onPaste={onPaste}
      onDragEnter={event => { event.preventDefault(); if (!disabled) setActive(true) }}
      onDragOver={event => { event.preventDefault(); if (!disabled) setActive(true) }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false) }}
      onDrop={onDrop}
      onClick={event => event.currentTarget.focus()}
    >
      <i className="bi bi-clipboard-plus"/>
      <b>Tải lên / Chụp / Copy dán (Ctrl + V)</b>
      <span>Bấm vào đây rồi nhấn Ctrl + V để dán ảnh từ Zalo hoặc ảnh chụp màn hình.</span>
    </div>
    <small className="order-image-paste-count">Đã chọn {images.length} ảnh.</small>
    {notice && <small className="order-image-paste-notice" role="status">{notice}</small>}
    {images.length > 0 && <div className="upload-grid">
      {images.map(image => <div className={`upload-preview ${image.error ? 'failed' : ''}`} key={image.key}>
        <OrderImagePreview image={image}/>
        <button type="button" aria-label="Xóa ảnh" disabled={disabled} onClick={() => onRemove(image.key)}>×</button>
        <small title={image.file.name}>
          {image.uploading ? 'Đang tải…' : image.error ? image.error : image.mediaId ? 'Đã tải lên' : image.file.name || 'Ảnh dán từ clipboard'}
          {' · '}{(image.file.size / (1024 * 1024)).toFixed(2)} MB
        </small>
      </div>)}
    </div>}
  </div>
}

function OrderImagePreview({ image }: { image: PendingOrderImage }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <div className="upload-preview-placeholder">Ảnh lỗi</div>
  return <img src={image.preview} alt={image.file.name || 'Ảnh dán từ clipboard'} onError={() => setFailed(true)}/>
}
