// Regex-парсинг дат (без тяжёлых NLP-библиотек):
// "дедлайн: 30.09", "дедлайн 30.09.2026", "deadline: 05.10",
// "завтра", "послезавтра", "в понедельник/вторник/.../воскресенье"
const RE_DEADLINE = /(?:дедлайн|deadline)\s*:?\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/gi
// NB: без lookbehind (?<!) — он роняет парсинг модуля на старых Safari,
// вместо него левая граница через (?:^|[^а-яёa-zA-Z]) (lookahead (?!) безопасен везде).
const RE_TOMORROW = /(?:^|[^а-яёa-zA-Z])послезавтра(?![а-яёa-zA-Z])/gi
const RE_TOMORROW1 = /(?:^|[^а-яёa-zA-Z])завтра(?![а-яёa-zA-Z])/gi
const RE_DOW = /(?:^|[^а-яёa-zA-Z])(?:в|во)\s+(понедельник|вторник|среду|среде|четверг|пятницу|субботу|воскресенье|воскресение)(?![а-яёa-zA-Z])/gi

const DOW_NUM = {
  понедельник: 1, вторник: 2, среду: 3, среде: 3, четверг: 4,
  пятницу: 5, субботу: 6, воскресенье: 0, воскресение: 0,
}

function atNoon(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0)
}

export function parseDeadlines(text) {
  if (!text) return []
  const out = []
  const now = new Date()

  RE_DEADLINE.lastIndex = 0
  let m
  while ((m = RE_DEADLINE.exec(text)) !== null) {
    const dd = parseInt(m[1], 10)
    const mm = parseInt(m[2], 10)
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
    out.push({ day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear(), date: d, raw: m[0], index: m.index })
  }

  const pushRel = (date, raw, index) => {
    out.push({ day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear(), date: atNoon(date), raw, index })
  }

  RE_TOMORROW.lastIndex = 0
  while ((m = RE_TOMORROW.exec(text)) !== null) {
    const d = new Date(now); d.setDate(d.getDate() + 2)
    pushRel(d, m[0], m.index)
  }
  RE_TOMORROW1.lastIndex = 0
  while ((m = RE_TOMORROW1.exec(text)) !== null) {
    // "послезавтра" уже захвачен выше — не дублируем ("завтра" внутри "послезавтра" не матчится благодаря границам, но перестрахуемся)
    if (/после$/i.test(text.slice(Math.max(0, m.index - 5), m.index))) continue
    const d = new Date(now); d.setDate(d.getDate() + 1)
    pushRel(d, m[0], m.index)
  }
  RE_DOW.lastIndex = 0
  while ((m = RE_DOW.exec(text)) !== null) {
    const want = DOW_NUM[m[1].toLowerCase()]
    const cur = now.getDay()
    let diff = (want - cur + 7) % 7
    if (diff === 0) diff = 7 // "в понедельник" сегодня = через неделю
    const d = new Date(now); d.setDate(d.getDate() + diff)
    pushRel(d, m[0], m.index)
  }

  // в порядке упоминания в тексте
  out.sort((a, b) => a.index - b.index)
  return out
}

export function firstDeadline(text) {
  const all = parseDeadlines(text)
  return all.length ? all[0] : null
}

export function fmtDate(d) {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}
