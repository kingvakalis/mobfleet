/**
 * MJPEG (multipart/x-mixed-replace) framing for the browser viewer side of the relay. The browser's
 * <img src> renders this stream natively. Pure + dependency-free → unit-testable. The agent→relay hop
 * is binary WSS (one JPEG per message); this is the relay→browser hop.
 */
export const STREAM_BOUNDARY = 'mobfleetframe'

/** The response Content-Type the relay sets on a /stream response. */
export function multipartContentType(): string {
  return `multipart/x-mixed-replace; boundary=${STREAM_BOUNDARY}`
}

/** Wrap one JPEG buffer as a multipart part (boundary + headers + bytes + CRLF). */
export function frameChunk(jpeg: Buffer): Buffer {
  const head = Buffer.from(
    `--${STREAM_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
    'latin1',
  )
  return Buffer.concat([head, jpeg, Buffer.from('\r\n', 'latin1')])
}
