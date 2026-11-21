'use client'

import { useCallback } from 'react'
import { useSearchParams } from 'next/navigation'

export function useEnumParam<T extends string>(name: string, values: readonly T[], defaultValue: NoInfer<T>) {
  const param = useSearchParams().get(name)
  const value = values.find((value) => value === param) ?? defaultValue
  const setValue = useCallback((value: T) => {
    // Read the current URL so controls cannot overwrite each other's changes.
    const url = new URL(window.location.href)
    const param = value === defaultValue ? null : value
    if (url.searchParams.get(name) === param) return

    if (param === null) url.searchParams.delete(name)
    else url.searchParams.set(name, param)
    window.history.replaceState(null, '', url)
  }, [name, defaultValue])

  return [value, setValue] as const
}
