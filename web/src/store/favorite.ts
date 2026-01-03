import { create } from 'zustand'

interface FavoriteState {
  overrides: Record<string, boolean>
  setFavorite: (id: string, status: boolean) => void
  setFavorites: (items: { id: string, favorite: boolean }[]) => void
  removeOverride: (id: string) => void
  clear: () => void
}

export const useFavoriteStore = create<FavoriteState>((set) => ({
  overrides: {},
  setFavorite: (id, status) => set((state) => ({
    overrides: { ...state.overrides, [id]: status }
  })),
  setFavorites: (items) => set((state) => {
    const newOverrides = { ...state.overrides }
    items.forEach(({ id, favorite }) => {
      newOverrides[id] = favorite
    })
    return { overrides: newOverrides }
  }),
  removeOverride: (id) => set((state) => {
    const newOverrides = { ...state.overrides }
    delete newOverrides[id]
    return { overrides: newOverrides }
  }),
  clear: () => set({ overrides: {} }),
}))
