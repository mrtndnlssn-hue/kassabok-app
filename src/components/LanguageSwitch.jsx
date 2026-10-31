import { LANGUAGES, useI18n } from '../i18n';

// Litet språkval (SV | EN). `dark` används i den mörka sidomenyn.
export default function LanguageSwitch({ dark = false, style }) {
  const { lang, setLang } = useI18n()
  const base = dark ? 'rgba(255,255,255,' : 'rgba(0,0,0,'
  return (
    <div role="group" aria-label="Language" style={{ display: 'inline-flex', gap: 2, ...style }}>
      {LANGUAGES.map(l => {
        const active = lang === l.code
        return (
          <button key={l.code} type="button" onClick={() => setLang(l.code)} title={l.label} aria-pressed={active}
            style={{
              border: 'none', cursor: 'pointer', borderRadius: 4, padding: '2px 7px', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.04em',
              background: active ? (dark ? 'rgba(255,255,255,0.18)' : 'var(--accent-3)') : 'transparent',
              color: active ? (dark ? '#fff' : 'var(--accent)') : `${base}${dark ? 0.45 : 0.45})`,
            }}>
            {l.code.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}
