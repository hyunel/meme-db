"use client"

import { useParams } from "next/navigation"
import { Tag as TagIcon } from "lucide-react"
import { MemeGrid } from "@/components/meme-grid"
import { EmptyState } from "@/components/ui/empty-state"
import useSWR from "swr"
import { tagGetMemes } from "@/lib/api"
import TagLoading from "./loading"

export default function TagPage() {
  const params = useParams()

  const {
    data,
    isLoading
  } = useSWR(params.tag ? ['/api/tags' + params.tag, params.tag] : null, async ([, tagId]) => tagGetMemes(tagId as string))

  if (isLoading) {
    return <TagLoading />
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Tag Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <div className="p-4 bg-primary/10 rounded-xl">
            <TagIcon className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold mb-1">#{data?.tag.name}</h1>
            <p className="text-muted-foreground">{data?.memes?.length || 0} memes with this tag</p>
          </div>
        </div>
      </div>

      {data?.memes && data.memes.length > 0 ? (
        <MemeGrid items={data.memes} fixedHeight={true} />
      ) : (
        <EmptyState
          icon={<TagIcon className="w-16 h-16" />}
          title="No memes found"
          description="There are no memes with this tag yet."
        />
      )}
    </div>
  )
}
