// Splits animated GIF, WebP and APNG, of which browsers decode only the first frame outside an <img>, into frames that decode one by one.

export type AnimationFrame = {
  x: number
  y: number
  width: number
  height: number
  /** In ms */
  delay: number
  /** What becomes of the frame's area before the next frame is drawn */
  dispose: 'none' | 'background' | 'previous'
  /** Whether the frame is drawn over what is below it rather than replacing it */
  blend: boolean
  image: Blob
}

export type Animation = { width: number; height: number; frames: AnimationFrame[] }

type Bytes = Uint8Array<ArrayBuffer>

/** The frames of an animated GIF, WebP or APNG, or undefined for any other image. */
export async function animationOf(blob: Blob): Promise<Animation | undefined> {
  const b = new Uint8Array(await blob.arrayBuffer())
  const tag = (o: number) => String.fromCharCode(...b.subarray(o, o + 4))
  const animation = tag(0) === 'GIF8' ? gif(b) : tag(0) === 'RIFF' && tag(8) === 'WEBP' ? webp(b, tag) : tag(0) === '\x89PNG' ? apng(b, tag) : undefined
  for (const f of animation?.frames ?? []) if (f.delay <= 10) f.delay = 100 // As browsers play frames too short to see
  return animation
}

function gif(b: Bytes): Animation | undefined {
  const u16 = (o: number) => b[o] | (b[o + 1] << 8)
  const colors = (packed: number) => (packed & 0x80 ? 3 << ((packed & 7) + 1) : 0) // Size of the color table a packed field announces
  // The end of the data sub-blocks at o
  const past = (o: number) => {
    while (b[o]) o += b[o] + 1
    return o + 1
  }
  const screen = b.subarray(0, 13 + colors(b[10])) // Header, screen and global colors, which every frame repeats
  const frames: AnimationFrame[] = []
  let control: Bytes | undefined // The graphic control extension of the next image
  for (let o = screen.length; o < b.length; ) {
    if (b[o] === 0x21) {
      if (b[o + 1] === 0xf9) control = b.subarray(o, o + 8)
      o = past(o + 2)
    } else if (b[o] === 0x2c) {
      const [start, x, y, width, height] = [o, u16(o + 1), u16(o + 3), u16(o + 5), u16(o + 7)]
      o = past(o + 11 + colors(b[o + 9]))
      const image = b.slice(start, o)
      image.fill(0, 1, 5) // Each frame decodes alone at its own size, placed when drawn
      const head = screen.slice()
      head.set([width & 255, width >> 8, height & 255, height >> 8], 6)
      frames.push({
        x,
        y,
        width,
        height,
        delay: control ? (control[4] | (control[5] << 8)) * 10 : 0,
        dispose: (['none', 'none', 'background', 'previous'] as const)[control ? (control[3] >> 2) & 7 : 0] ?? 'none',
        blend: true,
        image: new Blob([head, ...(control ? [control] : []), image, new Uint8Array([0x3b])], { type: 'image/gif' }),
      })
      control = undefined
    } else break // The trailer, or data past what can be read
  }
  return frames.length > 1 ? { width: u16(6), height: u16(8), frames } : undefined
}

function webp(b: Bytes, tag: (o: number) => string): Animation | undefined {
  if (tag(12) !== 'VP8X' || !(b[20] & 2)) return // Not flagged as animated
  const view = new DataView(b.buffer, b.byteOffset)
  const u24 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
  const frames: AnimationFrame[] = []
  for (let o = 12, size = 0; o + 8 <= b.length; o += 8 + size + (size & 1)) {
    size = view.getUint32(o + 4, true)
    if (tag(o) !== 'ANMF') continue
    const p = o + 8
    const [width, height, flags, data] = [u24(p + 6) + 1, u24(p + 9) + 1, b[p + 15], b.subarray(p + 16, p + size)]
    // A frame with a separate alpha chunk decodes only in the extended format, which states its size and alpha.
    const vp8x = tag(p + 16) === 'ALPH' ? ['VP8X', le32(10), new Uint8Array([0x10, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)])] : []
    frames.push({
      x: u24(p) * 2,
      y: u24(p + 3) * 2,
      width,
      height,
      delay: u24(p + 12),
      dispose: flags & 1 ? 'background' : 'none',
      blend: !(flags & 2),
      image: new Blob(['RIFF', le32(4 + (vp8x.length ? 18 : 0) + data.length), 'WEBP', ...vp8x, data], { type: 'image/webp' }),
    })
  }
  return frames.length ? { width: u24(24) + 1, height: u24(27) + 1, frames } : undefined
}

function apng(b: Bytes, tag: (o: number) => string): Animation | undefined {
  const view = new DataView(b.buffer, b.byteOffset)
  let ihdr: Bytes | undefined
  let animated = false
  const shared: Bytes[] = [] // Chunks every frame repeats, such as the palette
  const frames: (Omit<AnimationFrame, 'image'> & { data: Bytes[] })[] = []
  for (let o = 8, size = 0; o + 12 <= b.length; o += 12 + size) {
    size = view.getUint32(o)
    const type = tag(o + 4)
    const data = b.subarray(o + 8, o + 8 + size)
    const at = (i: number) => view.getUint32(o + 8 + i)
    if (type === 'IHDR') ihdr = data
    else if (type === 'acTL') animated = true
    else if (type === 'fcTL') {
      const dispose = (['none', 'background', 'previous'] as const)[data[24]] ?? 'none'
      frames.push({
        width: at(4),
        height: at(8),
        x: at(12),
        y: at(16),
        delay: (view.getUint16(o + 28) * 1000) / (view.getUint16(o + 30) || 100),
        dispose: !frames.length && dispose === 'previous' ? 'background' : dispose, // As the format has it for a first frame
        blend: data[25] === 1,
        data: [],
      })
    } else if (type === 'IDAT') frames.at(-1)?.data.push(data) // An image before any frame control is a still that players skip
    else if (type === 'fdAT') frames.at(-1)?.data.push(data.subarray(4))
    else if (type !== 'IEND' && !frames.length) shared.push(b.subarray(o, o + 12 + size))
  }
  if (!animated || !ihdr || !frames.length) return
  const header = ihdr
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    frames: frames.map(({ data, ...f }) => {
      const head = header.slice()
      new DataView(head.buffer).setUint32(0, f.width)
      new DataView(head.buffer).setUint32(4, f.height)
      const parts = [b.subarray(0, 8), pngChunk('IHDR', head), ...shared, ...data.map((d) => pngChunk('IDAT', d)), pngChunk('IEND', new Uint8Array())]
      return { ...f, image: new Blob(parts, { type: 'image/png' }) }
    }),
  }
}

const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255]

function le32(n: number) {
  const view = new DataView(new ArrayBuffer(4))
  view.setUint32(0, n, true)
  return view
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n
})

function pngChunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  let crc = ~0
  for (let i = 4; i < 8 + data.length; i++) crc = crcTable[(crc ^ out[i]) & 255] ^ (crc >>> 8)
  view.setUint32(8 + data.length, ~crc)
  return out
}
