// Supabase Cloud + Offline: двухсторонний синк заметок/связей, чанки/пиксели — push.
// Без VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY работает чисто локально (Dexie).
import { createClient } from '@supabase/supabase-js'
import { db, getSetting, setSetting } from './db.js'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const cloudEnabled = Boolean(URL && KEY)

let client = null
export function cloud() {
  if (!cloudEnabled) return null
  if (!client) client = createClient(URL, KEY)
  return client
}

async function cloudIdFor(localId) {
  const map = await getSetting('cloudIds', {})
  return map[localId] || null
}
async function rememberCloudId(localId, cloudId) {
  const map = await getSetting('cloudIds', {})
  map[localId] = cloudId
  await setSetting('cloudIds', map)
}

// Push заметки: upsert по cloudId, локально запоминаем соответствие.
async function pushNotes(sb) {
  const notes = await db.notes.toArray()
  for (const n of notes) {
    const existing = await cloudIdFor(`note:${n.id}`)
    const row = {
      title: n.title,
      body: n.body,
      dimension: n.dimension,
      estimate_hours: Number(n.estimateHours) || 0,
      updated_at: new Date(n.updatedAt).toISOString(),
    }
    if (existing) {
      await sb.from('notes').update(row).eq('id', existing)
    } else {
      const { data, error } = await sb.from('notes').insert(row).select('id').single()
      if (!error && data) await rememberCloudId(`note:${n.id}`, data.id)
    }
  }
}

// Pull: забираем облачные заметки новее lastSync, которых нет локально / которые новее.
async function pullNotes(sb) {
  const lastSync = await getSetting('lastSync', null)
  let q = sb.from('notes').select('*').order('updated_at', { ascending: true })
  if (lastSync) q = q.gt('updated_at', lastSync)
  const { data, error } = await q
  if (error || !data) return 0
  const map = await getSetting('cloudIds', {})
  const rev = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]))
  let n = 0
  for (const r of data) {
    const localKey = rev[r.id]
    const patch = {
      title: r.title,
      body: r.body,
      dimension: r.dimension,
      estimateHours: Number(r.estimate_hours) || 0,
      updatedAt: new Date(r.updated_at).getTime(),
    }
    if (localKey && localKey.startsWith('note:')) {
      const id = Number(localKey.slice(5))
      const local = await db.notes.get(id)
      if (local && local.updatedAt < patch.updatedAt) {
        await db.notes.update(id, patch)
        n++
      }
    } else {
      const id = await db.notes.add({ ...patch })
      await rememberCloudId(`note:${id}`, r.id)
      n++
    }
  }
  return n
}

async function pushRest(sb) {
  // связи/чанки/пиксели: wholesale replace (один пользователь)
  const noteMap = await getSetting('cloudIds', {})
  const idOf = (localId) => noteMap[`note:${localId}`] || null

  const links = (await db.links.toArray())
    .map((l) => ({ from_id: idOf(l.fromId), to_id: idOf(l.toId) }))
    .filter((l) => l.from_id && l.to_id)
  const chunks = (await db.chunks.toArray())
    .map((c) => ({ note_id: idOf(c.noteId), day: c.date, hours: c.hours, done: !!c.done }))
    .filter((c) => c.note_id)
  const pixels = (await db.pixels.toArray())
    .map((p) => ({ x: p.x, y: p.y, note_id: idOf(p.noteId), opened_at: new Date(p.openedAt).toISOString() }))

  await sb.from('links').delete().neq('from_id', '00000000-0000-0000-0000-000000000000')
  await sb.from('chunks').delete().neq('note_id', '00000000-0000-0000-0000-000000000000')
  await sb.from('pixels').delete().neq('x', -1)
  if (links.length) await sb.from('links').insert(links)
  if (chunks.length) await sb.from('chunks').insert(chunks)
  if (pixels.length) await sb.from('pixels').insert(pixels)

  // измерения (включая пользовательские): upsert по id
  const dims = await db.dimensions.toArray()
  if (dims.length) {
    await sb.from('dimensions').upsert(
      dims.map((d) => ({ id: d.id, name: d.name, color: d.color })),
      { onConflict: 'id' }
    )
  }
}

export async function syncNow() {
  const sb = cloud()
  if (!sb) return { ok: false, reason: 'Нет VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env)' }
  try {
    await pushNotes(sb)
    const pulled = await pullNotes(sb)
    await pushRest(sb)
    await setSetting('lastSync', new Date().toISOString())
    return { ok: true, pulled }
  } catch (e) {
    return { ok: false, reason: String(e.message || e) }
  }
}
