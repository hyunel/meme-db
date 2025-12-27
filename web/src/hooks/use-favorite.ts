import { useSWRConfig } from "swr"
import { favoriteToggle as toggleFavoriteApi } from "@/lib/api"
import { useState } from "react"
import { useFavoriteStore } from "@/store/favorite"

export function useFavorite(targetId: string, targetType: "MEME" | "FOLDER", initialIsFavorite: boolean) {
  const { mutate } = useSWRConfig()
  const [isToggling, setIsToggling] = useState(false)

  // Get optimistic override from global store
  const override = useFavoriteStore((state) => state.overrides[targetId])
  const setFavoriteOverride = useFavoriteStore((state) => state.setFavorite)
  const removeFavoriteOverride = useFavoriteStore((state) => state.removeOverride)

  // Effective status: override wins over server prop
  const isFavorite = override ?? initialIsFavorite

  const toggleFavorite = async () => {
    if (isToggling) return

    setIsToggling(true)
    const next = !isFavorite

    // 1. Optimistic update in global store
    setFavoriteOverride(targetId, next)

    try {
      // 2. Perform the actual API call
      await toggleFavoriteApi([{ id: targetId, type: targetType, favorite: next }])

      // 3. Optional: Invalidate favorites list to ensure it's up to date when the user navigates there
      mutate("/api/favorites")

      return next
    } catch (error) {
      // Revert on error
      removeFavoriteOverride(targetId)
      throw error
    } finally {
      setIsToggling(false)
    }
  }

  return {
    isFavorite,
    isToggling,
    toggleFavorite
  }
}
