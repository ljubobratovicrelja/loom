import { createContext } from 'react'

interface HighlightContextType {
  neighborNodeIds: Set<string>
}

export const HighlightContext = createContext<HighlightContextType>({
  neighborNodeIds: new Set(),
})
