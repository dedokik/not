// Pixel Map: 1 выполненный чанк = 1 открытый пиксель (row-major порядок).
import { db, pixelCoord, MAP_W, MAP_H } from './db.js'

const CAP = MAP_W * MAP_H

export async function openForChunk(chunk) {
  const n = await db.pixels.count()
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
