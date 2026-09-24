import { useEffect, useState } from 'react'
import { db, getSetting } from '../lib/db.js'
import { cloud, cloudEnabled, syncNow } from '../lib/supabase.js'

// NB: имена SUPA_*, а не URL — const URL затенял бы глобальный URL-конструктор
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function hostOf(u) {
  try { return new URL(u).host } catch { return '—' }
}

function Dot({ ok }) {
  const c = ok === true ? '#10b981' : ok === false ? '#ef4444' : '#666'
  return <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: c }} />
}

function Row({ ok, name, value }) {
  return (
    <div className="flex items-start gap-2 py-1 text-sm border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
      <span className="pt-1"><Dot ok={ok} /></span>
      <b className="shrink-0">{name}</b>
      <span className="opacity-80 break-all">{value}</span>
    </div>
  )
}

// Диагностика синка: что не так — видно прямо на устройстве.
// Открой на ПК и на телефоне, сравни, пришли мне отчёт кнопкой ниже.
export default function SyncDiag({ onSynced }) {
  const [rep, setRep] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const run = async () => {
    setBusy(true)
    setCopied(false)
    const r = {}
    try {
      r['время'] = new Date().toLocaleString('ru-RU')
      try { r['сборка'] = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'неизвестно' } catch { r['сборка'] = 'неизвестно' }
      r['браузер'] = (navigator.userAgent || '').slice(0, 90)
      r['интернет (браузер)'] = navigator.onLine ? 'да' : 'НЕТ'
      r['ключи в сборке|URL'] = SUPA_URL ? 'задан' : 'НЕТ — только локальный режим'
      r['ключи в сборке|хост'] = SUPA_URL ? hostOf(SUPA_URL) : '—'
      r['ключи в сборке|anon key'] = SUPA_KEY ? 'задан' : 'НЕТ'

      try {
        const [notes, chunks, links, pixels, dims] = await Promise.all([
          db.notes.count(), db.chunks.count(), db.links.count(), db.pixels.count(), db.dimensions.count(),
        ])
        const map = await getSetting('cloudIds', {})
        r['локально'] = `заметок ${notes}, чанков ${chunks}, связей ${links}, пикселей ${pixels}, измерений ${dims}, привязок к облаку ${Object.keys(map).length}`
        r['локально_ok'] = true
      } catch (e) {
        r['локально'] = `ОШИБКА БД: ${e.message}`
        r['локально_ok'] = false
      }
      r['последний синк'] = (await getSetting('lastSync', null)) || 'ещё не было'

      // какие именно заметки где: ловим расхождение наборов (устройства держат разные тройки)
      try {
        const localNotes = await db.notes.toArray()
        r['названия локально'] = localNotes.map((n) => `${n.id}:${(n.title || '').slice(0, 40)}`).join(' | ') || '—'
        const sb2 = cloud()
        if (sb2) {
          const cn = await sb2.from('notes').select('id,title').order('updated_at', { ascending: true })
          r['названия в облаке'] = cn.error
            ? `ОШИБКА: ${cn.error.message}`
            : (cn.data || []).map((n) => `${String(n.id).slice(0, 8)}:${(n.title || '').slice(0, 40)}`).join(' | ') || '—'
        }
      } catch (e) {
        r['названия'] = `не прочитались: ${e.message}`
      }

      // прямой доступ до Supabase (мимо библиотек): отличаем блок сети от плохого ключа.
      // Бьём в notes?select=id&limit=1: 200/206 = всё ок; 401 = ключ/RLS; сетевая ошибка = блок.
      // (корень /rest/v1/ отдаёт 401 даже с хорошим ключом — он не показатель)
      if (SUPA_URL && SUPA_KEY) {
        try {
          const c = new AbortController()
          const t = setTimeout(() => c.abort(), 10000)
          const resp = await fetch(`${SUPA_URL}/rest/v1/notes?select=id&limit=1`, { headers: { apikey: SUPA_KEY }, signal: c.signal })
          clearTimeout(t)
          r['прямой доступ|статус'] = resp.status
          r['прямой доступ|вывод'] =
            resp.status === 200 || resp.status === 206 ? 'сервер отвечает, ключ принят' :
            resp.status === 401 ? 'ПЛОХОЙ КЛЮЧ или RLS (401)' :
            `HTTP ${resp.status}`
          r['прямой доступ|ok'] = resp.status === 200 || resp.status === 206
        } catch (e) {
          r['прямой доступ|вывод'] = e.name === 'AbortError'
            ? 'ТАЙМАУТ 10с — сеть режет supabase (нужен VPN/прокси)'
            : `СЕТЬ НЕДОСТУПНА (${e.message}) — нужен VPN/прокси`
          r['прямой доступ|ok'] = false
        }
      }

      // авторизованный ping через клиент
      const sb = cloud()
      if (sb) {
        const p1 = await sb.from('notes').select('id', { count: 'exact', head: true })
        r['ping notes'] = p1.error ? `ОШИБКА: ${p1.error.message}` : `ок, строк: ${p1.count}`
        r['ping notes_ok'] = !p1.error
        const p2 = await sb.from('chunks').select('id', { count: 'exact', head: true })
        r['ping chunks'] = p2.error ? `ОШИБКА: ${p2.error.message}` : `ок, строк: ${p2.count}`
        r['ping chunks_ok'] = !p2.error
      } else {
        r['ping'] = 'пропущен: нет ключей'
      }

      // живой синк
      const s = await syncNow()
      r['пробный синк'] = s.ok
        ? `ок (заметок ${s.pulled}, чанков ${s.pulledChunks || 0})`
        : `ОШИБКА: ${s.reason}`
      r['пробный синк_ok'] = s.ok
      if (s.ok && onSynced) await onSynced()
    } catch (e) {
      r['фатально'] = String(e.message || e)
    }
    setRep(r)
    setBusy(false)
  }

  useEffect(() => { run() }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(rep, null, 2))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const rows = rep ? Object.entries(rep).filter(([k]) => !k.endsWith('_ok') && !k.endsWith('|ok') && !k.endsWith('|статус')) : []
  const okOf = (k) => {
    if (rep[k + '_ok'] !== undefined) return rep[k + '_ok']
    if (rep[k + '|ok'] !== undefined) return rep[k + '|ok']
    return null
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <b>Диагностика синка</b>
        <div className="flex-1" />
        <button onClick={run} disabled={busy} className="text-sm px-3 py-1 rounded panel">
          {busy ? 'Проверяю…' : 'Проверить снова'}
        </button>
        <button onClick={copy} disabled={!rep} className="text-sm px-3 py-1 rounded accent-bg text-black font-semibold">
          {copied ? 'Скопировано!' : 'Скопировать отчёт'}
        </button>
      </div>
      {!cloudEnabled && (
        <div className="panel rounded p-3 text-sm mb-3">
          Ключи не вшиты в эту сборку — работает только локальный режим. Добавь переменные в Cloudflare и пересобери.
        </div>
      )}
      <div className="panel rounded p-3">
        {!rep && <div className="text-sm opacity-50">Собираю данные…</div>}
        {rows.map(([k, v]) => (
          <Row key={k} ok={okOf(k)} name={k} value={String(v)} />
        ))}
      </div>
      <div className="text-xs opacity-50 mt-2">
        Пришли мне отчёт кнопкой выше (с ПК и с телефона) — по нему скажу точно, где рвётся.
      </div>
    </div>
  )
}
