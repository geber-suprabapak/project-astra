import sharp from 'sharp'
import { AppError } from '../../lib/errors/app-error.js'

export const MAX_ADIWIYATA_INPUT_BYTES = 5 * 1024 * 1024
export const MAX_ADIWIYATA_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_PIXELS = 20_000_000

function invalidImage(): AppError {
  return AppError.validationError(
    'Foto harus berupa JPEG atau PNG yang dapat dibaca dan maksimal 5 MB.',
  )
}

function xmlText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export async function decodeAdiwiyataImage(input: Buffer, declaredType: string): Promise<Buffer> {
  if (input.length === 0 || input.length > MAX_ADIWIYATA_INPUT_BYTES) throw invalidImage()
  try {
    const source = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
    const metadata = await source.metadata()
    const actualType =
      metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'png' ? 'image/png' : null
    if (
      actualType !== declaredType ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS
    ) {
      throw invalidImage()
    }
    return await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
  } catch (error) {
    if (error instanceof AppError) throw error
    throw invalidImage()
  }
}

function watermarkSvg(width: number, fullName: string, className: string, timestamp: string) {
  const bandHeight = 132
  const textWidth = width - 44
  const fontSize = 32
  const lines = [xmlText(fullName), `Kelas ${xmlText(className)}`, xmlText(timestamp)]
  const text = lines
    .map(
      (line, index) =>
        `<text x="22" y="${Math.round((bandHeight * (index + 1)) / 3) - Math.round(fontSize / 3)}" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="700" textLength="${textWidth}" lengthAdjust="spacingAndGlyphs">${line}</text>`,
    )
    .join('')
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${bandHeight}"><rect width="100%" height="100%" fill="#000" fill-opacity="0.72"/>${text}</svg>`,
  )
}

export async function createWatermarkedJpeg(params: {
  decodedImage: Buffer
  fullName: string
  className: string
  submittedAt: Date
}): Promise<Buffer> {
  const metadata = await sharp(params.decodedImage).metadata()
  if (!metadata.width || !metadata.height) throw invalidImage()
  const timestamp = `${new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  }).format(params.submittedAt)} WIB`

  for (const attempt of [
    { maxWidth: 2048, quality: 82 },
    { maxWidth: 2048, quality: 70 },
    { maxWidth: 1600, quality: 72 },
    { maxWidth: 1280, quality: 66 },
    { maxWidth: 1024, quality: 60 },
    { maxWidth: 800, quality: 54 },
    { maxWidth: 640, quality: 48 },
  ]) {
    const scale = Math.min(1, attempt.maxWidth / metadata.width)
    const width = Math.min(2048, Math.max(640, Math.round(metadata.width * scale)))
    const height = Math.min(2048, Math.max(180, Math.round(metadata.height * scale)))
    const output = await sharp(params.decodedImage)
      .resize({ width, height, fit: 'contain', background: '#fff' })
      .composite([
        {
          input: watermarkSvg(width, params.fullName, params.className, timestamp),
          left: 0,
          top: height - 132,
        },
      ])
      .jpeg({ quality: attempt.quality, mozjpeg: true })
      .toBuffer()
    if (output.length <= MAX_ADIWIYATA_OUTPUT_BYTES) return output
  }
  throw AppError.validationError('Foto tetap melebihi batas 2 MB setelah diproses.')
}
