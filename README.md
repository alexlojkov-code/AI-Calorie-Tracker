# AI Calorie Tracker

Русскоязычный адаптивный дневник питания с честным учётом источников данных. Frontend: React, TypeScript и Vite (`web/`); облачные данные и авторизация: Supabase; поиск продуктов: USDA FoodData Central; текстовый разбор и фотоанализ: OpenAI Responses API из Supabase Edge Functions.

## Запуск интерфейса

Требуется Node.js 20.19+ или 22.12+ и pnpm.

```sh
cd web
pnpm install
cp ../.env.example .env.local
# Заполните VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY
pnpm dev
```

Без Supabase-значений приложение показывает страницу настройки. Оно не подставляет фиктивные дневники и ответы интеграций.

## Облако

1. Создайте проект Supabase и примените SQL из `supabase/migrations/` через Supabase CLI или SQL Editor.
2. Включите подтверждение email в Supabase Auth и добавьте адрес приложения в Redirect URLs.
3. Разверните Edge Functions: `food-search`, `parse-meal`, `food-analysis`.
4. Задайте серверные секреты `USDA_FDC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL` через Supabase Dashboard или `supabase secrets set`. Не добавляйте их в `.env.local`, `VITE_*` или Git.
5. Создайте `web/.env.local` из `.env.example` и задайте только клиентские Supabase URL и publishable key.

Локальная разработка Edge Functions через Supabase CLI требует установленный Supabase CLI и Docker. Для локальных секретов скопируйте `supabase/functions/.env.example` в `supabase/functions/.env` — этот файл игнорируется Git.

## Уже реализовано

- Регистрация/вход через Supabase Auth.
- Дневник по локальной дате, четыре приёма пищи, сохранение и удаление записей.
- Расчёт известных нутриентов по массе; значения сохраняются снимком вместе с источником.
- Поиск USDA через серверную функцию (реальные ответы, без клиентского API-ключа).
- Явный ручной ввод значений с упаковки/проверенного источника; пустые нутриенты остаются неизвестными.
- Текстовый разбор и фотоанализ через OpenAI Responses API в режиме Structured Outputs; результат остаётся черновиком и не добавляется в дневник.
- Базовые страницы дневника, дневной аналитики, рецептов-заглушки и настроек цели калорий.
- PWA shell с кешем только статических файлов.
- PostgreSQL-схема, ограничения и RLS-политики для таблиц пользователя.

## Ещё не готово для production

Подключение и настройка реального Supabase-проекта, выбор и проверка доступной модели, rate limits/квоты, полноценное подтверждение анализа с сопоставлением USDA, офлайн-очередь, рецепты, избранное, недельная/месячная аналитика, ИИ-консультант, удаление аккаунта, политики Storage и privacy policy. Подробности — в `docs/OPEN_QUESTIONS.md` и `docs/ARCHITECTURE.md`.

Секреты и личные данные нельзя помещать в клиентский bundle или логи. Для обработки ошибок UI показывает только безопасное сообщение, а исходная ошибка не логируется.
