// Auto-chunking: оценка (часы) / дни до дедлайна = ежедневные чанки.
// Перерасчёт: невыполненные часы прошлого перераспределяются на оставшиеся дни.
import { db } from './db.js'
import { firstDeadline } from './dates.js'

export const RE_EFFORT = /оценк[аи]\s*:?\s*(\d+(?:[.,]\d+)?)\s*ч/gi

export function parseEffort(text) {
  if (!text) return 0
  RE_EFFORT.lastIndex = 0
  const m = RE_EFFORT.exec(text)
  return m ? parseFloat(m[1].replace(',', '.')) : 0
}

export function dayISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayISO() {
  return dayISO(new Date())
}

function eachDayISO(fromISO, toDate) {
  const out = []
  const cur = new Date(fromISO + 'T12:00:00')
  const end = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 12)
  while (cur <= end) {
    out.push(dayISO(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

const round1 = (x) => Math.round(x * 10) / 10

// Построить/перестроить план чанков для заметки. Выполненные чанки не трогаем.
export async function buildPlan(note) {
  const dl = firstDeadline(`${note.title}\n${note.body}`)
  const total = Number(note.estimateHours) || parseEffort(`${note.title}\n${note.body}`)
  if (!dl || !total || total <= 0) return { ok: false, reason: 'Нужны дедлайн и оценка > 0' }

  const existing = await db.chunks.where('noteId').equals(note.id).toArray()
  const doneHours = existing.filter((c) => c.done).reduce((s, c) => s + c.hours, 0)
  const rest = round1(total - doneHours)
  if (rest <= 0) return { ok: true, chunks: existing }

  const days = eachDayISO(todayISO(), dl.date).filter((d) => d >= todayISO())
  if (!days.length) return { ok: false, reason: 'Дедлайн прошёл' }

  // удаляем незавершённые, делим остаток поровну
  await db.chunks.where('noteId').equals(note.id).filter((c) => !c.done).delete()
  const per = round1(rest / days.length)
  const rows = days.map((day, i) => ({
    noteId: note.id,
    date: day,
    hours: i === days.length - 1 ? round1(rest - per * (days.length - 1)) : per,
    done: 0,
  }))
  await db.chunks.bulkAdd(rows)
  return { ok: true, chunks: await db.chunks.where('noteId').equals(note.id).toArray() }
}

// Автоперерасчёт при старте: пропущенные дни redistributed на оставшиеся.
export async function recalcMissed(notes) {
  let touched = 0
  for (const n of notes) {
    const all = await db.chunks.where('noteId').equals(n.id).toArray()
    if (!all.length) continue
    const missed = all.filter((c) => !c.done && c.date < todayISO())
    if (!missed.length) continue
    const r = await buildPlan(n)
    if (r.ok) touched++
  }
  return touched
}

export async function toggleChunk(chunk, pixels) {
  const done = chunk.done ? 0 : 1
  await db.chunks.update(chunk.id, { done })
  if (done) {
    await pixels.openForChunk(chunk)
  } else {
    await pixels.closeForChunk(chunk)
  }
}
