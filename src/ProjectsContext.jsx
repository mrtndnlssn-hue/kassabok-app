import { createContext, useContext } from 'react'
import { getLang } from './i18n'

// Märkning av inkomster/utgifter med projekt (eller sektion, event …). Föreningen väljer själv vad funktionen heter.
const defaults = {
  allowed: false,            // ingår i föreningens plan
  enabled: false,            // plan + föreningen har slagit på funktionen
  labels: { one: 'Projekt', many: 'Projekt' },
  projects: [],
  mine: [],                  // projekt som den inloggade är kopplad till
  openProjectId: null,
  openProject: () => {},
  reload: async () => {},
}

const ProjectsContext = createContext(defaults)
export const ProjectsProvider = ProjectsContext.Provider
export const useProjects = () => useContext(ProjectsContext)

export const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
export const lower = s => (s || '').toLocaleLowerCase()

// Namn på funktionen: det föreningen skrivit in, annars standardnamnet på aktuellt språk
export const defaultLabels = () => (getLang() === 'en' ? { one: 'Project', many: 'Projects' } : { one: 'Projekt', many: 'Projekt' })
export function projectLabels(data) {
  const d = defaultLabels()
  return { one: data?.labelSingular || d.one, many: data?.labelPlural || d.many }
}
