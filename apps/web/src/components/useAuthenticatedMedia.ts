import { useEffect, useState } from 'react'
import { authenticatedMediaFetch } from '../api/media'

type MediaSource = { source: string | null; failed: boolean }

export function useAuthenticatedMedia(url: string): MediaSource {
  const [state, setState] = useState<MediaSource>({ source: null, failed: false })

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setState({ source: null, failed: false })

    const load = url.startsWith('blob:')
      ? Promise.resolve(url)
      : authenticatedMediaFetch(url).then(async response => URL.createObjectURL(await response.blob()))

    load.then(source => {
      objectUrl = source.startsWith('blob:') && !url.startsWith('blob:') ? source : null
      if (active) setState({ source, failed: false })
      else if (objectUrl) URL.revokeObjectURL(objectUrl)
    }).catch(() => {
      if (active) setState({ source: null, failed: true })
    })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  return state
}
