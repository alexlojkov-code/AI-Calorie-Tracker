create extension if not exists pgcrypto;
create type public.meal_type as enum ('breakfast','lunch','dinner','snack');
create type public.food_source_type as enum ('manual','photo','text','recipe');

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end; $$;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, display_name text, birth_date date,
  height_cm numeric(5,2) check (height_cm is null or height_cm between 50 and 260),
  weight_kg numeric(5,2) check (weight_kg is null or weight_kg between 20 and 500),
  activity_level text check (activity_level is null or activity_level in ('low','light','moderate','high','very_high')),
  goal_type text check (goal_type is null or goal_type in ('maintain','loss','gain')),
  timezone text not null default 'Asia/Tashkent', preferred_units text not null default 'metric' check (preferred_units in ('metric','imperial')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_goals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  effective_from date not null default current_date, daily_calorie_goal numeric(8,2) check (daily_calorie_goal is null or daily_calorie_goal between 1 and 10000),
  protein_goal_g numeric(8,2) check (protein_goal_g is null or protein_goal_g between 0 and 1000),
  fat_goal_g numeric(8,2) check (fat_goal_g is null or fat_goal_g between 0 and 1000),
  carbohydrate_goal_g numeric(8,2) check (carbohydrate_goal_g is null or carbohydrate_goal_g between 0 and 2000), created_at timestamptz not null default now()
);
create index user_goals_history_idx on public.user_goals(user_id,effective_from desc,created_at desc);
create table public.foods (
  id uuid primary key default gen_random_uuid(), name text not null, normalized_name text not null, brand text, category text,
  source_provider text not null, source_id text not null, data_type text, default_state text, is_verified boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(source_provider,source_id)
);
create index foods_normalized_name_idx on public.foods using gin(to_tsvector('simple',normalized_name));
create table public.food_nutrients (
  id uuid primary key default gen_random_uuid(), food_id uuid not null references public.foods(id) on delete cascade,
  nutrient_code text not null, nutrient_name text not null, amount_per_100g numeric(12,4), unit text not null, data_source text not null,
  source_reference text, retrieved_at timestamptz not null default now(), unique(food_id,nutrient_code,data_source)
);
create table public.custom_foods (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 180), brand text, nutrients_per_100g jsonb not null default '{}'::jsonb,
  state text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(jsonb_typeof(nutrients_per_100g)='object')
);
create index custom_foods_owner_idx on public.custom_foods(user_id,created_at desc);
create table public.meals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  meal_date date not null, meal_type public.meal_type not null, title text, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,meal_date,meal_type)
);
create index meals_owner_date_idx on public.meals(user_id,meal_date desc,created_at);
create trigger meals_set_updated_at before update on public.meals for each row execute function public.set_updated_at();
create table public.meal_items (
  id uuid primary key default gen_random_uuid(), meal_id uuid not null references public.meals(id) on delete cascade,
  food_id uuid references public.foods(id) on delete set null, custom_food_id uuid references public.custom_foods(id) on delete set null,
  custom_name text check(custom_name is null or length(trim(custom_name)) between 1 and 180),
  quantity_g numeric(10,2) not null check(quantity_g between 0.01 and 5000), preparation_state text, preparation_method text,
  energy_kcal_snapshot numeric(12,4), protein_g_snapshot numeric(12,4), fat_g_snapshot numeric(12,4), carbohydrate_g_snapshot numeric(12,4), fiber_g_snapshot numeric(12,4),
  nutrition_snapshot jsonb not null default '{}'::jsonb, source_type public.food_source_type not null default 'manual', source_reference text,
  idempotency_key uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(food_id is not null or custom_food_id is not null or custom_name is not null), check(jsonb_typeof(nutrition_snapshot)='object')
);
create index meal_items_meal_idx on public.meal_items(meal_id,created_at);
create trigger meal_items_set_updated_at before update on public.meal_items for each row execute function public.set_updated_at();
create table public.food_analyses (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  input_type text not null check(input_type in ('photo','text')), image_object_key text, input_text text,
  ai_model text not null, analysis_status text not null check(analysis_status in ('needs_review','failed')),
  estimated_items jsonb not null default '[]'::jsonb, confidence_data jsonb, error_code text, idempotency_key text not null,
  created_at timestamptz not null default now(), completed_at timestamptz, unique(user_id,idempotency_key)
);
create table public.food_analysis_items (
  id uuid primary key default gen_random_uuid(), analysis_id uuid not null references public.food_analyses(id) on delete cascade,
  food_id uuid references public.foods(id) on delete set null, proposed_name text not null, estimated_quantity_g numeric(10,2), confirmed_quantity_g numeric(10,2),
  preparation_state text, preparation_method text, confidence numeric(4,3), nutrition_preview jsonb not null default '{}'::jsonb, user_confirmed boolean not null default false
);
create table public.favorite_foods (
  user_id uuid not null references auth.users(id) on delete cascade, food_id uuid references public.foods(id) on delete cascade,
  custom_food_id uuid references public.custom_foods(id) on delete cascade, created_at timestamptz not null default now(),
  check((food_id is null) <> (custom_food_id is null)), unique(user_id,food_id), unique(user_id,custom_food_id)
);
create table public.recipes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 180), servings numeric(8,2), yield_weight_g numeric(10,2),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.recipe_items (
  id uuid primary key default gen_random_uuid(), recipe_id uuid not null references public.recipes(id) on delete cascade,
  food_id uuid references public.foods(id) on delete set null, custom_food_id uuid references public.custom_foods(id) on delete set null,
  quantity_g numeric(10,2) not null check(quantity_g between 0.01 and 5000), preparation_state text, check(food_id is not null or custom_food_id is not null)
);
create table public.ai_conversations (id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,context_consent boolean not null default false,created_at timestamptz not null default now());
create table public.ai_messages (id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.ai_conversations(id) on delete cascade,role text not null check(role in ('user','assistant')),content text not null check(length(content)<=12000),created_at timestamptz not null default now());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$ begin insert into public.profiles(id,display_name) values(new.id,nullif(new.raw_user_meta_data->>'display_name','')); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security; alter table public.user_goals enable row level security;
alter table public.foods enable row level security; alter table public.food_nutrients enable row level security;
alter table public.custom_foods enable row level security; alter table public.meals enable row level security; alter table public.meal_items enable row level security;
alter table public.food_analyses enable row level security; alter table public.food_analysis_items enable row level security;
alter table public.favorite_foods enable row level security; alter table public.recipes enable row level security; alter table public.recipe_items enable row level security;
alter table public.ai_conversations enable row level security; alter table public.ai_messages enable row level security;
create policy "Users manage own profile" on public.profiles for all to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);
create policy "Users read own goals" on public.user_goals for select to authenticated using((select auth.uid())=user_id);
create policy "Users add own goals" on public.user_goals for insert to authenticated with check((select auth.uid())=user_id);
create policy "Users read verified foods" on public.foods for select to authenticated using(is_verified);
create policy "Users read nutrients for verified foods" on public.food_nutrients for select to authenticated using(exists(select 1 from public.foods f where f.id=food_id and f.is_verified));
create policy "Users manage own custom foods" on public.custom_foods for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy "Users manage own meals" on public.meals for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy "Users manage items in own meals" on public.meal_items for all to authenticated using(exists(select 1 from public.meals m where m.id=meal_id and m.user_id=(select auth.uid()))) with check(exists(select 1 from public.meals m where m.id=meal_id and m.user_id=(select auth.uid())));
create policy "Meal items reference only accessible foods" on public.meal_items as restrictive for all to authenticated
  using ((custom_food_id is null or exists(select 1 from public.custom_foods c where c.id=custom_food_id and c.user_id=(select auth.uid()))) and (food_id is null or exists(select 1 from public.foods f where f.id=food_id and f.is_verified)))
  with check ((custom_food_id is null or exists(select 1 from public.custom_foods c where c.id=custom_food_id and c.user_id=(select auth.uid()))) and (food_id is null or exists(select 1 from public.foods f where f.id=food_id and f.is_verified)));
create policy "Users manage own analyses" on public.food_analyses for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy "Users manage items in own analyses" on public.food_analysis_items for all to authenticated using(exists(select 1 from public.food_analyses a where a.id=analysis_id and a.user_id=(select auth.uid()))) with check(exists(select 1 from public.food_analyses a where a.id=analysis_id and a.user_id=(select auth.uid())));
create policy "Users manage own favorites" on public.favorite_foods for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy "Favorites reference only accessible foods" on public.favorite_foods as restrictive for all to authenticated
  using ((custom_food_id is null or exists(select 1 from public.custom_foods c where c.id=custom_food_id and c.user_id=(select auth.uid()))) and (food_id is null or exists(select 1 from public.foods f where f.id=food_id and f.is_verified)))
  with check ((custom_food_id is null or exists(select 1 from public.custom_foods c where c.id=custom_food_id and c.user_id=(select auth.uid()))) and (food_id is null or exists(select 1 from public.foods f where f.id=food_id and f.is_verified)));
create policy "Users manage own recipes" on public.recipes for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy "Users manage items in own recipes" on public.recipe_items for all to authenticated using(exists(select 1 from public.recipes r where r.id=recipe_id and r.user_id=(select auth.uid()))) with check(exists(select 1 from public.recipes r where r.id=recipe_id and r.user_id=(select auth.uid())));
create policy "Recipe items reference only accessible foods" on public.recipe_items as restrictive for all to authenticated
  using ((custom_food_id is null or exists(select 1 from public.custom_foods c where c.id=custom_food_id and c.user_id=(select auth.uid()))) and (food_id is null or exists(select 1 from public.foods f where f.id=food_id and f.is_verified)))
  with check ((custom_food_id is null or exists(select 1 from public.custom_foods c where c.id=custom_food_id and c.user_id=(select auth.uid()))) and (food_id is null or exists(select 1 from public.foods f where f.id=food_id and f.is_verified)));
create policy "Users manage own conversations" on public.ai_conversations for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy "Users manage own messages" on public.ai_messages for all to authenticated using(exists(select 1 from public.ai_conversations c where c.id=conversation_id and c.user_id=(select auth.uid()))) with check(exists(select 1 from public.ai_conversations c where c.id=conversation_id and c.user_id=(select auth.uid())));
grant usage on schema public to authenticated;
grant select on public.foods,public.food_nutrients to authenticated;
grant select,insert on public.user_goals to authenticated;
grant select,insert,update,delete on public.profiles,public.custom_foods,public.meals,public.meal_items,public.favorite_foods,public.recipes,public.recipe_items,public.food_analyses,public.food_analysis_items,public.ai_conversations,public.ai_messages to authenticated;
