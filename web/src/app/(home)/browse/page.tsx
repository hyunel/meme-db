"use client"

import { AuthGuard } from "@/components/auth-guard"
import { FileBrowserProvider } from "@/components/file-browser/file-browser-context"
import { FileBrowserView } from "@/components/file-browser/file-browser-view"

export default function BrowsePage() {
  return (
    <AuthGuard>
      <div className="flex-1 flex flex-col">
        <FileBrowserProvider>
          <FileBrowserView />
        </FileBrowserProvider>
      </div>
    </AuthGuard>
  )
}
