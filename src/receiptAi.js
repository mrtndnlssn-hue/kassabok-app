import { supabase } from './supabase'
import { translate as t } from './i18n'
import { txLines, isDemoMode, DEMO_AI_LIMIT, demoAiUsed, demoAiCount } from './store'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_SIDE = 1600

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error(t('Kunde inte läsa filen.')))
    reader.readAsDataURL(blob)
  })
}

// Bilder skalas ner till max 1600 px (jpeg) så att mobilfoton blir små och billiga att läsa av.
async function downscaleImage(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85))
  return blob
}

export const canReadWithAi = file => /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(file?.type || '')

export async function getReceiptUsage(orgId) {
  if (isDemoMode()) return { enabled: true, used: demoAiUsed(), limit: DEMO_AI_LIMIT }
  const { data, error } = await supabase.rpc('get_receipt_usage', { p_org_id: orgId })
  if (error) throw error
  return data // { enabled, used, limit }
}

export async function setReceiptAiEnabled(orgId, enabled) {
  const { error } = await supabase.from('org_settings')
    .upsert({ org_id: orgId, ai_receipts_enabled: enabled })
  if (error) throw error
}

// Tidigare bokföring som stöd för förslaget: vilka konton liknande poster har bokförts på.
// Poster grupperas per beskrivning och konto (med antal), de senaste först, max 80 stycken.
export function buildHistory(transactions, categories) {
  const valid = new Set(categories.map(c => c.id))
  const groups = new Map()
  const sorted = [...(transactions || [])].filter(x => !x.voidedAt && x.description?.trim()).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  for (const tx of sorted) {
    for (const l of txLines(tx)) {
      if (!valid.has(l.categoryId)) continue
      const d = tx.description.trim().slice(0, 60)
      const key = `${d.toLowerCase()}|${l.categoryId}`
      const g = groups.get(key)
      if (g) g.n++
      else if (groups.size < 80) groups.set(key, { d, c: l.categoryId, n: 1 })
    }
  }
  return [...groups.values()]
}

// Returnerar { date, amount, description, category_id, confidence, used, limit }
export async function readReceipt(orgId, file, categories, history = []) {
  if (isDemoMode() && demoAiUsed() >= DEMO_AI_LIMIT) throw new Error(t('Demon tillåter en AI-avläsning per besök. Ladda om demon för att prova igen.'))
  let mediaType = file.type
  let blob = file
  if (mediaType.startsWith('image/')) {
    blob = await downscaleImage(file)
    mediaType = 'image/jpeg'
  }
  if (blob.size > MAX_BYTES) throw new Error(t('Filen är för stor för AI-avläsning (max 5 MB).'))

  const data = await blobToBase64(blob)
  const { data: result, error } = await supabase.functions.invoke('read-receipt', {
    body: {
      orgId, mediaType, data,
      categories: categories.map(c => ({ id: c.id, name: c.name, type: c.type })),
      history,
    },
  })
  if (error) throw new Error(t('Tjänsten för AI-avläsning kunde inte nås.'))
  if (result?.error) throw new Error(t(result.error))
  if (isDemoMode()) { demoAiCount(); return { ...result, used: demoAiUsed(), limit: DEMO_AI_LIMIT } }
  return result
}
