const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: Record<string, unknown>, status = 200) => {
  const payload = 'code' in body ? { ...body, requestId: crypto.randomUUID(), details: null } : body
  return new Response(JSON.stringify(payload), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED', message: 'Используйте POST.' }, 405)
  try {
    const body = await request.json()
    const query = typeof body.query === 'string' ? body.query.trim().slice(0, 100) : ''
    if (query.length < 2) return json({ code: 'INVALID_QUERY', message: 'Введите не менее двух символов.' }, 400)
    const key = Deno.env.get('USDA_FDC_API_KEY')
    if (!key) return json({ code: 'INTEGRATION_NOT_CONFIGURED', message: 'USDA_FDC_API_KEY не настроен на сервере.' }, 503)
    const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, pageSize: 12, dataType: ['Foundation', 'SR Legacy', 'Branded'] }),
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) return json({ code: 'FOOD_PROVIDER_ERROR', message: 'Поставщик пищевых данных временно недоступен.' }, 502)
    const data = await response.json()
    const foods = (Array.isArray(data.foods) ? data.foods : []).map((food: Record<string, unknown>) => {
      const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients as Array<Record<string, unknown>> : []
      const find = (ids: number[]) => {
        const item = nutrients.find((n) => ids.includes(Number(n.nutrientId ?? (n.nutrient as Record<string, unknown> | undefined)?.id)))
        return item ? numberOrNull(item.value ?? item.amount) : null
      }
      return {
        fdcId: Number(food.fdcId), name: String(food.description ?? 'Без названия').slice(0, 180),
        brand: typeof food.brandOwner === 'string' ? food.brandOwner : null, dataType: String(food.dataType ?? ''),
        nutrientsPer100g: { energy_kcal: find([1008, 2047, 2048]), protein_g: find([1003]), fat_g: find([1004]), carbohydrate_g: find([1005]), fiber_g: find([1079, 1009]) },
        source: 'USDA FoodData Central', sourceReference: `FDC ${Number(food.fdcId)}`,
      }
    })
    return json({ foods })
  } catch {
    return json({ code: 'INTERNAL_ERROR', message: 'Не удалось выполнить поиск. Попробуйте позже.' }, 500)
  }
})
