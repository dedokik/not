// Pixel Map: 1 выполненный чанк = 1 открытый пиксель (row-major порядок).
import { db, pixelCoord, MAP_W, MAP_H } from './db.js'

const CAP = MAP_W * MAP_H

export async function openForChunk(chunk) {
  // первая свободная клетка, а не count: после частичных снятий count
  // указывал бы на занятую координату и перезаписывал чужой пиксель
  const keys = await db.pixels.toCollection().primaryKeys()
  const used = new Set(keys.map(([x, y]) => y * MAP_W + x))
  let n = 0
  while (n < CAP && used.has(n)) n++
  if (n >= CAP) return null
  const { x, y } = pixelCoord(n)
  const row = { x, y, noteId: chunk.noteId, openedAt: Date.now() }
  await db.pixels.put(row)
  return row
}

export async function closeForChunk(chunk) {
  const last = await db.pixels.orderBy('openedAt').reverse().filter((p) => p.noteId === chunk.noteId).first()
  if (last) await db.pixels.delete([last.x, last.y])
}

export async function openedCount() {
  return db.pixels.count()
}
