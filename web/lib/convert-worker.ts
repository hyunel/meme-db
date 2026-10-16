// Converts a meme to PNG, JPG or GIF off the page's thread. Videos only decode in the page, which seeks them frame by frame on request.
import { applyPalette, GIFEncoder, quantize } from 'gifenc'
import { animationOf } from './animated-image'
import type { ConvertOptions } from './meme-transfer'

export type ConvertSource = { image: Blob } | { lottie: string | ArrayBuffer } | { video: { width: number; height: number; duration: number } }
export type ConvertJob = { format: 'png' | 'jpg' | 'gif'; options: ConvertOptions; source: ConvertSource }

/** An animation, or a still as its one frame. Frames are drawn in order, each scaled to w×h; draw returns how long the frame shows, in ms. */
type Frames = {
  width: number
  height: number
  count: number
  /** In ms */
  duration: number
  draw: (i: number, ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) => Promise<number>
}

const FRAMES = 150 // Videos and Lottie are sampled at most this many times for a GIF, sparser over a longer one
const BUDGET = 512 * 512 * FRAMES // Pixels over all a GIF's frames, beyond which it is scaled down to keep encoding quick
const wasmUrl = new URL('@lottiefiles/dotlottie-web/dotlottie-player.wasm', import.meta.url).href

let onFrame: ((frame: ImageBitmap) => void) | undefined

self.onmessage = ({ data }: MessageEvent<ConvertJob | { frame: ImageBitmap }>) => {
  if ('frame' in data) return onFrame?.(data.frame)
  convert(data).then(
    (blob) => postMessage({ blob }),
    (err) => {
      console.error(err)
      postMessage({ error: true })
    },
  )
}

async function convert({ format, options: { quality, fps, speed, scale }, source }: ConvertJob) {
  const rate = format === 'gif' ? fps / speed : 0 // Samples per second of the source, or 0 for a still of its first frame
  const frames =
    'lottie' in source
      ? await lottieFrames(source.lottie, rate)
      : 'video' in source
        ? videoFrames(source.video, rate)
        : await imageFrames(source.image, rate)
  const fit = rate ? Math.sqrt(BUDGET / (frames.width * frames.height * frames.count)) : 1
  const k = Math.min(scale, fit)
  const [w, h] = [Math.max(1, Math.round(frames.width * k)), Math.max(1, Math.round(frames.height * k))]
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: !!rate })!

  if (!rate) {
    await frames.draw(0, ctx, w, h)
    if (format === 'jpg') {
      // White shows through what was transparent
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
    }
    return canvas.convertToBlob({ type: format === 'jpg' ? 'image/jpeg' : 'image/png', quality: quality / 100 })
  }

  const gif = GIFEncoder()
  let [elapsed, written] = [0, 0] // In ms, and in the centiseconds GIF delays take, which follow it without drifting
  const write = (rgba: Uint8ClampedArray, delay: number) => {
    elapsed += delay
    const cs = Math.max(2, Math.round(elapsed / 10) - written) // Players hold a shorter frame for a tenth of a second
    written += cs
    // Leaves an index for transparency, which GIF has only fully on or off. Coarse colors quantize several times faster, and no worse once
    // pixels map to the palette at full precision.
    const palette = quantize(rgba, 255, { format: 'rgb444' })
    const index = applyPalette(rgba, palette)
    for (let p = 0; p < index.length; p++) if (rgba[p * 4 + 3] < 128) index[p] = palette.length
    // Each frame clears what it covers before the next is drawn, so frames don't show through each other's transparency
    gif.writeFrame(index, w, h, { palette: [...palette, [0, 0, 0]], delay: cs * 10, transparent: true, transparentIndex: palette.length, dispose: 2 })
  }
  let last: Uint8ClampedArray | undefined
  let [lastDelay, lastAt, time] = [0, 0, 0] // In ms of the GIF
  // A grid at the frame rate holds a frame a slot; at the animation's own rate where slower, so its uneven delays don't lose frames. Slots
  // start a quarter early, so frames on a grid line or halfway between two don't straddle a slot's edge.
  const grid = Math.min(fps, (frames.count * speed * 1000) / frames.duration)
  const slot = (t: number) => Math.floor((t * grid) / 1000 + 0.25)
  for (let i = 0; i < frames.count; i++) {
    ctx.clearRect(0, 0, w, h)
    const delay = (await frames.draw(i, ctx, w, h)) / speed
    // A frame in the last one's slot, or repeating it, lengthens it instead.
    const data = last && slot(time) <= slot(lastAt) ? last : ctx.getImageData(0, 0, w, h).data
    if (last && (data === last || same(last, data))) lastDelay += delay
    else {
      if (last) write(last, lastDelay)
      ;[last, lastDelay, lastAt] = [data, delay, time]
    }
    time += delay
    postMessage({ progress: (i + 1) / frames.count })
  }
  write(last!, lastDelay)
  gif.finish()
  return new Blob([gif.bytesView()], { type: 'image/gif' })
}

function same(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  const [x, y] = [new Uint32Array(a.buffer), new Uint32Array(b.buffer)]
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}

async function lottieFrames(data: string | ArrayBuffer, rate: number): Promise<Frames> {
  const { DotLottie } = await import('@lottiefiles/dotlottie-web')
  DotLottie.setWasmUrl(wasmUrl)
  const surface = { width: 1, height: 1 } // Renders into the player's own pixel buffer, sized once the animation's size is known
  const player = new DotLottie({ canvas: surface, data })
  await new Promise((resolve, reject) => {
    player.addEventListener('load', resolve)
    player.addEventListener('loadError', reject)
  })
  const { duration, totalFrames } = player
  const count = rate ? Math.max(1, Math.round(Math.min(totalFrames, duration * rate, FRAMES))) : 1
  return {
    ...player.animationSize(),
    count,
    duration: duration * 1000,
    async draw(i, ctx, w, h) {
      if (surface.width !== w || surface.height !== h) {
        Object.assign(surface, { width: w, height: h })
        player.resize()
      }
      player.setFrame((i * totalFrames) / count)
      ctx.putImageData(new ImageData(new Uint8ClampedArray(player.buffer!), w, h), 0, 0)
      return (duration * 1000) / count
    },
  }
}

function videoFrames({ width, height, duration }: { width: number; height: number; duration: number }, rate: number): Frames {
  const count = rate ? Math.max(1, Math.round(Math.min(duration * rate, FRAMES))) : 1
  const request = (i: number) =>
    new Promise<ImageBitmap>((resolve) => {
      onFrame = resolve
      postMessage({ seek: (i * duration) / count })
    })
  let next: Promise<ImageBitmap> | undefined
  return {
    width,
    height,
    count,
    duration: duration * 1000,
    async draw(i, ctx, w, h) {
      const frame = await (next ?? request(i))
      next = i + 1 < count ? request(i + 1) : undefined // The page seeks the next frame while this one encodes
      ctx.drawImage(frame, 0, 0, w, h)
      frame.close()
      return (duration * 1000) / count
    },
  }
}

async function imageFrames(blob: Blob, rate: number): Promise<Frames> {
  const animation = rate ? await animationOf(blob) : undefined
  if (!animation) {
    const bitmap = await createImageBitmap(blob)
    return { width: bitmap.width, height: bitmap.height, count: 1, duration: 0, draw: async (_, ctx, w, h) => (ctx.drawImage(bitmap, 0, 0, w, h), 0) }
  }
  // Frames build on one another over the whole animation's area, as a browser plays them.
  const { width, height, frames } = animation
  const canvas = new OffscreenCanvas(width, height)
  const stage = canvas.getContext('2d')!
  let dispose = () => {}
  return {
    width,
    height,
    count: frames.length,
    duration: frames.reduce((t, f) => t + f.delay, 0),
    async draw(i, ctx, w, h) {
      const { x, y, width, height, delay, blend, image } = frames[i]
      dispose()
      const before = frames[i].dispose === 'previous' ? stage.getImageData(x, y, width, height) : undefined
      const bitmap = await createImageBitmap(image)
      if (!blend) stage.clearRect(x, y, width, height)
      stage.drawImage(bitmap, x, y)
      bitmap.close()
      ctx.drawImage(canvas, 0, 0, w, h)
      dispose = () => {
        if (before) stage.putImageData(before, x, y)
        else if (frames[i].dispose === 'background') stage.clearRect(x, y, width, height)
      }
      return delay
    },
  }
}
