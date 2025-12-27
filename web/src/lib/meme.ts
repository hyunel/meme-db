import type { Meme } from "@/lib/api";
import { toast } from "sonner";
import React from "react";
import { ConversionProgress } from "@/components/conversion-progress";

export async function shareMeme(meme: Meme) {
  if (typeof navigator === "undefined" || !navigator.share) {
    toast.error("Sharing is not supported in this browser");
    return;
  }

  const filename = `meme-${meme.asset_id}.${meme.extension}`;
  const response = await fetch(meme.url);
  const blob = await response.blob();
  const file = new File([blob], filename, { type: meme.mime_type });

  const shareData = {
    files: [file],
    title: "MemeDB",
  };

  if (navigator.canShare && navigator.canShare(shareData)) {
    await navigator.share(shareData);
  } else {
    await navigator.share({
      title: "MemeDB",
      url: meme.url,
    });
  }
}

async function fetchWithSignal(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
  return response;
}

export async function loadLottieData(meme: Meme, signal?: AbortSignal) {
  const extension = meme.extension?.toLowerCase();
  const response = await fetchWithSignal(meme.url, signal);

  if (extension === ".tgs") {
    if (!response.body) return null;
    const decompressedStream = response.body.pipeThrough(new DecompressionStream("gzip"));
    const blob = await new Response(decompressedStream).blob();
    return JSON.parse(await blob.text());
  }

  if (extension === ".json" || extension === ".lottie") {
    return await response.json();
  }

  return null;
}

export const DOWNLOAD_FORMATS = ["original", "png", "jpg", "gif"] as const;
export type DownloadFormat = (typeof DOWNLOAD_FORMATS)[number];

const MAX_ANIMATION_FRAMES = 100;

export async function downloadMeme(meme: Meme, format: DownloadFormat = 'original') {
  const filename = `meme-${meme.asset_id}`;

  let toastId: string | number | undefined;

  const updateProgress = (progress: number) => {
    if (toastId === undefined) {
      toastId = toast.custom(
        () => React.createElement(ConversionProgress, { progress }),
        { duration: Infinity }
      );
    } else {
      toast.custom(
        () => React.createElement(ConversionProgress, { progress }),
        { id: toastId, duration: Infinity }
      );
    }
  };

  if (format === 'original') {
    const response = await fetch(meme.url);
    const blob = await response.blob();
    triggerDownload(blob, `${filename}${meme.extension}`);
    return;
  }

  try {
    let blob: Blob | null = null;
    if (format === 'png' || format === 'jpg') {
      blob = await convertToStaticImage(meme, format);
    } else if (format === 'gif') {
      blob = await convertToGif(meme, updateProgress);
    }

    if (toastId) toast.dismiss(toastId);

    if (blob) {
      triggerDownload(blob, `${filename}.${format}`);
    } else {
      throw new Error(`Failed to convert to ${format}`);
    }
  } catch (error) {
    if (toastId) toast.dismiss(toastId);
    toast.error("Conversion failed");
    throw error;
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function createHiddenContainer(width: number, height: number) {
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: `${width}px`,
    height: `${height}px`,
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
    overflow: "hidden",
  });
  document.body.appendChild(container);
  return container;
}

interface RenderOptions {
  onFrame: (canvas: HTMLCanvasElement, delay?: number) => void;
  onFinish: () => void;
  onProgress?: (progress: number) => void;
  isStatic?: boolean;
}

async function processMeme(meme: Meme, { onFrame, onFinish, onProgress, isStatic }: RenderOptions) {
  const extension = meme.extension.toLowerCase();
  const isLottie = [".json", ".lottie", ".tgs"].includes(extension);
  const isVideo = [".webm", ".mp4"].includes(extension);

  const canvas = document.createElement("canvas");
  canvas.width = meme.width;
  canvas.height = meme.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return onFinish();

  if (isLottie) {
    const lottieData = await loadLottieData(meme);
    if (!lottieData) return onFinish();

    const lottie = (await import("lottie-web")).default;
    const container = createHiddenContainer(meme.width, meme.height);
    const animation = lottie.loadAnimation({
      container,
      renderer: "canvas",
      loop: false,
      autoplay: false,
      animationData: lottieData,
      rendererSettings: { clearCanvas: true },
    });

    animation.addEventListener("DOMLoaded", () => {
      setTimeout(() => {
        const lottieCanvas = container.querySelector("canvas");
        if (!lottieCanvas) return onFinish();

        const frameRate = animation.frameRate;
        const totalFrames = isStatic ? 1 : Math.min(Math.floor(animation.totalFrames), MAX_ANIMATION_FRAMES);
        const step = isStatic ? 1 : Math.max(1, Math.floor(animation.totalFrames / MAX_ANIMATION_FRAMES));

        for (let i = 0; i < totalFrames; i++) {
          animation.goToAndStop(i * step, true);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(lottieCanvas, 0, 0, canvas.width, canvas.height);
          onFrame(canvas, (1000 / frameRate) * step);
          onProgress?.(Math.round(((i + 1) / totalFrames) * 100));
        }

        animation.destroy();
        document.body.removeChild(container);
        onFinish();
      }, 100);
    });
    animation.addEventListener("error", () => {
      document.body.removeChild(container);
      onFinish();
    });
  } else if (isVideo) {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.src = meme.url;
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      if (isStatic) {
        video.onseeked = () => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          onFrame(canvas);
          onFinish();
        };
        video.currentTime = 0;
      } else {
        const fps = 20;
        const totalFrames = Math.min(video.duration * fps, MAX_ANIMATION_FRAMES);
        const interval = video.duration / totalFrames;
        let currentFrame = 0;

        video.onseeked = () => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          onFrame(canvas, (video.duration * 1000) / totalFrames);
          onProgress?.(Math.round(((currentFrame + 1) / totalFrames) * 100));
          if (++currentFrame < totalFrames) {
            video.currentTime = currentFrame * interval;
          } else {
            onFinish();
          }
        };
        video.currentTime = 0;
      }
    };
  } else {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = meme.url;
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      onFrame(canvas);
      onFinish();
    };
    img.onerror = () => onFinish();
  }
}

async function convertToStaticImage(meme: Meme, format: "png" | "jpg"): Promise<Blob | null> {
  const extension = meme.extension.toLowerCase();
  if (extension === `.${format}`) {
    return fetch(meme.url).then((r) => r.blob());
  }

  return new Promise((resolve) => {
    let result: Blob | null = null;
    processMeme(meme, {
      isStatic: true,
      onFrame: (canvas) => {
        canvas.toBlob((blob) => (result = blob), `image/${format === "jpg" ? "jpeg" : "png"}`);
      },
      onFinish: () => resolve(result),
    });
  });
}

async function convertToGif(meme: Meme, onProgress?: (progress: number) => void): Promise<Blob | null> {
  if (meme.extension.toLowerCase() === ".gif") {
    return fetch(meme.url).then((r) => r.blob());
  }

  const [GIF, worker] = await Promise.all([
    import("gif.js").then((m) => m.default),
    import("gif.js/dist/gif.worker.js").then((m) => m.default),
  ]);

  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: meme.width,
    height: meme.height,
    workerScript: worker,
    transparent: "#00000000",
  });

  return new Promise((resolve) => {
    processMeme(meme, {
      onProgress: (p) => onProgress?.(p * 0.5), // Extraction is first 50%
      onFrame: (canvas, delay) => gif.addFrame(canvas, { copy: true, delay }),
      onFinish: () => {
        gif.on("progress", (p: number) => onProgress?.(50 + p * 50)); // Rendering is second 50%
        gif.on("finished", resolve);
        gif.render();
      },
    });
  });
}
