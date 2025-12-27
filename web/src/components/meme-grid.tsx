"use client"

import type React from "react"
import { Masonry } from "./masonry"
import { MemeCard } from "./meme-card"
import type { Meme } from "@/lib/api"

interface MemeGridProps {
  items: Meme[]
  renderItem?: (item: Meme, index: number) => React.ReactNode
  fixedHeight?: boolean
  className?: string
}

export function MemeGrid({ items, renderItem, fixedHeight = false, className }: MemeGridProps) {
  if (fixedHeight) {
    return (
      <div
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
      >
        {items.map((meme, index) => (
          renderItem ? renderItem(meme, index) : (
            <MemeCard
              key={meme.asset_id || (meme as any).id}
              meme={meme}
              fixedHeight={true}
              index={index}
            />
          )
        ))}
      </div>
    )
  }

  return (
    <Masonry
      breakpoints={[
        [1536, 6],
        [1280, 5],
        [1024, 4],
        [768, 3],
        [640, 2],
      ]}
      className="flex -ml-3 w-auto"
      columnClassName="pl-3 bg-clip-padding"
      items={items}
      renderItem={(meme, index) => (
        renderItem ? renderItem(meme, index) : (
          <MemeCard
            key={meme.asset_id || (meme as any).id}
            meme={meme}
            fixedHeight={false}
            index={index}
            className="mb-3"
          />
        )
      )}
    />
  )
}
