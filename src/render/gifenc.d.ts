declare module 'gifenc' {
  interface GIFFrameOptions {
    palette?: number[][] | Uint8Array | number[];
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    repeat?: number;
    dispose?: number;
    first?: boolean;
  }

  interface GIFEncoderInstance {
    writeFrame(
      index: Uint8Array | Uint8ClampedArray,
      width: number,
      height: number,
      options?: GIFFrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  type Format = 'rgba4444' | 'rgba444' | 'rgb444' | 'rgb565' | 'rgb';

  interface GifencModule {
    GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GIFEncoderInstance;
    quantize(
      rgba: Uint8Array | Uint8ClampedArray,
      maxColors: number,
      options?: { format?: Format; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number; oneBitAlpha?: boolean | number },
    ): number[][];
    applyPalette(
      rgba: Uint8Array | Uint8ClampedArray,
      palette: number[][],
      format?: Format,
    ): Uint8Array;
  }

  const gifenc: GifencModule;
  export default gifenc;
}
