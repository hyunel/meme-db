declare module 'gifenc' {
  type Palette = number[][]
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: 'rgb565' | 'rgb444' }): Palette
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette): Uint8Array
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts: { palette: Palette; delay: number; transparent: boolean; transparentIndex: number; dispose: number },
    ): void
    finish(): void
    bytesView(): Uint8Array<ArrayBuffer>
  }
}
