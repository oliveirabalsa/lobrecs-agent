# T-04 · ProjectSidebar UI

**Milestone:** M1  
**Depende de:** T-03  
**Pode rodar em paralelo com:** T-05, T-06  
**Estimativa:** 3–4h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

Sidebar esquerda com lista de projetos. Permite criar, selecionar e deletar projetos.  
Ao criar, o usuário seleciona um diretório de repositório via file picker nativo.

---

## O que fazer

### 1. Criar `src/renderer/components/ProjectSidebar/index.tsx`

Componente com:
- Lista de projetos (nome + path truncado)
- Item selecionado destacado
- Botão "+" para criar novo projeto
- Clique direito → menu de contexto: "Rename", "Delete"
- Badge com quantidade de sessions ativas no projeto

```tsx
import { useState, useEffect } from 'react'
import type { Project } from '../../../shared/types'

interface Props {
  selectedProjectId: string | null
  onSelect: (project: Project) => void
}

export function ProjectSidebar({ selectedProjectId, onSelect }: Props) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.agentforge.projects.list().then(setProjects).finally(() => setLoading(false))
  }, [])

  async function handleCreate() {
    const dirPath = await window.agentforge.system.selectDirectory()
    if (!dirPath) return
    const name = dirPath.split('/').pop() ?? 'New Project'
    const project = await window.agentforge.projects.create({
      name,
      repoPath: dirPath,
      agentId: 'claude-code',
      modelTier: 'balanced',
    })
    setProjects(prev => [project, ...prev])
    onSelect(project)
  }

  // Renderizar lista + botão de criar
  // Usar Tailwind para estilo dark, similar ao Codex app sidebar
}
```

### 2. Criar `src/renderer/components/ProjectSidebar/NewProjectModal.tsx`

Modal com campos:
- Nome do projeto (auto-preenchido com nome da pasta)
- Caminho do repo (read-only, selecionado pelo file picker)
- Agente padrão: select com `claude-code | codex | opencode`
- Model tier: select com `lightweight | balanced | advanced | frontier`

### 3. Criar `src/renderer/components/ProjectSidebar/ProjectItem.tsx`

Item da lista com:
- Ícone de pasta
- Nome truncado (max 20 chars + ellipsis)
- Path truncado em 2 linhas
- Estado visual: selected / hover
- `onContextMenu` para menu de contexto via Radix ContextMenu

### 4. Estilo

Dark theme com Tailwind:
- Sidebar background: `bg-zinc-900`
- Item selecionado: `bg-zinc-700`
- Hover: `bg-zinc-800`
- Texto primário: `text-zinc-100`
- Texto secundário: `text-zinc-400`
- Border direita: `border-r border-zinc-700`

---

## Critérios de aceite (DoD)

- [ ] Sidebar renderiza lista de projetos ao abrir o app
- [ ] Botão "+" abre file picker nativo (dialog de pasta)
- [ ] Ao selecionar pasta, modal de criação pré-preenche nome e path
- [ ] Projeto criado aparece no topo da lista
- [ ] Clicar em projeto chama `onSelect`
- [ ] Menu de contexto tem opções Delete (com confirmação) e Rename
- [ ] Responsivo para sidebar width entre 180px–280px
- [ ] TypeScript sem erros
