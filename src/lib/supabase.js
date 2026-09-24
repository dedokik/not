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
// Ошибки (напр. RLS) бросаем наружу — тихий "Ок" при незалитых данных хуже ошибки.
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
      const { data, error } = await sb.from('notes').update(row).eq('id', existing).select('id')
      if (error) throw new Error(`push: ${error.message}`)
      if (!data || !data.length) {
        // облачной строки уже нет (удалена) — создаём заново вместо зомби-маппинга
        const ins = await sb.from('notes').insert(row).select('id').single()
        if (ins.error) throw new Error(`push: ${ins.error.message}`)
        if (ins.data) await rememberCloudId(`note:${n.id}`, ins.data.id)
      }
    } else {
      const { data, error } = await sb.from('notes').insert(row).select('id').single()
      if (error) throw new Error(`push: ${error.message}`)
      if (data) await rememberCloudId(`note:${n.id}`, data.id)
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
      // маппинга нет: может, это та же заметка с другого устройства
      // (сиды «Добро пожаловать» есть на обоих!) — ищем локальную без маппинга
      // с ТОЧНО таким же названием и усыновляем её вместо создания дубля
      const mappedLocalIds = new Set(
        Object.keys(map).filter((k) => k.startsWith('note:')).map((k) => Number(k.slice(5)))
      )
      const all = await db.notes.toArray()
      const twin = all.find(
        (l) => !mappedLocalIds.has(l.id) && (l.title || '').trim().toLowerCase() === (r.title || '').trim().toLowerCase()
      )
      if (twin) {
        await rememberCloudId(`note:${twin.id}`, r.id)
        // побеждает более свежая сторона, метку времени берём максимальную
        if (twin.updatedAt >= patch.updatedAt) {
          patch.title = twin.title
          patch.body = twin.body
          patch.dimension = twin.dimension
          patch.estimateHours = twin.estimateHours
          patch.updatedAt = twin.updatedAt
        }
        await db.notes.update(twin.id, patch)
        n++
      } else {
        const id = await db.notes.add({ ...patch })
        await rememberCloudId(`note:${id}`, r.id)
        n++
      }
    }
  }
  return n
}

// Измерения: upsert по id. Вызывается ПЕРВЫМ — заметки ссылаются на dimensions по FK.
async function pushDimensions(sb) {
  const dims = await db.dimensions.toArray()
  if (dims.length) {
    await sb.from('dimensions').upsert(
      dims.map((d) => ({ id: d.id, name: d.name, color: d.color })),
      { onConflict: 'id' }
    )
  }
}

async function pushRest(sb) {
  // связи/чанки/пиксели: wholesale replace (один пользователь)
  const noteMap = await getSetting('cloudIds', {})
  const idOf = (localId) => noteMap[`note:${localId}`] || null

  const links = (await db.links.toArray())
    .map((l) => ({ from_id: idOf(l.fromId), to_id: idOf(l.toId) }))
    .filter((l) => l.from_id && l.to_id)
  const chunks = (await db.chunks.toArray())
    .map((c) => ({ note_id: idOf(c.noteId), day: c.date, hours: c.hours, done: !!c.done, habit: !!c.habit }))
    .filter((c) => c.note_id)
  const pixels = (await db.pixels.toArray())
    .map((p) => ({ x: p.x, y: p.y, note_id: idOf(p.noteId), opened_at: new Date(p.openedAt).toISOString() }))

  await sb.from('links').delete().neq('from_id', '00000000-0000-0000-0000-000000000000')
  await sb.from('chunks').delete().neq('note_id', '00000000-0000-0000-0000-000000000000')
  await sb.from('pixels').delete().neq('x', -1)
  if (links.length) await sb.from('links').insert(links)
  if (chunks.length) await sb.from('chunks').insert(chunks)
  if (pixels.length) await sb.from('pixels').insert(pixels)
}

// Pull связей/чанков/пикселей: облако -> локально (идемпотентно, без дублей).
async function pullRest(sb) {
  const map = await getSetting('cloudIds', {})
  const rev = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]))
  const localNoteId = (cloudUuid) => {
    const k = rev[cloudUuid]
    return k && k.startsWith('note:') ? Number(k.slice(5)) : null
  }
  let links = 0, chunks = 0
  // измерения тянем ПЕРВЫМИ — иначе заметки с кастомным измерением нечем показать
  const { data: rd } = await sb.from('dimensions').select('*')
  for (const r of rd || []) {
    const ex = await db.dimensions.get(r.id)
    if (!ex) await db.dimensions.add({ id: r.id, name: r.name, color: r.color })
    else if (ex.name !== r.name || ex.color !== r.color) await db.dimensions.put({ ...ex, name: r.name, color: r.color })
  }
  const { data: rl } = await sb.from('links').select('*')
  const existingLinks = await db.links.toArray()
  for (const r of rl || []) {
    const f = localNoteId(r.from_id), t = localNoteId(r.to_id)
    if (!f || !t) continue
    if (!existingLinks.some((l) => l.fromId === f && l.toId === t)) {
      const id = await db.links.add({ fromId: f, toId: t })
      existingLinks.push({ id, fromId: f, toId: t })
      links++
    }
  }
  const { data: rc } = await sb.from('chunks').select('*')
  for (const r of rc || []) {
    const nid = localNoteId(r.note_id)
    if (!nid) continue
    const hb = !!r.habit
    const ex = await db.chunks.where('noteId').equals(nid).filter((c) => c.date === r.day && !!c.habit === hb).first()
    if (ex) {
      if (!!ex.done !== !!r.done || Number(ex.hours) !== Number(r.hours)) {
        await db.chunks.update(ex.id, { hours: Number(r.hours), done: r.done ? 1 : 0 })
        chunks++
      }
    } else {
      await db.chunks.add({ noteId: nid, date: r.day, hours: Number(r.hours), done: r.done ? 1 : 0, habit: hb ? 1 : 0 })
      chunks++
    }
  }
  const { data: rp } = await sb.from('pixels').select('*')
  for (const r of rp || []) {
    const ex = await db.pixels.get([r.x, r.y])
    if (!ex) {
      await db.pixels.put({ x: r.x, y: r.y, noteId: localNoteId(r.note_id), openedAt: new Date(r.opened_at).getTime() || Date.now() })
    }
  }
  return { links, chunks }
}

// Разовая чистка дубликатов (одинаковое название): остаётся самая свежая,
// остальные удаляются локально и в облаке. Запускать на КАЖДОМ устройстве.
export async function cleanupDuplicates() {
  const sb = cloud()
  const all = await db.notes.toArray()
  const byTitle = new Map()
  for (const n of all) {
    const t = (n.title || '').trim().toLowerCase()
    if (!byTitle.has(t)) byTitle.set(t, [])
    byTitle.get(t).push(n)
  }
  const map = await getSetting('cloudIds', {})
  let removed = 0
  for (const [, group] of byTitle) {
    if (group.length < 2) continue
    group.sort((a, b) => b.updatedAt - a.updatedAt)
    const [, ...dups] = group
    for (const d of dups) {
      await db.transaction('rw', [db.notes, db.links, db.chunks], async () => {
        await db.notes.delete(d.id)
        await db.links.where('fromId').equals(d.id).delete()
        await db.links.where('toId').equals(d.id).delete()
        await db.chunks.where('noteId').equals(d.id).delete()
      })
      try {
        const cid = map[`note:${d.id}`]
        if (cid && sb) await sb.from('notes').delete().eq('id', cid)
        delete map[`note:${d.id}`]
      } catch { /* следующий pushRest подчистит остатки */ }
      removed++
    }
  }
  await setSetting('cloudIds', map)
  return removed
}

export async function syncNow() {
  const sb = cloud()
  if (!sb) return { ok: false, reason: 'Нет VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env)' }
  try {
    await pushDimensions(sb)
    await pushNotes(sb)
    const pulled = await pullNotes(sb)
    const rest = await pullRest(sb)
    await pushRest(sb)
    await setSetting('lastSync', new Date().toISOString())
    return { ok: true, pulled, pulledLinks: rest.links, pulledChunks: rest.chunks }
  } catch (e) {
    return { ok: false, reason: String(e.message || e) }
  }
}
