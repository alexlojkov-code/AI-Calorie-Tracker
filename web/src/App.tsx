import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Apple, ArrowDown, ArrowUp, BarChart3, CalendarDays, Camera, Check, ChevronDown, CircleHelp, Clock3, Flame, Heart, Leaf, LoaderCircle, LogOut, Plus, Search, Settings2, ShieldCheck, Sparkles, Utensils, X } from 'lucide-react'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { z } from 'zod'
import './App.css'

type Nutrients = { energy_kcal: number | null; protein_g: number | null; fat_g: number | null; carbohydrate_g: number | null; fiber_g?: number | null }
type Food = { fdcId?: number; name: string; brand?: string | null; dataType?: string; nutrientsPer100g: Nutrients; source: string; sourceReference?: string }
type Entry = { id: string; name: string; quantity_g: number; meal_type: MealType; energy_kcal_snapshot: number | null; protein_g_snapshot: number | null; fat_g_snapshot: number | null; carbohydrate_g_snapshot: number | null; fiber_g_snapshot?: number | null; source_type: string; source_reference?: string | null }
type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'
type Page = 'today' | 'diary' | 'analytics' | 'recipes' | 'settings'
const mealNames: Record<MealType, string> = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' }
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
const supabase: SupabaseClient | null = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
const localDateISO = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`
}
const shiftLocalDate = (date: string, days: number) => { const [year, month, day] = date.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10) }
const dateAtTashkentNoon = (date: string) => { const [year, month, day] = date.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day, 7)) }
const localeDate = (date = new Date()) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Tashkent', weekday: 'long', day: 'numeric', month: 'long' }).format(date)
const portionValue = (value: number | null | undefined, grams: number) => value == null ? null : value * grams / 100
const gramsSchema = z.coerce.number().finite().min(1).max(5000)
const sumKnown = (values: Array<number | null | undefined>) => values.length === 0 ? 0 : values.some((value) => value == null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
const display = (value: number | null | undefined, unit = '') => value == null ? '—' : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)}${unit}`

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [authMode, setAuthMode] = useState<'in' | 'up'>('in')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [page, setPage] = useState<Page>('today')
  const [entries, setEntries] = useState<Entry[]>([])
  const [goal, setGoal] = useState<number | null>(null)
  const [selectedDate, setSelectedDate] = useState(() => localDateISO())
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [modal, setModal] = useState(false)
  const [savingEntry, setSavingEntry] = useState(false)
  const [saveIntentId, setSaveIntentId] = useState(() => crypto.randomUUID())
  const [tab, setTab] = useState<'search' | 'manual' | 'photo' | 'text'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Food[]>([])
  const [searching, setSearching] = useState(false)
  const [food, setFood] = useState<Food | null>(null)
  const [grams, setGrams] = useState('100')
  const [mealType, setMealType] = useState<MealType>('breakfast')
  const [manualName, setManualName] = useState('')
  const [manualKcal, setManualKcal] = useState('')
  const [manualProtein, setManualProtein] = useState('')
  const [manualFat, setManualFat] = useState('')
  const [manualCarbs, setManualCarbs] = useState('')
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [draftItems, setDraftItems] = useState<Array<{ name: string; quantityGrams: number | null; state: string | null; needsConfirmation: boolean }>>([])
  const [draftQuestions, setDraftQuestions] = useState<string[]>([])
  const [analysisBusy, setAnalysisBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setAuthReady(true) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user || !supabase) { setEntries([]); return }
    let active = true
    setLoading(true)
    Promise.all([
      supabase.from('meals').select('id, meal_type, meal_items(id, custom_name, quantity_g, energy_kcal_snapshot, protein_g_snapshot, fat_g_snapshot, carbohydrate_g_snapshot, fiber_g_snapshot, source_type, source_reference)').eq('meal_date', selectedDate).order('created_at'),
      supabase.from('user_goals').select('daily_calorie_goal').lte('effective_from', selectedDate).order('effective_from', { ascending: false }).limit(1).maybeSingle(),
    ]).then(([mealResult, goalResult]) => {
      if (!active) return
      if (mealResult.error) setNotice(mealResult.error.message)
      const mapped: Entry[] = (mealResult.data ?? []).flatMap((meal: any) => (meal.meal_items ?? []).map((item: any) => ({ ...item, meal_type: meal.meal_type, name: item.custom_name ?? 'Продукт' })))
      setEntries(mapped)
      setGoal(goalResult.data?.daily_calorie_goal ?? null)
      setLoading(false)
    })
    return () => { active = false }
  }, [user, selectedDate])
  useEffect(() => { if (modal) setSaveIntentId(crypto.randomUUID()) }, [modal])

  const totals = useMemo(() => ({
    energy: sumKnown(entries.map((item) => item.energy_kcal_snapshot)),
    protein: sumKnown(entries.map((item) => item.protein_g_snapshot)),
    fat: sumKnown(entries.map((item) => item.fat_g_snapshot)),
    carbs: sumKnown(entries.map((item) => item.carbohydrate_g_snapshot)),
  }), [entries])
  const progress = goal && goal > 0 && totals.energy != null ? Math.min(100, Math.round(totals.energy / goal * 100)) : 0

  async function authenticate(event: FormEvent) {
    event.preventDefault(); if (!supabase) return
    setAuthBusy(true); setAuthMessage('')
    const result = authMode === 'in' ? await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword }) : await supabase.auth.signUp({ email: authEmail, password: authPassword })
    setAuthBusy(false)
    if (result.error) setAuthMessage(result.error.message)
    else if (authMode === 'up' && !result.data.session) setAuthMessage('Проверьте почту: отправили ссылку для подтверждения регистрации.')
  }

  async function searchFoods(event?: FormEvent) {
    event?.preventDefault(); if (!supabase || query.trim().length < 2) return
    setSearching(true); setResults([]); setNotice('')
    const { data, error } = await supabase.functions.invoke('food-search', { body: { query: query.trim() } })
    setSearching(false)
    if (error) setNotice('Поиск USDA недоступен. Проверьте развёртывание food-search и ключ USDA_FDC_API_KEY.')
    else setResults((data?.foods ?? []) as Food[])
  }

  async function ensureMeal(): Promise<string | null> {
    if (!supabase || !user) return null
    const { data: existing, error: findError } = await supabase.from('meals').select('id').eq('user_id', user.id).eq('meal_date', selectedDate).eq('meal_type', mealType).maybeSingle()
    if (findError) { setNotice(findError.message); return null }
    if (existing) return existing.id
    const { data, error } = await supabase.from('meals').insert({ user_id: user.id, meal_date: selectedDate, meal_type: mealType }).select('id').single()
    if (error) { setNotice(error.message); return null }
    return data.id
  }

  async function saveFood(selected: Food, sourceType: 'manual' | 'photo' | 'text' = 'manual') {
    if (savingEntry) return
    const amountResult = gramsSchema.safeParse(grams)
    if (!amountResult.success) { setNotice('Укажите массу от 1 до 5000 г.'); return }
    const amount = amountResult.data
    setSavingEntry(true)
    const mealId = await ensureMeal(); if (!mealId || !supabase) { setSavingEntry(false); return }
    const n = selected.nutrientsPer100g
    const snapshot = { energy_kcal_snapshot: portionValue(n.energy_kcal, amount), protein_g_snapshot: portionValue(n.protein_g, amount), fat_g_snapshot: portionValue(n.fat_g, amount), carbohydrate_g_snapshot: portionValue(n.carbohydrate_g, amount), fiber_g_snapshot: portionValue(n.fiber_g, amount) }
    const { error } = await supabase.from('meal_items').insert({ idempotency_key: saveIntentId, meal_id: mealId, food_id: null, custom_name: selected.name, quantity_g: amount, ...snapshot, nutrition_snapshot: { ...n, data_source: selected.source, source_reference: selected.sourceReference ?? null, brand: selected.brand ?? null }, source_type: sourceType, source_reference: selected.sourceReference ?? null })
    if (error && error.code !== '23505') { setNotice(error.message); setSavingEntry(false); return }
    setNotice(error ? 'Эта запись уже была сохранена.' : 'Добавлено в дневник и сохранено в облаке.'); setModal(false); setFood(null); setQuery(''); setResults([]); setManualName('')
    const { data } = await supabase.from('meals').select('id, meal_type, meal_items(id, custom_name, quantity_g, energy_kcal_snapshot, protein_g_snapshot, fat_g_snapshot, carbohydrate_g_snapshot, fiber_g_snapshot, source_type, source_reference)').eq('meal_date', selectedDate)
    setEntries((data ?? []).flatMap((meal: any) => (meal.meal_items ?? []).map((item: any) => ({ ...item, meal_type: meal.meal_type, name: item.custom_name ?? 'Продукт' }))))
    setSavingEntry(false)
  }

  async function saveManual(event: FormEvent) {
    event.preventDefault()
    const valueSchema = z.coerce.number().finite().min(0).max(1000)
    const nums = [manualKcal, manualProtein, manualFat, manualCarbs].map((raw) => raw.trim() === '' ? null : valueSchema.safeParse(raw).success ? valueSchema.parse(raw) : Number.NaN)
    if (!manualName.trim() || nums.some((n) => n != null && !Number.isFinite(n))) { setNotice('Проверьте название и значения на 100 г. Пустое поле оставляет нутриент неизвестным.'); return }
    await saveFood({ name: manualName.trim(), nutrientsPer100g: { energy_kcal: nums[0], protein_g: nums[1], fat_g: nums[2], carbohydrate_g: nums[3] }, source: 'Введено пользователем' })
  }

  async function analyzeText(event: FormEvent) {
    event.preventDefault(); if (!supabase || description.trim().length < 4) return
    setAnalysisBusy(true); setDraftItems([]); setDraftQuestions([]); setNotice('')
    const { data, error } = await supabase.functions.invoke('parse-meal', { body: { description: description.trim() } })
    setAnalysisBusy(false)
    if (error) setNotice('Текстовый разбор недоступен: настройте серверный ключ OpenAI и функцию parse-meal.')
    else { setDraftItems(data?.items ?? []); setDraftQuestions(data?.questions ?? []) }
  }

  async function analyzePhoto(event: FormEvent) {
    event.preventDefault(); if (!supabase || !photo) return
    setAnalysisBusy(true); setDraftItems([]); setDraftQuestions([]); setNotice('')
    const formData = new FormData(); formData.append('image', photo)
    const { data, error } = await supabase.functions.invoke('food-analysis', { body: formData })
    setAnalysisBusy(false)
    if (error) setNotice('Фотоанализ недоступен: настройте серверный ключ OpenAI и функцию food-analysis.')
    else { setDraftItems(data?.items ?? []); setDraftQuestions(data?.questions ?? []) }
  }

  async function removeEntry(entry: Entry) {
    if (!supabase) return
    const { error } = await supabase.from('meal_items').delete().eq('id', entry.id)
    if (error) setNotice(error.message); else setEntries((current) => current.filter((item) => item.id !== entry.id))
  }

  if (!authReady) return <div className="loading-screen"><LoaderCircle className="spin" /> Подключаем дневник…</div>
  if (!supabase) return <SetupScreen />
  if (!user) return <main className="auth-screen"><div className="auth-art"><div className="auth-mark"><Leaf size={23}/></div><span className="eyebrow">AI CALORIE TRACKER</span><h1>Забота о себе<br/>начинается с <em>внимания.</em></h1><p>Спокойный, точный и честный учёт питания — день за днём.</p><div className="art-bowl"><div className="bowl-food">🥗</div><span>Питание без догадок</span></div></div><form className="auth-card" onSubmit={authenticate}><div className="brand"><span className="brand-icon"><Leaf size={20}/></span><span>forma<span className="brand-dot">.</span></span></div><h2>{authMode === 'in' ? 'С возвращением' : 'Создать аккаунт'}</h2><p className="muted">{authMode === 'in' ? 'Войдите, чтобы открыть дневник питания.' : 'Ваш дневник будет доступен только вам.'}</p><label>Email<input autoComplete="email" type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="name@example.com"/></label><label>Пароль<input autoComplete={authMode === 'in' ? 'current-password' : 'new-password'} type="password" minLength={8} required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="Не менее 8 символов"/></label>{authMessage && <div className="inline-note">{authMessage}</div>}<button className="primary wide" disabled={authBusy}>{authBusy ? <LoaderCircle className="spin" size={17}/> : authMode === 'in' ? 'Войти' : 'Зарегистрироваться'}<ArrowUp size={16}/></button><button type="button" className="text-button" onClick={() => { setAuthMode(authMode === 'in' ? 'up' : 'in'); setAuthMessage('') }}>{authMode === 'in' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}</button><div className="secure-note"><ShieldCheck size={15}/> Данные защищены и доступны только вам</div></form></main>

  const navItems: Array<{ id: Page; label: string; icon: typeof Apple }> = [{ id: 'today', label: 'Сегодня', icon: CalendarDays }, { id: 'diary', label: 'Дневник', icon: Utensils }, { id: 'analytics', label: 'Аналитика', icon: BarChart3 }, { id: 'recipes', label: 'Рецепты', icon: Heart }, { id: 'settings', label: 'Настройки', icon: Settings2 }]
  const pageNames: Record<Page, string> = { today: 'Ваш день', diary: 'Дневник питания', analytics: 'Аналитика', recipes: 'Рецепты и избранное', settings: 'Настройки' }
  return <div className="app-shell"><aside className="sidebar"><a className="brand" href="#today" onClick={() => setPage('today')}><span className="brand-icon"><Leaf size={20}/></span><span>forma<span className="brand-dot">.</span></span></a><div className="side-caption">МЕНЮ</div><nav>{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}><Icon size={18}/><span>{item.label}</span>{item.id === 'today' && <span className="nav-dot"/>}</button> })}</nav><div className="sidebar-bottom"><div className="tip-card"><span className="tip-icon"><Sparkles size={17}/></span><b>Маленький шаг</b><p>Регулярность важнее идеального дня.</p><div className="tip-leaves">✳ ✦</div></div><button className="user-chip" onClick={() => supabase.auth.signOut()}><span className="avatar">{(user.email?.[0] ?? 'U').toUpperCase()}</span><span className="user-info"><b>{user.email?.split('@')[0]}</b><small>Мой профиль</small></span><LogOut size={16}/></button></div></aside>
    <main className="main-area"><header className="topbar"><div className="crumb"><span>МОЙ ДНЕВНИК</span><span className="crumb-slash">/</span><b>{pageNames[page]}</b></div><div className="top-actions"><button className="icon-button" aria-label="Помощь"><CircleHelp size={18}/></button><div className="avatar small-avatar">{(user.email?.[0] ?? 'U').toUpperCase()}</div></div></header>
      <div className="content"><section className="welcome-row"><div><div className="date-caption"><span className="live-dot"/> {page === 'today' ? localeDate(dateAtTashkentNoon(selectedDate)) : 'ВАША ИСТОРИЯ ПИТАНИЯ'}</div><h1>{page === 'today' ? <>Добрый день<span className="title-comma">,</span></> : pageNames[page]}<span className="title-leaf">✳</span></h1><p className="subtitle">{page === 'today' ? 'Здесь начинается ваш бережный путь к балансу.' : 'Данные основаны на ваших записях в дневнике.'}</p></div><div className="date-control"><button aria-label="Предыдущий день" onClick={() => setSelectedDate(shiftLocalDate(selectedDate, -1))}><ArrowDown size={16}/></button><span>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(dateAtTashkentNoon(selectedDate))}</span><button aria-label="Следующий день" onClick={() => setSelectedDate(shiftLocalDate(selectedDate, 1))}><ArrowUp size={16}/></button><input aria-label="Выбрать дату" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}/></div></section>
      {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Закрыть" onClick={() => setNotice('')}><X size={15}/></button></div>}
      {page === 'today' || page === 'diary' ? <><section className="summary-grid"><article className="calorie-card"><div className="calorie-head"><span className="metric-label">КАЛОРИИ ЗА ДЕНЬ</span><span className="metric-icon flame"><Flame size={18}/></span></div><div className="calorie-main"><strong>{display(totals.energy)}</strong><span>ккал</span></div><div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }}/></div><div className="calorie-foot"><span>{goal == null ? 'Цель пока не задана' : `из ${display(goal)} ккал`}</span><span>{goal == null || totals.energy == null ? '—' : `Осталось ${display(Math.max(0, goal - totals.energy))}`}</span></div><div className="calorie-watermark"><Flame size={94}/></div></article><MetricCard label="БЕЛКИ" value={totals.protein} goal={null} unit="г" icon="◉" tone="green"/><MetricCard label="ЖИРЫ" value={totals.fat} goal={null} unit="г" icon="◒" tone="peach"/><MetricCard label="УГЛЕВОДЫ" value={totals.carbs} goal={null} unit="г" icon="◈" tone="lilac"/></section>
      <section className="section-head"><div><span className="section-kicker">ВАШ РИТМ</span><h2>Приёмы пищи <span className="count-pill">{entries.length}</span></h2></div><button className="primary add-button" onClick={() => { setModal(true); setTab('search'); setNotice('') }}><Plus size={18}/> Добавить еду</button></section>
      <section className="meal-list">{loading && <div className="helper">Обновляем дневник…</div>}{(['breakfast', 'lunch', 'dinner', 'snack'] as MealType[]).map((type, idx) => { const items = entries.filter((entry) => entry.meal_type === type); const amount = sumKnown(items.map((item) => item.energy_kcal_snapshot)); return <article className={`meal-card meal-${type}`} key={type}><div className="meal-icon">{['☀', '◒', '☾', '✳'][idx]}</div><div className="meal-meta"><h3>{mealNames[type]}</h3><span>По выбранной дате</span></div><div className="meal-items">{items.length ? items.map((item) => <div className="meal-entry" key={item.id}><span>{item.name}<small>{display(item.quantity_g, ' г')} · {item.source_type === 'manual' ? 'ваши данные' : item.source_type}</small></span><b>{display(item.energy_kcal_snapshot)} <small>ккал</small><button aria-label={`Удалить ${item.name}`} onClick={() => removeEntry(item)}><X size={14}/></button></b></div>) : <span className="empty-meal">Пока ничего не добавлено</span>}</div><div className="meal-total">{display(amount)} <small>ккал</small></div><button className="meal-add" aria-label={`Добавить в ${mealNames[type]}`} onClick={() => { setMealType(type); setModal(true); setTab('search'); setNotice('') }}><Plus size={18}/></button></article> })}</section>
      <section className="bottom-grid"><article className="insight-card"><div className="insight-illustration"><div className="sun-glow"/><div className="plant">✿<br/>╱│╲</div></div><div><span className="section-kicker">НЕБОЛЬШОЕ НАПОМИНАНИЕ</span><h3>Прислушивайтесь к себе</h3><p>Ваш дневник — инструмент наблюдения, а не строгих ограничений. Выбирайте то, что поддерживает вас.</p></div><span className="sparkle">✦</span></article><article className="source-card"><span className="source-icon"><ShieldCheck size={19}/></span><div><b>Никаких догадок</b><p>Расчёты показывают только известные значения. Источник и неизвестные нутриенты остаются видимыми.</p></div><button aria-label="Подробнее"><ChevronDown size={16}/></button></article></section></> : <SecondaryPage page={page} entries={entries} goal={goal} setGoal={setGoal} setNotice={setNotice} signOut={() => supabase.auth.signOut()}/>}
      <footer className="footer"><span>forma<span className="brand-dot">.</span> <span className="muted">питание с вниманием</span></span><span><Clock3 size={13}/> Данные синхронизируются с облаком</span></footer>
      </div>
    </main>
    {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(false) }}><section className="food-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header className="modal-head"><div><span className="section-kicker">ДНЕВНИК ПИТАНИЯ</span><h2 id="modal-title">Добавить еду</h2></div><button className="close-button" onClick={() => setModal(false)} aria-label="Закрыть"><X size={20}/></button></header><div className="modal-tabs">{([['search', 'Поиск'], ['manual', 'Вручную'], ['photo', 'Фото'], ['text', 'Описание']] as const).map(([id, label]) => <button key={id} onClick={() => { setTab(id); setNotice(''); setDraftItems([]) }} className={tab === id ? 'selected' : ''}>{id === 'photo' && <Camera size={14}/>} {label}</button>)}</div>
      {tab === 'search' && <div className="modal-body"><form className="search-form" onSubmit={searchFoods}><Search size={18}/><input autoFocus placeholder="Например, яблоко или овсянка" value={query} onChange={(e) => setQuery(e.target.value)}/><button className="primary" disabled={searching || query.trim().length < 2}>{searching ? <LoaderCircle size={17} className="spin"/> : 'Найти'}</button></form><p className="helper">Ищем в USDA FoodData Central. Значения и источник будут показаны до сохранения.</p>{results.map((item) => <button className="food-result" key={`${item.fdcId}-${item.name}`} onClick={() => setFood(item)}><span className="food-result-icon"><Apple size={18}/></span><span><b>{item.name}</b><small>{item.brand || item.dataType || item.source}</small></span><span className="result-kcal">{display(item.nutrientsPer100g.energy_kcal)}<small> ккал/100 г</small></span><ChevronDown size={16}/></button>)}{food && <FoodReview food={food} grams={grams} setGrams={setGrams} mealType={mealType} setMealType={setMealType} onSave={() => saveFood(food)} onCancel={() => setFood(null)}/>}</div>}
      {tab === 'manual' && <form className="modal-body manual-form" onSubmit={saveManual}><div className="manual-note"><CircleHelp size={17}/> Введите данные с упаковки или проверенного источника. Пустое поле означает «неизвестно», не ноль.</div><label>Название продукта<input required value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Например, домашний плов"/></label><div className="form-grid"><label>Ккал / 100 г<input type="number" min="0" step="any" value={manualKcal} onChange={(e) => setManualKcal(e.target.value)} placeholder="ккал"/></label><label>Белки, г / 100 г<input type="number" min="0" step="any" value={manualProtein} onChange={(e) => setManualProtein(e.target.value)} placeholder="г"/></label><label>Жиры, г / 100 г<input type="number" min="0" step="any" value={manualFat} onChange={(e) => setManualFat(e.target.value)} placeholder="г"/></label><label>Углеводы, г / 100 г<input type="number" min="0" step="any" value={manualCarbs} onChange={(e) => setManualCarbs(e.target.value)} placeholder="г"/></label></div><ReviewFields grams={grams} setGrams={setGrams} mealType={mealType} setMealType={setMealType}/><button className="primary wide"><Check size={17}/> Добавить в дневник</button></form>}
      {tab === 'text' && <form className="modal-body manual-form" onSubmit={analyzeText}><label>Опишите блюдо<textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Куриная грудка 180 г, рис 150 г в готовом виде, оливковое масло 10 г"/></label><p className="helper">ИИ предложит состав и задаст вопросы. Нутриенты рассчитаются только по выбранным продуктам из каталога.</p><button className="primary wide" disabled={analysisBusy || description.trim().length < 4}>{analysisBusy ? <LoaderCircle className="spin" size={17}/> : <Sparkles size={17}/>} Разобрать описание</button><DraftReview items={draftItems} questions={draftQuestions} setItems={setDraftItems}/></form>}
      {tab === 'photo' && <form className="modal-body manual-form" onSubmit={analyzePhoto}><label className="upload-zone"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}/><span className="upload-icon"><Camera size={23}/></span><b>{photo ? photo.name : 'Выберите фотографию еды'}</b><small>JPG, PNG или WebP · до 8 МБ</small></label><p className="privacy-note"><ShieldCheck size={15}/> Фото передаётся серверу только для анализа и не появится в дневнике без вашего подтверждения.</p><button className="primary wide" disabled={!photo || analysisBusy}>{analysisBusy ? <LoaderCircle className="spin" size={17}/> : <Sparkles size={17}/>} Анализировать фото</button><DraftReview items={draftItems} questions={draftQuestions} setItems={setDraftItems}/></form>}
      </section></div>}
    </div>
}

function MetricCard({ label, value, goal, unit, icon, tone }: { label: string; value: number | null; goal: number | null; unit: string; icon: string; tone: string }) { const percent = goal && goal > 0 && value != null ? Math.min(100, value / goal * 100) : 0; return <article className={`metric-card ${tone}`}><div className="metric-top"><span className="metric-label">{label}</span><span className="metric-symbol">{icon}</span></div><div className="metric-value">{display(value)}<small>{unit}</small></div><div className="metric-track"><span style={{ width: `${percent}%` }}/></div><div className="metric-bottom"><span>{goal == null ? 'Цель не задана' : `из ${display(goal, unit)}`}</span><span>{goal == null || value == null ? '—' : `${Math.round(percent)}%`}</span></div></article> }

function ReviewFields({ grams, setGrams, mealType, setMealType }: { grams: string; setGrams: (value: string) => void; mealType: MealType; setMealType: (value: MealType) => void }) { return <div className="review-fields"><label>Масса, г<input type="number" min="1" max="5000" step="1" value={grams} onChange={(e) => setGrams(e.target.value)}/></label><label>Приём пищи<select value={mealType} onChange={(e) => setMealType(e.target.value as MealType)}>{Object.entries(mealNames).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label></div> }

function FoodReview({ food, grams, setGrams, mealType, setMealType, onSave, onCancel }: { food: Food; grams: string; setGrams: (value: string) => void; mealType: MealType; setMealType: (value: MealType) => void; onSave: () => void; onCancel: () => void }) { const amount = Number(grams) || 0; return <div className="review-card"><div className="review-title"><div><span className="section-kicker">ПРЕДВАРИТЕЛЬНЫЙ РАСЧЁТ</span><h3>{food.name}</h3></div><button className="close-button" onClick={onCancel} aria-label="Закрыть"><X size={16}/></button></div><div className="nutrient-strip"><span><b>{display(portionValue(food.nutrientsPer100g.energy_kcal, amount))}</b><small>ккал</small></span><span><b>{display(portionValue(food.nutrientsPer100g.protein_g, amount))}</b><small>белки, г</small></span><span><b>{display(portionValue(food.nutrientsPer100g.fat_g, amount))}</b><small>жиры, г</small></span><span><b>{display(portionValue(food.nutrientsPer100g.carbohydrate_g, amount))}</b><small>углеводы, г</small></span></div><div className="data-source"><ShieldCheck size={15}/><span>Источник: {food.source}{food.sourceReference ? ` · ${food.sourceReference}` : ''}. На порцию посчитано пропорционально массе.</span></div><ReviewFields grams={grams} setGrams={setGrams} mealType={mealType} setMealType={setMealType}/><button className="primary wide" onClick={onSave}><Check size={16}/> Подтвердить и добавить</button></div> }

function DraftReview({ items, questions, setItems }: { items: Array<{ name: string; quantityGrams: number | null; state: string | null; needsConfirmation: boolean }>; questions: string[]; setItems: (items: Array<{ name: string; quantityGrams: number | null; state: string | null; needsConfirmation: boolean }>) => void }) {
  if (!items.length && !questions.length) return null
  return <div className="draft-review"><div className="draft-heading"><span className="section-kicker">НУЖНА ВАША ПРОВЕРКА</span><span className="draft-status"><span className="live-dot"/> Черновик анализа</span></div>{questions.map((question) => <p className="draft-question" key={question}>{question}</p>)}{items.map((item, i) => <div className="draft-item" key={`${item.name}-${i}`}><div><b>{item.name}</b><small>{item.state || 'состояние не определено'} · оценка ИИ, проверьте</small></div><label><input aria-label={`Масса ${item.name}`} type="number" min="1" max="5000" value={item.quantityGrams ?? ''} onChange={(e) => setItems(items.map((x, index) => index === i ? { ...x, quantityGrams: e.target.value ? Number(e.target.value) : null } : x))}/> г</label><button className="close-button" aria-label="Удалить ингредиент" onClick={() => setItems(items.filter((_, index) => index !== i))}><X size={15}/></button></div>)}{items.length > 0 && <p className="helper">Состав не добавлен в дневник. Сопоставьте ингредиенты с каталогом, чтобы рассчитать нутриенты.</p>}</div>
}

function SecondaryPage({ page, entries, goal, setGoal, setNotice, signOut }: { page: Page; entries: Entry[]; goal: number | null; setGoal: (goal: number | null) => void; setNotice: (message: string) => void; signOut: () => void }) { const [goalText, setGoalText] = useState(goal?.toString() ?? ''); const grouped = useMemo(() => entries.reduce<Record<string, number>>((acc, entry) => { acc[entry.meal_type] = (acc[entry.meal_type] ?? 0) + (entry.energy_kcal_snapshot ?? 0); return acc }, {}), [entries]); if (page === 'analytics') return <div className="secondary-content"><section className="section-head"><div><span className="section-kicker">СЕГОДНЯ</span><h2>Наблюдайте за ритмом</h2></div></section><div className="analytics-panel"><div className="chart-header"><div><span>Калории по приёмам</span><small>Показаны только записи выбранного дня</small></div><BarChart3 size={20}/></div><div className="bars">{Object.entries(mealNames).map(([key, name]) => { const value = grouped[key] ?? 0; const max = Math.max(goal ?? 0, ...Object.values(grouped), 100); return <div className="bar-col" key={key}><span>{value ? display(value) : '—'}</span><div className="bar-bg"><i style={{ height: `${Math.max(3, value / max * 100)}%` }}/></div><small>{name}</small></div> })}</div><p className="helper">История начнёт строиться по мере сохранения записей. Пустые дни и отсутствующие нутриенты не считаются нулевыми значениями.</p></div></div>; if (page === 'settings') return <div className="secondary-content"><section className="settings-card"><div className="settings-icon"><Flame size={19}/></div><div className="settings-copy"><h3>Дневная цель калорий</h3><p>Это ориентир для сравнения, не медицинская рекомендация. Можно оставить пустым.</p><div className="goal-edit"><input type="number" min="1" max="10000" value={goalText} onChange={(e) => setGoalText(e.target.value)} placeholder="Например, 2000"/><span>ккал</span><button className="primary" onClick={async () => { const value = goalText.trim() === '' ? null : Number(goalText); if (value !== null && (!Number.isFinite(value) || value < 1 || value > 10000)) { setNotice('Укажите цель от 1 до 10000 ккал или оставьте пустой.'); return }; if (!supabase) return; const userResult = await supabase.auth.getUser(); const uid = userResult.data.user?.id; if (!uid) return; const today = localDateISO(); const { error } = await supabase.from('user_goals').insert({ user_id: uid, effective_from: today, daily_calorie_goal: value }); if (error) setNotice(error.message); else { setGoal(value); setNotice('Цель сохранена в облаке.') } }}>Сохранить</button></div></div></section><section className="settings-card"><div className="settings-icon"><ShieldCheck size={19}/></div><div className="settings-copy"><h3>Данные и приватность</h3><p>Профиль и дневник привязаны к вашей учётной записи. Политики доступа ограничивают чтение и изменение ваших записей.</p><button className="text-button danger-button" onClick={signOut}>Выйти из аккаунта <LogOut size={15}/></button></div></section></div>; if (page === 'recipes') return <div className="empty-state"><div className="empty-illustration">♡</div><h2>Здесь будут ваши рецепты</h2><p>Сохраняйте любимые блюда и добавляйте их в дневник повторно. Управление рецептами появится после базового сценария дневника.</p></div>; return <div className="secondary-content"><div className="history-header"><h2>История по приёмам</h2><span>{entries.length} записей</span></div>{entries.length ? entries.map((entry) => <div className="history-row" key={entry.id}><span className="history-dot"/><div><b>{entry.name}</b><small>{mealNames[entry.meal_type]} · {display(entry.quantity_g, ' г')}</small></div><strong>{display(entry.energy_kcal_snapshot)} ккал</strong></div>) : <div className="empty-state compact"><div className="empty-illustration"><Utensils size={25}/></div><h2>Пока день пуст</h2><p>После добавления еды история появится здесь.</p></div>}</div> }

function SetupScreen() { return <main className="setup-screen"><div className="setup-card"><div className="brand"><span className="brand-icon"><Leaf size={20}/></span><span>forma<span className="brand-dot">.</span></span></div><span className="section-kicker">ТРЕБУЕТСЯ НАСТРОЙКА</span><h1>Подключите личный дневник</h1><p>Облачное хранение и вход работают через Supabase. Значения пищевой ценности и AI-анализ не подменяются демонстрационными данными.</p><div className="setup-steps"><b><span>1</span> Создайте проект Supabase</b><b><span>2</span> Скопируйте `.env.example` в `web/.env.local`</b><b><span>3</span> Примените миграцию из `supabase/migrations`</b><b><span>4</span> Добавьте серверные секреты для Edge Functions</b></div><code>VITE_SUPABASE_URL<br/>VITE_SUPABASE_PUBLISHABLE_KEY</code><p className="muted">После настройки запустите `pnpm dev` в папке `web`.</p></div></main> }

export default App
