import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/** The site's origin for API examples, with a placeholder while rendering on the server. */
export const useOrigin = () => useSyncExternalStore(subscribe, () => window.location.origin, () => 'https://memedb.example')
