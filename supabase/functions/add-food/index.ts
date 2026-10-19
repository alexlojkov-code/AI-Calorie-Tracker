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
function numericNutrient(foodNutrients: Array<Record<string, unknown>>, ids: number[]): number | null {
  const match = foodNutrients.find((item) => {
    const nutrient = item.nutrient as Record<string, unknown> | undefined
    return ids.includes(Number(item.nutrientId ?? nutrient?.id))
  })
  const value = match?.amount ?? match?.value
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED', message: 'Используйте POST.' }, 405)
  const userId = authenticatedUserId(request)
  if (!userId) return json({ code: 'UNAUTHORIZED', message: 'Требуется войти в аккаунт.' }, 401)
  try {
    const body = await request.json()
    const fdcId = Number(body.fdcId)
    const grams = Number(body.quantityGrams)
    const mealDate = typeof body.mealDate === 'string' ? body.mealDate : ''
    const mealType = typeof body.mealType === 'string' ? body.mealType : ''
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : ''
    if (!Number.isSafeInteger(fdcId) || fdcId <= 0) return json({ code: 'INVALID_FOOD_ID', message: 'Выберите продукт из каталога.' }, 400)
    if (!Number.isFinite(grams) || grams < 1 || grams > 5000) return json({ code: 'INVALID_QUANTITY', message: 'Масса должна быть от 1 до 5000 г.' }, 400)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mealDate) || Number.isNaN(Date.parse(`${mealDate}T00:00:00Z`)) || new Date(`${mealDate}T00:00:00Z`).toISOString().slice(0,10) !== mealDate) return json({ code: 'INVALID_DATE', message: 'Укажите корректную дату дневника.' }, 400)
    if (!mealTypes.has(mealType)) return json({ code: 'INVALID_MEAL_TYPE', message: 'Выберите корректный приём пищи.' }, 400)
    if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return json({ code: 'INVALID_IDEMPOTENCY_KEY', message: 'Не удалось подтвердить запрос. Повторите действие.' }, 400)
    const usdaKey = Deno.env.get('USDA_FDC_API_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!usdaKey) return json({ code: 'INTEGRATION_NOT_CONFIGURED', message: 'USDA_FDC_API_KEY не настроен на сервере.' }, 503)
    if (!supabaseUrl || !serviceKey) return json({ code: 'DATABASE_NOT_CONFIGURED', message: 'Серверное подключение к базе не настроено.' }, 503)

    const upstream = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${encodeURIComponent(usdaKey)}`, { signal: AbortSignal.timeout(12000) })
    if (upstream.status === 404) return json({ code: 'FOOD_NOT_FOUND', message: 'Продукт больше не найден в каталоге USDA.' }, 404)
    if (!upstream.ok) return json({ code: 'FOOD_PROVIDER_ERROR', message: 'Поставщик пищевых данных временно недоступен.' }, 502)
    const food = await upstream.json()
    if (!Array.isArray(food.foodNutrients)) return json({ code: 'FOOD_DATA_INVALID', message: 'В каталоге нет пищевых значений для этого продукта.' }, 422)
    const nutrients = {
      energy_kcal: numericNutrient(food.foodNutrients, [1008, 2047, 2048]),
      protein_g: numericNutrient(food.foodNutrients, [1003]),
      fat_g: numericNutrient(food.foodNutrients, [1004]),
      carbohydrate_g: numericNutrient(food.foodNutrients, [1005]),
      fiber_g: numericNutrient(food.foodNutrients, [1079, 1009]),
    }
    const name = typeof food.description === 'string' ? food.description.trim().slice(0, 180) : ''
    if (!name) return json({ code: 'FOOD_DATA_INVALID', message: 'У продукта отсутствует название.' }, 422)
    const saved = await fetch(`${supabaseUrl}/rest/v1/rpc/record_verified_food`, {
      method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_meal_date: mealDate, p_meal_type: mealType, p_fdc_id: fdcId, p_name: name, p_quantity_g: grams, p_nutrients: nutrients, p_idempotency_key: idempotencyKey }),
      signal: AbortSignal.timeout(12000),
    })
    if (!saved.ok) return json({ code: 'SAVE_FAILED', message: 'Не удалось сохранить запись. Проверьте миграции и повторите попытку.' }, 502)
    const itemId = await saved.json()
    return json({ itemId, name, quantityGrams: grams, nutrientsPer100g: nutrients, source: 'USDA FoodData Central', sourceReference: `FDC ${fdcId}`, savedToDiary: true })
  } catch {
    return json({ code: 'INTERNAL_ERROR', message: 'Не удалось добавить продукт. Попробуйте позже.' }, 500)
  }
})
