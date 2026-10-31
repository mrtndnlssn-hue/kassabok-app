import { useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { isValidIsoDate } from '../store';

// Textfält för datum som alltid visas och skrivs som YYYY-MM-DD (webbläsarens egna datumfält följer
// användarens språkinställning). Kalenderknappen öppnar den inbyggda datumväljaren, vars värde alltid är YYYY-MM-DD.
function maskDate(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 4) return d
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
}

export default function DateInput({ value, onChange, required, disabled, style, ...rest }) {
  const pickerRef = useRef()
  const [touched, setTouched] = useState(false)
  const invalid = !!value && (value.length === 10 || touched) && !isValidIsoDate(value)

  function openPicker() {
    const el = pickerRef.current
    if (!el) return
    try { el.showPicker() } catch { el.click() }
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text" inputMode="numeric" autoComplete="off"
        value={value} placeholder="YYYY-MM-DD" maxLength={10}
        pattern="\d{4}-\d{2}-\d{2}" title="Datum på formatet YYYY-MM-DD, t.ex. 2026-03-31"
        required={required} disabled={disabled}
        onChange={e => onChange(maskDate(e.target.value))}
        onBlur={() => setTouched(true)}
        style={{ fontFamily: 'var(--font-mono)', paddingRight: 34, borderColor: invalid ? 'var(--red)' : undefined, ...style }}
        {...rest}
      />
      <button type="button" onClick={openPicker} disabled={disabled} tabIndex={-1} title="Välj i kalender"
        style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--ink-muted)', display: 'flex' }}>
        <CalendarDays size={15} />
      </button>
      <input ref={pickerRef} type="date" tabIndex={-1} aria-hidden="true"
        value={isValidIsoDate(value) ? value : ''}
        onChange={e => e.target.value && onChange(e.target.value)}
        style={{ position: 'absolute', right: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
    </div>
  )
}
