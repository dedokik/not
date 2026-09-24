// Авто-связи через [[Название заметки]] + ручные связи из таблицы links.
const RE_LINK = /\[\[\s*([^\[\]]+?)\s*\]\]/g

export function parseWikiLinks(text) {
  if (!text) return []
  const out = []
  RE_LINK.lastIndex = 0
  let m
  while ((m = RE_LINK.exec(text)) !== null) {
    const name = m[1].trim()
    if (name) out.push(name)
  }
  return [...new Set(out)]
}

// Строит рёбра графа: { from, to, auto: true/false }
export function buildEdges(notes, manualLinks) {
  const byTitle = new Map()
  for (const n of notes) byTitle.set((n.title || '').trim().toLowerCase(), n.id)
  const edges = []
  const seen = new Set()
  const add = (from, to, auto) => {
    if (!from || !to || from === to) return
    const k = `${from}>${to}:${auto ? 'a' : 'm'}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ from, to, auto })
  }
  for (const n of notes) {
    for (const name of parseWikiLinks(`${n.title}\n${n.body}`)) {
      const target = byTitle.get(name.toLowerCase())
      if (target) add(n.id, target, true)
    }
  }
  for (const l of manualLinks || []) add(l.fromId, l.toId, false)
  return edges
}
