"use client"

import { useParams } from "next/navigation"
import { mockMemes } from "@/lib/mock-data"
import { Tag } from "lucide-react"
import { MemeCard } from "@/components/meme-card"
import { MemeGrid } from "@/components/meme-grid"
import { EmptyState } from "@/components/ui/empty-state"

export default function TagPage() {
  const params = useParams()
  const tag = decodeURIComponent(params.tag as string)

  const taggedMemes = mockMemes.filter((m) => m.tags.includes(tag) && m.isPublic)

  return (
    <div className="container mx-auto px-4 py-8">
        {/* Tag Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-4 bg-primary/10 rounded-xl">
              <Tag className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold mb-1">#{tag}</h1>
              <p className="text-muted-foreground">{taggedMemes.length} memes with this tag</p>
            </div>
          </div>
        </div>

        {/* CHANGE: Use MemeCard component with fixed height */}
        {taggedMemes.length > 0 ? (
          <MemeGrid>
            {taggedMemes.map((meme, index) => (
              <MemeCard key={meme.id} meme={meme} fixedHeight={true} index={index} />
            ))}
          </MemeGrid>
        ) : (
          <EmptyState
            icon={<Tag className="w-16 h-16" />}
            title="No memes found"
            description="There are no memes with this tag yet."
          />
        )}
      </div>
  )
}
