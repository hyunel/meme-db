import type React from "react"
import { AppHeader } from "@/components/app-header"

export default function HomeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  )
}
