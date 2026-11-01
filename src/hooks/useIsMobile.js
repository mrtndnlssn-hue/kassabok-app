import { useEffect, useState } from 'react'

// True på telefoner och smala fönster. Appen visar då mobilvarianten (flik-meny längst ner, kortlistor).
const QUERY = '(max-width: 768px)'

export default function useIsMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = e => setMobile(e.matches)
    mq.addEventListener('change', onChange)
    setMobile(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}
