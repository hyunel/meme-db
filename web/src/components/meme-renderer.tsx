"use client"

import { cn } from "@/lib/utils"
import type { Meme } from "@/lib/api"
import { useEffect, useState } from "react"
import Lottie from "lottie-react";
import { loadLottieData } from "@/lib/meme"

interface MemeRendererProps {
  meme?: Meme
  className?: string
}

export function MemeRenderer({ meme, className }: MemeRendererProps) {
  const extension = meme?.extension?.toLowerCase()
  const isVideo = extension === ".webm" || extension === ".mp4"
  const isLottie = extension === ".json" || extension === ".lottie" || extension === ".tgs"
  const [lottieData, setLottieData] = useState<any>(null)

  const placeholder = (
    <img
      src="/placeholder.svg"
      alt="placeholder"
      className={cn("object-cover bg-checkered", className)}
      width={meme?.width}
      height={meme?.height}
    />
  )

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function loadLottie() {
      if (!meme) return;

      try {
        const json = await loadLottieData(meme, controller.signal);
        if (mounted && json) {
          setLottieData(json);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.error("Failed to load lottie animation:", error);
      }
    }

    if (isLottie) {
      loadLottie();
    }

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [meme, extension, isLottie]);

  if (!meme?.url) {
    return placeholder
  }

  if (isVideo) {
    return (
      <video
        src={meme?.url}
        className={cn("w-full h-full object-cover bg-checkered", className)}
        autoPlay
        muted
        loop
        playsInline
      />
    )
  }

  if (isLottie) {
    return lottieData ? (
      <div className={cn("bg-checkered", className)}>
        <Lottie animationData={lottieData} loop autoplay className="w-full h-full" />
      </div>
    ) : (
      placeholder
    )
  }

  return (
    <img
      src={meme.url}
      alt=""
      className={cn("object-cover bg-checkered", className)}
    />
  )
}
