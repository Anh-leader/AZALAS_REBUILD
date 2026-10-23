import { api, tokenStore, apiUrl} from './client'

export type UploadedMedia = { id: string; view_url: string; url: string; content_type: string }

export async function uploadMediaFile(file: File, module: string): Promise<UploadedMedia> {
  const form = new FormData()
  form.append('file', file)
  const response = await api<UploadedMedia>('/media/upload', {
    method: 'POST',
    query: { module },
    body: form,
  })
  return response.data
}

export async function authenticatedMediaFetch(url: string): Promise<Response> {
  const request = () => {
    const headers = new Headers()
    const token = tokenStore.get()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const targetUrl = /^https?:\/\//i.test(url) ? url : apiUrl(url)
return fetch(targetUrl, { headers })
  }

  let response = await request()
  if (response.status === 401 && tokenStore.getRefresh()) {
    const refreshed = await fetch(apiUrl('/api/v1/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokenStore.getRefresh() }),
    })
    if (refreshed.ok) {
      const payload = await refreshed.json()
      tokenStore.set(payload.data.access_token)
      tokenStore.setRefresh(payload.data.refresh_token)
      response = await request()
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      tokenStore.clear()
      window.dispatchEvent(new Event('azalas:logout'))
    }
    throw new Error(`Media request failed (${response.status})`)
  }
  return response
}

export async function openAuthenticatedMedia(url: string): Promise<void> {
  // Direct signed/public URL: open it straight in a new tab, no fetch/blob.
  if (/^https?:\/\//i.test(url)) {
    const win = window.open(url, '_blank', 'noopener,noreferrer')
    if (!win) throw new Error('Popup was blocked')
    return
  }
  const popup = window.open('about:blank', '_blank')
  if (!popup) throw new Error('Popup was blocked')
  popup.opener = null
  try {
    const response = await authenticatedMediaFetch(url)
    const objectUrl = URL.createObjectURL(await response.blob())
    popup.location.href = objectUrl
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  } catch (error) {
    popup.close()
    throw error
  }
}

export async function downloadAuthenticatedMedia(url: string, filename: string): Promise<void> {
  // Direct signed/public URL: cross-origin `download` won't force a save, so
  // open in a new tab (the browser renders the image; the user can save).
  if (/^https?:\/\//i.test(url)) {
    const win = window.open(url, '_blank', 'noopener,noreferrer')
    if (!win) throw new Error('Popup was blocked')
    return
  }
  const response = await authenticatedMediaFetch(url)
  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
}
