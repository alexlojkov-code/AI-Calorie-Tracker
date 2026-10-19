const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: Record<string, unknown>, status = 200) => {
  const payload = 'code' in body ? { ...body, requestId: crypto.randomUUID(), details: null } : body
  return new Response(JSON.stringify(payload), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
const mealTypes = new Set(['breakfast','lunch','dinner','snack'])
function authenticatedUserId(request: Request): string | null {
  const bearer = request.headers.get('authorization')
  if (!bearer?.startsWith('Bearer ')) return null
  try {
    // The Supabase API gateway verifies this JWT before the function runs (verify_jwt=true).
    const segment = bearer.slice(7).split('.')[1]
    if (!segment) return null
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')))
    return typeof payload.sub === 'string' && /^[0-9a-f-]{36}$/i.test(payload.sub) ? payload.sub : null
  } catch { return null }
}
function nutrient(foodNutrients: Array<Record<string, unknown>>, ids: number[]): number | null {
  const item = foodNutrients.find((entry) => {
    const nutrient = entry.nutrient as Record<string, unknown> | undefined
    return ids.includes(Number(entry.nutrientId ?? nutrient?.id))
  })
  const amount = item?.amount ?? item?.value
  return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? amount : null
}
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED', message: 'Используйте POST.' }, 405)
  const userId = authenticatedUserId(request)
  if (!userId) return json({ code: 'UNAUTHORIZED', message: 'Требуется войти в аккаунт.' }, 401)
  try {
    const body = await request.json()
    const inputType = body.inputType
    const mealDate = typeof body.mealDate === 'string' ? body.mealDate : ''
    const mealType = typeof body.mealType === 'string' ? body.mealType : ''
    const items = body.items
    if (!['photo','text'].includes(inputType) || !Array.isArray(items) || items.length < 1 || items.length > 12) return json({ code: 'INVALID_ANALYSIS', message: 'Проверьте состав блюда: для подтверждения нужно от 1 до 12 продуктов.' }, 400)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mealDate) || Number.isNaN(Date.parse(`${mealDate}T00:00:00Z`)) || new Date(`${mealDate}T00:00:00Z`).toISOString().slice(0,10) !== mealDate) return json({ code: 'INVALID_DATE', message: 'Укажите корректную дату дневника.' }, 400)
    if (!mealTypes.has(mealType)) return json({ code: 'INVALID_MEAL_TYPE', message: 'Выберите корректный приём пищи.' }, 400)
    const usdaKey = Deno.env.get('USDA_FDC_API_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!usdaKey) return json({ code: 'INTEGRATION_NOT_CONFIGURED', message: 'USDA_FDC_API_KEY не настроен на сервере.' }, 503)
    if (!supabaseUrl || !serviceKey) return json({ code: 'DATABASE_NOT_CONFIGURED', message: 'Серверное подключение к базе не настроено.' }, 503)
    const seenKeys = new Set<string>()
    const input = items.map((entry: Record<string, unknown>) => {
      const fdcId = Number(entry.fdcId)
      const quantityGrams = Number(entry.quantityGrams)
      const idempotencyKey = typeof entry.idempotencyKey === 'string' ? entry.idempotencyKey : ''
      if (!Number.isSafeInteger(fdcId) || fdcId <= 0 || !Number.isFinite(quantityGrams) || quantityGrams < 1 || quantityGrams > 5000 || !/^[0-9a-f-]{36}$/i.test(idempotencyKey) || seenKeys.has(idempotencyKey)) throw new Error('invalid item')
      seenKeys.add(idempotencyKey)
      return { fdcId, quantityGrams, idempotencyKey }
    })
    const verified: Array<Record<string, unknown>> = []
    for (let start = 0; start < input.length; start += 4) {
      const group = await Promise.all(input.slice(start, start + 4).map(async (entry) => {
        const response = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${entry.fdcId}?api_key=${encodeURIComponent(usdaKey)}`, { signal: AbortSignal.timeout(12000) })
        if (!response.ok) throw new Error('food provider unavailable')
        const food = await response.json()
        if (typeof food.description !== 'string' || !Array.isArray(food.foodNutrients)) throw new Error('food data invalid')
        const nutrients = {
          energy_kcal: nutrient(food.foodNutrients, [1008,2047,2048]),
          protein_g: nutrient(food.foodNutrients, [1003]),
          fat_g: nutrient(food.foodNutrients, [1004]),
          carbohydrate_g: nutrient(food.foodNutrients, [1005]),
          fiber_g: nutrient(food.foodNutrients, [1079,1009]),
        }
        return { fdcId: entry.fdcId, name: food.description.trim().slice(0,180), quantityGrams: entry.quantityGrams, idempotencyKey: entry.idempotencyKey, nutrients }
      }))
      verified.push(...group)
    }
    const saved = await fetch(`${supabaseUrl}/rest/v1/rpc/record_verified_food_batch`, {
      method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_meal_date: mealDate, p_meal_type: mealType, p_source_type: inputType, p_items: verified }),
      signal: AbortSignal.timeout(15000),
    })
    if (!saved.ok) return json({ code: 'SAVE_FAILED', message: 'Не удалось атомарно сохранить блюдо. Проверьте миграции и повторите попытку.' }, 502)
    const itemIds = await saved.json()
    return json({ status: 'completed', itemIds, items: verified.map(({ nutrients, ...item }) => ({ ...item, nutrientsPer100g: nutrients, source: 'USDA FoodData Central', sourceReference: `FDC ${item.fdcId}` })) })
  } catch {
    return json({ code: 'ANALYSIS_CONFIRMATION_FAILED', message: 'Не удалось подтвердить состав. Проверьте сопоставление продуктов и попробуйте снова.' }, 422)
  }
})
