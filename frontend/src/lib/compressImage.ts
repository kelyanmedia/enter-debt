/** Сжатие изображений на клиенте перед загрузкой в примечание. */

const MAX_EDGE = 1280
const JPEG_QUALITY = 0.72

export async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Можно прикреплять только изображения')
  }
  // GIF оставляем как есть (анимация)
  if (file.type === 'image/gif' && file.size <= 1.5 * 1024 * 1024) {
    return file
  }

  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = bitmap
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен')
    ctx.drawImage(bitmap, 0, 0, w, h)

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Не удалось сжать изображение'))),
        'image/jpeg',
        JPEG_QUALITY,
      )
    })

    const base = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } finally {
    bitmap.close()
  }
}
