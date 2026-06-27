/**
 * Incremental MJPEG (multipart/x-mixed-replace) demuxer for the agent's MJPEG publisher (Stage 2A).
 *
 * WDA's local MJPEG server emits a stream of JPEG frames. Rather than parse multipart boundaries
 * (whose exact token varies by WDA build), we extract each JPEG by its byte markers: SOI (FF D8) …
 * EOI (FF D9). Robust for screen JPEGs (no embedded thumbnails). Bytes arrive in arbitrary chunks; a
 * frame that straddles chunks is buffered until its EOI lands. Pure + side-effect-free → unit-testable.
 */
const SOI = Buffer.from([0xff, 0xd8]) // JPEG start-of-image
const EOI = Buffer.from([0xff, 0xd9]) // JPEG end-of-image

export class MjpegDemux {
  private buf: Buffer = Buffer.alloc(0)

  constructor(private readonly onFrame: (jpeg: Buffer) => void) {}

  /** Feed a chunk of stream bytes; emits onFrame() for every complete JPEG found. */
  push(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk)
    for (;;) {
      const soi = this.buf.indexOf(SOI)
      if (soi < 0) {
        // No frame start yet — keep only a trailing byte (an SOI could straddle the next chunk).
        if (this.buf.length > 1) this.buf = Buffer.from(this.buf.subarray(this.buf.length - 1))
        return
      }
      const eoi = this.buf.indexOf(EOI, soi + 2)
      if (eoi < 0) {
        // Have the start but not the end — drop anything before SOI, wait for more bytes.
        if (soi > 0) this.buf = Buffer.from(this.buf.subarray(soi))
        return
      }
      this.onFrame(Buffer.from(this.buf.subarray(soi, eoi + 2)))
      this.buf = Buffer.from(this.buf.subarray(eoi + 2))
    }
  }

  /** Bytes currently buffered (for tests/diagnostics). */
  get pending(): number { return this.buf.length }
}
