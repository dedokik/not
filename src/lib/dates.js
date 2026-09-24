// Простой regex-парсинг дедлайнов (MVP):
// находит "дедлайн: 30.09", "дедлайн 30.09.2026", "deadline: 05.10"
const RE = /(?:дедлайн|deadline)\s*:?\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/gi

export function parseDeadlines(text) {
  if (!text) return []
  const out = []
  const now = new Date()
  // сбрасываем lastIndex т.к. regex глобальный
  RE.lastIndex = 0
  let m
  while ((m = RE.exec(text)) !== null) {
    let dd = parseInt(m[1], 10)
    let mm = parseInt(m[2], 10)
    let yy = m[3] ? parseInt(m[3], 10) : now.getFullYear()
    if (yy < 100) yy += 2000
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue
    const d = new Date(yy, mm - 1, dd, 12, 0, 0)
    if (isNaN(d.getTime())) continue
    // если дата без года уже прошла >30 дней назад — считаем следующий год
    if (!m[3]) {
      const diff = (d - now) / 86400000
      if (diff < -30) d.setFullYear(d.getFullYear() + 1)
    }
    out.push({ day: dd, month: mm, year: d.getFullYear(), date: d, raw: m[0] })
  }
  return out
}

export function firstDeadline(text) {
  const all = parseDeadlines(text)
  return all.length ? all[0] : null
}

export function fmtDate(d) {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}
