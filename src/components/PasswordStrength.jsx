import { Check, Circle } from 'lucide-react'
import { useI18n } from '../i18n'
import { passwordStrength, passwordHint } from '../passwordRules'

const COLORS = ['var(--border)', 'var(--red)', '#d97706', 'var(--accent-2)', 'var(--accent)']

// Visar hur starkt ett nytt lösenord är och vilka krav som återstår
export default function PasswordStrength({ password, email }) {
  const { t } = useI18n()
  if (!password) return <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', marginTop: 4 }}>{passwordHint()}</div>
  const { checks, score } = passwordStrength(password, email)
  const labels = [t('Svagt'), t('Svagt'), t('Okej'), t('Starkt'), t('Mycket starkt')]
  return (
    <div style={{ marginTop: 8 }} aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: i <= score ? COLORS[score] : 'var(--border)', transition: 'background 0.2s' }} />
          ))}
        </div>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: COLORS[score], minWidth: 78, textAlign: 'right' }}>{labels[score]}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        {checks.map(c => (
          <li key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: c.ok ? 'var(--accent)' : 'var(--ink-muted)' }}>
            {c.ok ? <Check size={12} /> : <Circle size={10} />} {c.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
