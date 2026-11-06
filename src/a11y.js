// Tillgänglighet som gäller hela appen, utan att varje dialog och formulär behöver kodas om för hand:
//
//  1. Dialogrutor (.modal-overlay > .modal): får role="dialog", aria-modal och rubrikkoppling, fokus flyttas in
//     när de öppnas, Tab hålls kvar i rutan, Escape stänger den och fokus går tillbaka till det som öppnade den.
//  2. Etiketter (<label>) kopplas till sitt fält (for/id), så att skärmläsare läser upp fältets namn och så att
//     ett klick på etiketten ger fältet fokus.
//
// Det sker som en förbättring i efterhand när element läggs till i sidan. Ny kod bör ändå skriva htmlFor/id själv.

const CONTROLS = 'input:not([type="hidden"]),select,textarea'
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
let seq = 0

// ── Etiketter ─────────────────────────────────────────────────────
function findControlFor(label) {
  // Först fältet som kommer efter etiketten (innan nästa etikett), annars fältet precis före (kryssrutor med text efter)
  let el = label.nextElementSibling
  while (el && el.tagName !== 'LABEL') {
    const hit = el.matches(CONTROLS) ? el : el.querySelector(CONTROLS)
    if (hit) return hit
    el = el.nextElementSibling
  }
  const prev = label.previousElementSibling
  if (prev && prev.matches(CONTROLS) && !document.querySelector(`label[for="${CSS.escape(prev.id || '_')}"]`)) return prev
  return null
}

function linkLabel(label) {
  if (label.htmlFor || label.dataset.a11yLinked || label.querySelector(CONTROLS)) return
  const target = findControlFor(label)
  if (!target || target.getAttribute('aria-label') || target.getAttribute('aria-labelledby')) return
  if (target.id && document.querySelector(`label[for="${CSS.escape(target.id)}"]`)) return
  if (!target.id) target.id = `fld-${++seq}`
  label.htmlFor = target.id
  label.dataset.a11yLinked = '1'
}

function linkLabelsIn(root) {
  if (root.nodeType !== 1) return
  if (root.tagName === 'LABEL') linkLabel(root)
  root.querySelectorAll?.('label').forEach(linkLabel)
}

// ── Dialogrutor ───────────────────────────────────────────────────
const stack = []   // öppna dialoger, den översta sist: { overlay, dialog, opener }

const isVisible = el => el.offsetParent !== null || el === document.activeElement

function setupOverlay(overlay) {
  if (overlay.dataset.a11yDialog) return
  overlay.dataset.a11yDialog = '1'
  const dialog = overlay.querySelector('.modal') || overlay.firstElementChild
  if (!dialog) return
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  const title = dialog.querySelector('.modal-title, h1, h2, h3, h4, .section-title')
  if (title) { if (!title.id) title.id = `dlg-${++seq}`; dialog.setAttribute('aria-labelledby', title.id) }
  dialog.tabIndex = -1
  stack.push({ overlay, dialog, opener: document.activeElement })
  // På pekskärmar ger fokus i ett fält direkt ett tangentbord, så där flyttas fokus bara till rutan
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  const pick = () => [...dialog.querySelectorAll('[autofocus],' + CONTROLS)].find(el => el.type !== 'file' && !el.disabled && el.offsetParent !== null)
  setTimeout(() => {
    if (!dialog.isConnected) return
    const first = coarse ? null : pick()
    ;(first || dialog).focus({ preventScroll: true })
    if (!dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true })
  }, 30)
}

function cleanupClosed() {
  for (let i = stack.length - 1; i >= 0; i--) {
    const d = stack[i]
    if (d.overlay.isConnected) continue
    stack.splice(i, 1)
    const o = d.opener
    if (o && o.isConnected && o !== document.body) setTimeout(() => o.focus({ preventScroll: true }), 0)
  }
}

function onKeyDown(e) {
  const top = stack[stack.length - 1]
  if (!top || !top.overlay.isConnected) return
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return
    e.preventDefault()
    // Samma sak som ett klick utanför rutan: stänger den om den inte är upptagen
    top.overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return
  }
  if (e.key !== 'Tab') return
  const items = [...top.dialog.querySelectorAll(FOCUSABLE)].filter(isVisible)
  if (!items.length) { e.preventDefault(); top.dialog.focus(); return }
  const first = items[0], last = items[items.length - 1], active = document.activeElement
  if (!top.dialog.contains(active) || active === top.dialog) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return }
  if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
}

export function initA11y() {
  document.addEventListener('keydown', onKeyDown)
  const scan = nodes => {
    for (const n of nodes) {
      if (n.nodeType !== 1) continue
      linkLabelsIn(n)
      if (n.classList?.contains('modal-overlay')) setupOverlay(n)
      n.querySelectorAll?.('.modal-overlay').forEach(setupOverlay)
    }
  }
  new MutationObserver(muts => {
    for (const m of muts) scan(m.addedNodes)
    if (muts.some(m => m.removedNodes.length)) cleanupClosed()
  }).observe(document.body, { childList: true, subtree: true })
  scan([document.body])
}

// Gör ett element som inte är en knapp (kort, rad) användbart med tangentbord: fokuserbart, aktiveras med Enter och mellanslag.
// Användning: <div {...clickable(() => öppna(id))}>
export const clickable = fn => ({
  role: 'button',
  tabIndex: 0,
  onClick: fn,
  onKeyDown: e => {
    if (e.target !== e.currentTarget) return   // bara när själva elementet har fokus, inte en knapp i det
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e) }
  },
})
