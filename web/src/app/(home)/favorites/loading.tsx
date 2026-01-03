import { Skeleton } from "@/components/ui/skeleton"
import { Heart, FolderOpen } from "lucide-react"

export default function FavoritesLoading() {
    return (
        <div className="container mx-auto px-4 py-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold mb-2">Favorites</h1>
                <p className="text-muted-foreground">Your saved memes and folders</p>
            </div>

            <div className="space-y-6">
                <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-background shadow-sm">
                        <Heart className="w-4 h-4 text-muted-foreground" />
                        <Skeleton className="h-4 w-16" />
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md">
                        <FolderOpen className="w-4 h-4 text-muted-foreground" />
                        <Skeleton className="h-4 w-16" />
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <Skeleton key={i} className="aspect-square rounded-xl" />
                    ))}
                </div>
            </div>
        </div>
    )
}
