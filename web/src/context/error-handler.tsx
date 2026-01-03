"use client"

import { useEffect } from "react"
import { ApiError } from "@/lib/api"
import { toast } from "sonner"

export function ErrorHandler({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    console.log("ErrorHandler mounted")
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (event.reason instanceof ApiError) {
        toast.error(event.reason.message)
      }
    }

    window.addEventListener("unhandledrejection", handleUnhandledRejection)

    return () => {
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection
      )
    }
  }, [])

  return <>{children}</>
}