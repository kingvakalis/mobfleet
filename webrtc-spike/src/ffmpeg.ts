/**
 * Build the ffmpeg argv that transcodes WDA's local MJPEG into low-latency H.264 RTP for werift.
 * Pure (no spawn) → unit-testable. The Mac owner tunes these flags during the spike (preset/tune/gop).
 *
 *   ffmpeg <args>  reads http://127.0.0.1:<mjpegPort>  (MJPEG, the WDA stream)
 *                  → libx264 ultrafast/zerolatency baseline yuv420p
 *                  → RTP to udp 127.0.0.1:<rtpPort>  (payload type 96; werift reads it)
 *
 * Why these flags: `-tune zerolatency` + `ultrafast` minimise encode latency; baseline/yuv420p is the
 * widest-compatible H.264 for browsers; a short fixed GOP (keyint) bounds recovery after packet loss;
 * pkt_size 1200 keeps RTP under the typical MTU so packets aren't IP-fragmented.
 */
export interface FfmpegSpikeOpts {
  mjpegPort: number    // WDA MJPEG, e.g. 9100
  rtpPort: number      // local UDP port werift listens on, e.g. 5004
  fps?: number         // output framerate cap (match the WDA mjpegServerFramerate)
  gop?: number         // keyframe interval in frames (default = fps)
  payloadType?: number // RTP payload type (must match werift, default 96)
  scale?: number | null // optional output width in px (null = source); height auto, keep aspect
}

export function buildFfmpegArgs(o: FfmpegSpikeOpts): string[] {
  const fps = o.fps ?? 15
  const gop = o.gop ?? fps
  const pt = o.payloadType ?? 96
  const args: string[] = [
    '-hide_banner', '-loglevel', 'warning',
    // low-latency input
    '-fflags', 'nobuffer', '-flags', 'low_delay', '-probesize', '32', '-analyzeduration', '0',
    '-f', 'mjpeg', '-i', `http://127.0.0.1:${o.mjpegPort}`,
    '-an',
    // H.264, zero-latency
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', '-level', '3.1',
    '-x264-params', `keyint=${gop}:min-keyint=${gop}:scenecut=0:bframes=0`,
    '-r', String(fps),
  ]
  if (o.scale && o.scale > 0) args.push('-vf', `scale=${o.scale}:-2`)
  args.push('-f', 'rtp', '-payload_type', String(pt), `rtp://127.0.0.1:${o.rtpPort}?pkt_size=1200`)
  return args
}
