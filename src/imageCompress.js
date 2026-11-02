// Förminskar foton och skärmdumpar innan de laddas upp som bilagor (sparar lagringsutrymme).
// Allt görs i webbläsaren. Filer som inte går att läsa som bild, eller som inte blir mindre, laddas upp som de är.
const MAX_SIDE = 2000          // längsta sida i pixlar; räcker för att läsa kvittotext
const QUALITY = 0.8
const SKIP_BELOW_BYTES = 300 * 1024   // redan små bilder lämnas orörda
const TYPES = ['image/jpeg', 'image/png', 'image/webp']

export async function optimizeImage(file) {
  try {
    if (!TYPES.includes(file.type)) return file
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < SKIP_BELOW_BYTES) { bitmap.close?.(); return file }

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'               // genomskinliga PNG-bilder blir vita i JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}
