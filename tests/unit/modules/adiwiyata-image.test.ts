import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  createWatermarkedJpeg,
  decodeAdiwiyataImage,
  MAX_ADIWIYATA_INPUT_BYTES,
  MAX_ADIWIYATA_OUTPUT_BYTES,
} from '../../../src/modules/adiwiyata/image.js'

describe('Adiwiyata image processing', () => {
  it('keeps a permanent visible watermark on a tiny image using a readable canvas', async () => {
    const input = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#24364b' },
    })
      .png()
      .toBuffer()
    const decodedImage = await decodeAdiwiyataImage(input, 'image/png')
    const output = await createWatermarkedJpeg({
      decodedImage,
      fullName: 'Ayu & <Sari> 東京',
      className: 'XII RPL 1',
      submittedAt: new Date('2026-09-29T05:30:00.000Z'),
    })
    const pixels = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true })

    expect(output.length).toBeLessThanOrEqual(MAX_ADIWIYATA_OUTPUT_BYTES)
    expect(pixels.info.width).toBeGreaterThanOrEqual(640)
    expect(pixels.info.height).toBeGreaterThanOrEqual(180)

    const bandTop = pixels.info.height - 132
    const baselines = [33, 77, 121]
    for (const baseline of baselines) {
      const firstRow = bandTop + baseline - 32
      const lastRow = bandTop + baseline + 4
      let brightGlyphPixels = 0
      for (let y = firstRow; y <= lastRow; y += 1) {
        for (let x = 16; x < pixels.info.width - 16; x += 1) {
          const offset = (y * pixels.info.width + x) * pixels.info.channels
          if (
            pixels.data[offset]! > 185 &&
            pixels.data[offset + 1]! > 185 &&
            pixels.data[offset + 2]! > 185
          ) {
            brightGlyphPixels += 1
          }
        }
      }
      expect(brightGlyphPixels, `watermark line at y=${baseline} must render`).toBeGreaterThan(0)
    }
  })

  it('rejects invalid bytes, MIME mismatches, oversized inputs, and decoded pixel bombs', async () => {
    await expect(decodeAdiwiyataImage(Buffer.from('not an image'), 'image/png')).rejects.toThrow()
    await expect(decodeAdiwiyataImage(Buffer.from([1, 2, 3]), 'image/jpeg')).rejects.toThrow()
    await expect(
      decodeAdiwiyataImage(Buffer.alloc(MAX_ADIWIYATA_INPUT_BYTES + 1), 'image/png'),
    ).rejects.toThrow()

    const pixelBomb = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer()
    await expect(decodeAdiwiyataImage(pixelBomb, 'image/png')).rejects.toThrow()
  })
})
