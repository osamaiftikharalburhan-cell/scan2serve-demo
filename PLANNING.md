# Scan2Serve — Final Planning Document

> Multi-tenant QR ordering SaaS · Next.js (App Router) + Supabase · Planning only, no code yet.
> This file combines `1-database.md`, `2-routes.md`, `3-owner-dashboard.md` and `4-qr-realtime.md`. Where they differ, this file and the latest step win.

## Contents
1. [Part 1 — Database Schema](#part-1--database-schema)
2. [Part 2 — App Router Structure](#part-2--app-router-structure)
3. [Part 3 — Owner Dashboard](#part-3--owner-dashboard)
4. [Part 4 — QR System & Realtime](#part-4--qr-system--realtime)

## Key decisions at a glance
| Topic | Decision |
|---|---|
| Tenancy | Every row has `restaurant_id`; composite FKs block cross-tenant links; RLS via `is_member()` / `has_role()` helpers |
| Users | Owner/manager/staff/kitchen log in with Supabase Auth (`restaurant_members`); customers stay anonymous |
| Customer routes | `/r/[slug]?table=N` menu + cart, `/r/[slug]/order/[token]` tracking |
| Staff routes | `/r/[slug]/kitchen` live board, `/admin/[slug]/*` owner dashboard |
| Stock-out | `menu_items.is_available`; one-tap optimistic toggle; hidden from customers by query **and** RLS; live removal via Broadcast; `place_order` rejects it as a final check |
| Ordering | Anon never writes to tables directly; the `place_order` RPC validates items, takes prices from the DB, rate-limits per table, and inserts `orders` + `order_items` in one transaction |
| QR | Permanent static URL `/r/<slug>?table=<n>`, no expiry; table numbers unique per restaurant, unlimited count; slug locked |
| QR output | `qrcode.react` (SVG preview, canvas PNG); `jsPDF` A4 sheet, 6 or 4 per page, with restaurant name + TABLE N, built in the browser |
| Kitchen realtime | `postgres_changes` on `orders` filtered by `branch_id`, protected by RLS; resync on (re)subscribe; polling fallback; chime + wake lock |
| Customer realtime | Broadcast channels `order:<public_token>` (status) and `menu:<restaurant_id>` (availability), fed by DB triggers |
| Sales | `get_daily_sales()` RPC, restaurant timezone (default Asia/Karachi), cancelled orders excluded |

---

## Part 1 — Database Schema

### 1. Overview
- **Tenant = restaurant.** Every tenant-owned row has a `restaurant_id uuid NOT NULL`, including child tables such as `order_items`. Adding the column to children means each RLS check reads only its own row and never needs a join.
- **Users:** the restaurant owner and staff log in with Supabase Auth (`auth.users`). Customers scanning a QR code are **anonymous** (`anon` role), with no login.
- **Primary keys:** `uuid DEFAULT gen_random_uuid()`. **Timestamps:** `timestamptz DEFAULT now()`. A trigger keeps `updated_at` current.
- **Money:** `numeric(10,2)`, never float.

### 2. Enums
- `member_role`: `owner`, `manager`, `staff`, `kitchen`
- `order_status`: `pending`, `accepted`, `preparing`, `ready`, `served`, `completed`, `cancelled`
- `payment_status`: `unpaid`, `paid`, `refunded`

### 3. Tables

**restaurant_members** (supporting table, needed for RLS and staff access)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK → restaurants.id ON DELETE CASCADE | |
| user_id | uuid FK → auth.users.id ON DELETE CASCADE | |
| role | member_role NOT NULL DEFAULT 'staff' | |
| branch_id | uuid NULL FK → branches.id | NULL = all branches |
| created_at | timestamptz | |
| | UNIQUE (restaurant_id, user_id) | |

**restaurants**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| owner_id | uuid FK → auth.users.id | the user who created it |
| name | text NOT NULL | |
| slug | text UNIQUE NOT NULL | used in public URLs |
| logo_url | text | Supabase Storage path |
| currency | char(3) DEFAULT 'PKR' | ISO code |
| timezone | text DEFAULT 'Asia/Karachi' | |
| tax_rate | numeric(5,2) DEFAULT 0 | percent |
| is_active | boolean DEFAULT true | for subscription suspension |
| created_at / updated_at | timestamptz | |

**branches**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid NOT NULL FK → restaurants.id ON DELETE CASCADE | |
| name | text NOT NULL | |
| address | text | |
| phone | text | |
| is_active | boolean DEFAULT true | |
| created_at / updated_at | timestamptz | |
| | UNIQUE (id, restaurant_id) | target for composite FKs |

**tables**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid NOT NULL | |
| branch_id | uuid NOT NULL | FK (branch_id, restaurant_id) → branches(id, restaurant_id) |
| table_number | int NOT NULL CHECK (table_number > 0) | shown as "Table 1"; the QR is the permanent URL `/r/<slug>?table=1` (no token, never expires). No upper limit on tables |
| label | text | optional display override, e.g. "Patio 3"; default "Table <n>" |
| seats | smallint | |
| is_active | boolean DEFAULT true | |
| created_at / updated_at | timestamptz | |
| | UNIQUE (restaurant_id, table_number) | table numbers are unique per restaurant, so `slug + table` is enough to find the table |

**menu_categories**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid NOT NULL FK → restaurants.id | |
| branch_id | uuid NULL | NULL = shared by all branches; composite FK as above |
| name | text NOT NULL | |
| description | text | |
| sort_order | int DEFAULT 0 | |
| is_active | boolean DEFAULT true | hides the whole category |
| created_at / updated_at | timestamptz | |
| | UNIQUE (id, restaurant_id) | |

**menu_items**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid NOT NULL | |
| category_id | uuid NOT NULL | FK (category_id, restaurant_id) → menu_categories(id, restaurant_id) |
| name | text NOT NULL | |
| description | text | |
| price | numeric(10,2) NOT NULL CHECK (price >= 0) | |
| image_url | text | |
| **is_available** | **boolean NOT NULL DEFAULT true** | **stock-out toggle: when false the item is hidden from customers and cannot be ordered; staff still see it in admin and kitchen views** |
| is_active | boolean DEFAULT true | false = removed from the menu entirely |
| tags | text[] | e.g. {spicy, veg} |
| sort_order | int DEFAULT 0 | |
| created_at / updated_at | timestamptz | |
| | UNIQUE (id, restaurant_id) | |

**orders**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid NOT NULL | |
| branch_id | uuid NOT NULL | composite FK → branches |
| table_id | uuid NULL FK → tables.id ON DELETE SET NULL | |
| order_number | int NOT NULL | daily running number per branch, for display to kitchen and customer |
| public_token | uuid UNIQUE DEFAULT gen_random_uuid() | lets the anonymous customer track the order |
| status | order_status DEFAULT 'pending' | |
| payment_status | payment_status DEFAULT 'unpaid' | |
| customer_name | text | optional |
| notes | text | |
| subtotal | numeric(10,2) NOT NULL | computed by the server, never sent by the client |
| tax | numeric(10,2) NOT NULL DEFAULT 0 | |
| total | numeric(10,2) NOT NULL | |
| created_at / updated_at | timestamptz | |
| | UNIQUE (id, restaurant_id) | |

**order_items**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid NOT NULL | added to this child table so RLS needs no join |
| order_id | uuid NOT NULL | FK (order_id, restaurant_id) → orders ON DELETE CASCADE |
| menu_item_id | uuid NULL FK → menu_items.id ON DELETE SET NULL | |
| item_name | text NOT NULL | **copy** of the name at order time |
| unit_price | numeric(10,2) NOT NULL | **copy** of the price at order time |
| quantity | int NOT NULL CHECK (quantity > 0) | |
| line_total | numeric(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED | |
| notes | text | e.g. "no onions" |
| created_at | timestamptz | |

### 4. Indexes
- `restaurant_id` on every tenant table.
- `orders (branch_id, status, created_at DESC)`, for the kitchen dashboard.
- `menu_items (category_id, sort_order)` and `menu_categories (restaurant_id, sort_order)`.
- `tables (restaurant_id, table_number)` (already indexed by its UNIQUE constraint).

### 5. How multi-tenancy works
1. Every row carries `restaurant_id`. **Composite FKs** (`(x_id, restaurant_id)` → parent `(id, restaurant_id)`) make it impossible for a child row to point at another tenant's parent row. For example, an item in restaurant A cannot be placed in a category owned by restaurant B.
2. Isolation is enforced **in the database by RLS**, not only in the frontend. The app also filters with `.eq('restaurant_id', currentRestaurantId)` for speed and clarity, but if that filter is missing, data still cannot leak.
3. The helper functions are `SECURITY DEFINER`, `STABLE`, and use `search_path = public`:
   - `is_member(rid uuid) → boolean`: `EXISTS (SELECT 1 FROM restaurant_members WHERE restaurant_id = rid AND user_id = auth.uid())`
   - `has_role(rid uuid, roles member_role[]) → boolean`
4. When a restaurant is created, a trigger adds the creator to `restaurant_members` as `owner`.

### 6. RLS policies
RLS is enabled on **all** tables. Rules for logged-in users (`authenticated`):

| table | SELECT | INSERT / UPDATE | DELETE |
|---|---|---|---|
| restaurants | `is_member(id)` | INSERT: `owner_id = auth.uid()`; UPDATE: `has_role(id, {owner,manager})` | owner only |
| restaurant_members | `is_member(restaurant_id)` | owner/manager | owner/manager |
| branches, tables, menu_categories | `is_member(restaurant_id)` | owner/manager | owner/manager |
| menu_items | `is_member(restaurant_id)` | owner/manager; **staff/kitchen may UPDATE `is_available` only** (enforced by a column-level GRANT or an RPC `toggle_item_availability`) | owner/manager |
| orders | `is_member(restaurant_id)` (if the member has a `branch_id`, also `branch_id = member.branch_id`) | UPDATE `status` / `payment_status`: any member; no direct INSERT | owner/manager |
| order_items | `is_member(restaurant_id)` | no direct INSERT/UPDATE | via cascade |

Rules for customers (`anon`):
- **Menu read:** SELECT on `restaurants`, `branches`, `menu_categories`, and `menu_items` where `is_active = true` (and the parent restaurant is active). For `menu_items` the anon policy also requires `is_available = true`, so out-of-stock items are never sent to customers.
- **`tables`: no direct SELECT**, so tables cannot be enumerated. Customers use the RPC `resolve_table(slug, table_number)`, which returns the restaurant, branch, and table if that table exists and is active.
- **`orders` / `order_items`: no direct access.**
  - `place_order(slug text, table_number int, items jsonb, customer_name text, notes text)` is a SECURITY DEFINER RPC. It validates the table, rate-limits per table (see Part 4 (QR & Realtime)), rejects items that are `is_available = false`, inactive, or from another restaurant, takes prices from `menu_items` rather than from the client, computes the totals, assigns `order_number`, inserts the order and its items in one transaction, and returns `public_token`.
  - `get_order_status(public_token uuid)` returns the order's status and items, for the customer's tracking screen.
- **Realtime:** the kitchen and staff subscribe to `orders` filtered by `branch_id`. Realtime respects RLS, so staff receive only their own tenant's events. The customer's tracking screen listens on a Broadcast channel keyed by `public_token`, falling back to polling `get_order_status`. Full design: Part 4 (QR & Realtime).

### 7. Out of scope for Step 1
- Subscriptions/billing, item modifiers/variants, payments integration, and analytics tables. These are left for later steps.

---

## Part 2 — App Router Structure

### 1. Routes at a glance

| Route | Who | Auth | Rendering | Purpose |
|---|---|---|---|---|
| `/r/[slug]?table=<n>` | Customer (anon) | None | Server Component + client cart | Browse menu, add to cart, place order |
| `/r/[slug]/order/[token]` | Customer (anon) | None (`public_token`) | Client, polling | Track order status after placing |
| `/r/[slug]/kitchen` | Kitchen / staff | Logged in + member | Client, Supabase Realtime | Live pending/active orders board |
| `/admin/[slug]` | Owner / manager | Logged in + `owner`/`manager` | Server + client islands | Overview dashboard |
| `/admin/[slug]/menu` | Owner / manager | same | Server + client | Category & item CRUD, availability toggle |
| `/admin/[slug]/tables` | Owner / manager | same | Server + client | Tables + QR code generation |
| `/admin/[slug]/orders` | Owner / manager | same | Server | Order history |
| `/admin/[slug]/settings` | Owner | same | Server + client | Restaurant info, branches, staff |
| `/login` | Staff / owner | — | Client | Supabase email/password or magic link |
| `/onboarding` | New owner | Logged in | Client | Create first restaurant (+ owner membership) |

**QR URL format (permanent, static):** `https://scan2serve.app/r/<slug>?table=1`. The `slug` picks the restaurant and `table` is the table number (checked server-side by `resolve_table(slug, table)`). The QR never expires and never needs reprinting. If `table` is missing or unknown, the menu is shown read-only with "Scan the QR on your table to order". See Part 4 (QR & Realtime).

### 2. Folder & file tree

```
scan2serve/
├── middleware.ts                      # refresh Supabase session; guard /admin/* and /r/*/kitchen
├── app/
│   ├── layout.tsx                     # root <html>, fonts, Tailwind globals, <Toaster/>
│   ├── globals.css
│   ├── page.tsx                       # marketing landing page
│   ├── not-found.tsx
│   │
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── onboarding/page.tsx
│   │   └── auth/callback/route.ts     # Supabase OAuth / magic-link code exchange
│   │
│   ├── r/
│   │   └── [slug]/
│   │       ├── layout.tsx             # fetch restaurant by slug (404 if inactive), header w/ logo
│   │       ├── page.tsx               # CUSTOMER MENU (server): categories + available items
│   │       ├── loading.tsx            # menu skeleton
│   │       ├── actions.ts             # 'use server' placeOrder() → rpc('place_order')
│   │       ├── order/
│   │       │   └── [token]/page.tsx   # order tracking via rpc('get_order_status')
│   │       └── kitchen/
│   │           ├── layout.tsx         # requireMember(slug) — redirect to /login otherwise
│   │           ├── page.tsx           # initial orders (server) → <KitchenBoard/>
│   │           └── actions.ts         # updateOrderStatus(), toggleAvailability()
│   │
│   └── admin/
│       └── [slug]/
│           ├── layout.tsx             # requireRole(slug, ['owner','manager']); sidebar nav
│           ├── page.tsx               # overview: today's orders, revenue, out-of-stock count
│           ├── menu/
│           │   ├── page.tsx           # categories + items list with availability switches
│           │   ├── actions.ts         # create/update/delete category & item, toggleAvailability, reorder
│           │   ├── new/page.tsx       # new item form
│           │   └── [itemId]/page.tsx  # edit item form
│           ├── tables/
│           │   ├── page.tsx           # tables per branch, QR preview/download/print
│           │   └── actions.ts         # create/delete tables
│           ├── orders/
│           │   └── page.tsx           # filterable history (date, branch, status)
│           └── settings/
│               ├── page.tsx           # restaurant profile, logo upload, tax, currency
│               ├── branches/page.tsx
│               ├── staff/page.tsx     # invite / remove members, set role & branch
│               └── actions.ts
│
├── components/
│   ├── ui/                            # primitives (shadcn/ui style)
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── textarea.tsx
│   │   ├── switch.tsx
│   │   ├── dialog.tsx
│   │   ├── sheet.tsx                  # slide-up cart drawer
│   │   ├── badge.tsx
│   │   ├── card.tsx
│   │   ├── select.tsx
│   │   ├── skeleton.tsx
│   │   └── toaster.tsx
│   ├── customer/
│   │   ├── menu-header.tsx            # logo, name, table label
│   │   ├── category-tabs.tsx          # sticky horizontal category nav
│   │   ├── menu-section.tsx           # one category's items
│   │   ├── menu-item-card.tsx         # image, name, price, "Add" button
│   │   ├── item-detail-dialog.tsx     # quantity + notes before adding
│   │   ├── cart-provider.tsx          # 'use client' context; persisted per slug+table in localStorage
│   │   ├── cart-button.tsx            # floating "View cart (3) · Rs 1,250"
│   │   ├── cart-sheet.tsx             # line items, qty +/-, name, notes, Place order
│   │   └── order-status-tracker.tsx   # step indicator, polls get_order_status
│   ├── kitchen/
│   │   ├── kitchen-board.tsx          # 'use client'; Realtime subscription + columns by status
│   │   ├── order-card.tsx             # table, number, age timer, items, action buttons
│   │   ├── order-status-actions.tsx   # Accept → Preparing → Ready → Served
│   │   ├── new-order-alert.tsx        # sound + flash on INSERT
│   │   └── availability-quick-list.tsx# kitchen can mark items out of stock
│   ├── admin/
│   │   ├── sidebar.tsx
│   │   ├── stats-cards.tsx
│   │   ├── category-list.tsx          # drag to reorder
│   │   ├── category-form.tsx
│   │   ├── item-table.tsx             # rows with inline <AvailabilityToggle/>
│   │   ├── item-form.tsx              # name, desc, price, category, image, tags
│   │   ├── availability-toggle.tsx    # optimistic switch → toggleAvailability()
│   │   ├── image-upload.tsx           # Supabase Storage upload
│   │   ├── table-list.tsx
│   │   ├── qr-card.tsx                # QR preview + download/print
│   │   ├── orders-table.tsx
│   │   ├── branch-form.tsx
│   │   └── staff-list.tsx
│   └── shared/
│       ├── price.tsx                  # formats with restaurant currency
│       ├── empty-state.tsx
│       └── confirm-dialog.tsx
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts                  # createBrowserClient (anon key) — client components
│   │   ├── server.ts                  # createServerClient with cookies — RSC / server actions
│   │   ├── middleware.ts              # updateSession() used by root middleware.ts
│   │   └── admin.ts                   # service-role client (server-only; rare, e.g. invites)
│   ├── auth/
│   │   ├── get-user.ts                # current user or null
│   │   └── guards.ts                  # requireMember(slug), requireRole(slug, roles)
│   ├── data/                          # server-only query functions (one place for SQL shape)
│   │   ├── restaurants.ts             # getRestaurantBySlug()
│   │   ├── menu.ts                    # getPublicMenu(), getAdminMenu()
│   │   ├── tables.ts                  # resolveTable(slug, tableNumber), listTables()
│   │   └── orders.ts                  # getActiveOrders(branchId), getOrderHistory(), getOrderStatus()
│   ├── realtime/
│   │   └── use-orders-channel.ts      # hook: subscribe to orders INSERT/UPDATE by branch_id
│   ├── validation/
│   │   ├── menu.ts                    # zod schemas: categorySchema, itemSchema
│   │   └── order.ts                   # zod: placeOrderSchema (items[], qty>0, notes length)
│   ├── types/
│   │   ├── database.ts                # generated: `supabase gen types typescript`
│   │   └── index.ts                   # app types: MenuItem, Order, CartLine, OrderStatus
│   ├── qr.ts                          # buildTableUrl(slug, tableNumber) — QR rendered by qrcode.react
│   ├── format.ts                      # formatPrice(), timeAgo()
│   └── utils.ts                       # cn() class merger, misc helpers
│
└── supabase/                          # (Step 3+) migrations, seed.sql, config
```

### 3. Route details

#### 3.1 `/r/[slug]` — Customer page
- **`layout.tsx`** loads the restaurant with `getRestaurantBySlug(slug)` and calls `notFound()` if it doesn't exist or `is_active = false`. It wraps children in `<CartProvider slug tableToken>`.
- **`page.tsx` (Server Component)**:
  1. If `searchParams.table` is present, calls `resolveTable(slug, table)` and gets the branch + table (unknown or inactive table → read-only mode).
  2. `getPublicMenu(restaurantId, branchId)`:
     ```
     menu_categories: is_active = true, branch_id IS NULL OR = branchId, order by sort_order
     menu_items:      is_active = true AND is_available = true, order by sort_order
     ```
     **Out-of-stock items are hidden at two levels:** the query filters `is_available = true`, and the anon RLS policy on `menu_items` also requires it, so they never reach the browser. Empty categories are dropped.
  3. Renders `<MenuHeader/>`, `<CategoryTabs/>`, `<MenuSection/>` → `<MenuItemCard/>`, plus `<CartButton/>` and `<CartSheet/>` (client).
- **Cart** lives on the client only (`cart-provider.tsx`) and is kept in `localStorage` under `cart:<slug>:<tableToken>`. It stores `menu_item_id`, qty, and notes; prices shown come from the menu but are **not** trusted at checkout.
- **Place order** → server action `placeOrder()` in `r/[slug]/actions.ts`:
  1. Validates with `placeOrderSchema` (zod).
  2. Calls `supabase.rpc('place_order', { slug, table_number, items, customer_name, notes })`. The RPC re-checks `is_available`, recalculates prices, and inserts the order.
  3. If an item went out of stock while it was in the cart, the RPC errors with the item ids. The action returns them, and the cart removes those lines and shows "X is no longer available".
  4. On success: clears the cart and `redirect('/r/[slug]/order/[public_token]')`.
- **Freshness:** `export const revalidate = 0` (or `dynamic = 'force-dynamic'`) so a stock-out toggle shows up on the next page load. An optional Realtime subscription on `menu_items` UPDATE for the restaurant can remove an item from an open menu straight away.

#### 3.2 `/r/[slug]/kitchen` — Kitchen dashboard
- **`layout.tsx`** calls `requireMember(slug)`. If there's no session it redirects to `/login?next=/r/<slug>/kitchen`; a user who isn't a member gets a 403 page. If the member has a `branch_id`, the board is locked to that branch; otherwise a branch selector is shown.
- **`page.tsx` (server)** runs `getActiveOrders(branchId)`, which returns orders with `status IN ('pending','accepted','preparing','ready')` plus their `order_items`, oldest first, and passes them as `initialOrders` to `<KitchenBoard/>`.
- **`<KitchenBoard/>` (client)** uses `useOrdersChannel(branchId)`:
  ```
  supabase.channel(`orders:${branchId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, onInsert)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, onUpdate)
    .subscribe()
  ```
  - On INSERT it fetches that order's `order_items` (the Realtime payload only contains the order row), adds the card to the **Pending** column, and plays the `<NewOrderAlert/>` sound.
  - On UPDATE it moves the card to its new status column, and removes it when the status is `served`, `completed`, or `cancelled`.
  - On reconnect or tab focus it refetches `getActiveOrders` so no events are lost.
  - RLS also applies to Realtime events, so staff only ever receive their own restaurant's orders.
- **Columns:** Pending → Accepted/Preparing → Ready. `<OrderStatusActions/>` calls `updateOrderStatus(orderId, next)`, and the UI updates optimistically.
- **`<AvailabilityQuickList/>`** lets kitchen staff mark items out of stock (`toggleAvailability`), which is allowed for the staff/kitchen roles in Step 1 RLS.
- Realtime has to be enabled for the `orders` table (`alter publication supabase_realtime add table orders`).

#### 3.3 `/admin/[slug]` — Owner dashboard
- **`layout.tsx`** calls `requireRole(slug, ['owner','manager'])` and renders `<Sidebar/>` with links to Overview, Menu, Tables, Orders, Settings, and Kitchen (`/r/[slug]/kitchen`).
- **Overview (`page.tsx`)** shows today's order count, revenue, active orders, and the out-of-stock items with a one-click "Back in stock".
- **Menu (`menu/`)**, full CRUD:
  - Categories can be created, renamed, deleted (only if empty, or by cascading confirmation), reordered by drag (`sort_order`), and toggled with `is_active`.
  - Items can be created and edited through `<ItemForm/>` (zod `itemSchema`; image uploaded to Storage at `menu/<restaurant_id>/<uuid>.webp`). Deleting an item is a soft delete (`is_active = false`), so old orders keep their history; a hard delete is also possible because `order_items` stores copies of the name and price.
  - **Availability toggle:** `<AvailabilityToggle/>` on every row calls `toggleAvailability(itemId, value)`, updates optimistically, and then calls `revalidatePath('/r/[slug]')`.
  - Admin queries do **not** filter on `is_available`. Out-of-stock items stay visible here with an "Out of stock" badge.
- **Tables** lets the owner add or remove tables per branch, and download QR codes as PNG or as a printable A4 PDF, generated in the browser with `qrcode.react` + jsPDF (`lib/qr.ts`, `lib/pdf/qr-sheet.ts`).
- **Orders** shows the order history with filters. **Settings** covers the restaurant profile, branches, and staff (invite by email, set role and branch).

### 4. Server actions (mutations)

| File | Action | Supabase call | Revalidates |
|---|---|---|---|
| `r/[slug]/actions.ts` | `placeOrder` | `rpc('place_order')` | — (redirects) |
| `r/[slug]/kitchen/actions.ts` | `updateOrderStatus` | `orders.update({status})` | — (Realtime) |
| `r/[slug]/kitchen/actions.ts` | `toggleAvailability` | `menu_items.update({is_available})` | `/r/[slug]`, `/admin/[slug]/menu` |
| `admin/[slug]/menu/actions.ts` | `createCategory` / `updateCategory` / `deleteCategory` / `reorderCategories` | `menu_categories.*` | `/r/[slug]`, `/admin/[slug]/menu` |
| `admin/[slug]/menu/actions.ts` | `createItem` / `updateItem` / `deleteItem` / `toggleAvailability` | `menu_items.*` | same |
| `admin/[slug]/tables/actions.ts` | `createTable` / `createTables` / `deleteTable` | `tables.*` | `/admin/[slug]/tables` |
| `admin/[slug]/settings/actions.ts` | `updateRestaurant` / branch CRUD / `inviteStaff` / `removeStaff` | various | `/admin/[slug]/settings` |

Every action:
1. Validates its input with zod.
2. Resolves `slug → restaurant_id` on the server and never trusts a `restaurant_id` sent by the client.
3. Uses the cookie-based server client, so RLS runs as the logged-in user.
4. Returns `{ ok, error }`.

The service-role client is used only for staff invites.

### 5. Middleware & access control
- `middleware.ts` calls `updateSession()` (from `lib/supabase/middleware.ts`) to refresh the auth cookie on every request.
- **Matcher:** `/admin/:path*` and `/r/:slug/kitchen/:path*` redirect to `/login` when there's no session. Membership and role checks happen in the layouts (`lib/auth/guards.ts`), because they need the database. RLS is the final safety net.
- Customer routes (`/r/[slug]`, `/r/[slug]/order/*`) are public.

### 6. Out of scope for Step 2
- Payments, i18n/RTL, PWA/offline mode, push notifications, and analytics charts.

---

## Part 3 — Owner Dashboard

### 0. Dashboard layout

```
┌──────────────┬───────────────────────────────────────────────────────┐
│ Scan2Serve   │  Today · Wed 22 Oct          Sales Rs 48,350 · 37 orders│
│              ├───────────────────────────────────────────────────────┤
│ ▸ Overview   │                                                       │
│ ▸ Menu       │                (page content)                         │
│ ▸ Tables/QR  │                                                       │
│ ▸ Orders     │                                                       │
│ ▸ Settings   │                                                       │
│ ▸ Kitchen ↗  │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘
```
- On a phone the sidebar collapses into a bottom tab bar: **Menu · Tables · Orders · More**. Owners will mostly use the dashboard on a phone at the counter.
- A header strip shows **today's sales and order count** on every admin page (see §3).

---

### 1. Menu Management — `/admin/[slug]/menu`

#### 1.1 Menu list screen
```
[ Search items…            ]  [All ▾] [In stock] [Out of stock (2)]   [+ Add item]

KARAHI                                                        [+ item] [⋮]
 ┌────┐ Mutton Karahi (Full)          Rs 3,200     [■■■ ON ]   [Edit] [🗑]
 └────┘
 ┌────┐ Chicken Karahi (Half)         Rs 1,100     [ OFF □□]   [Edit] [🗑]
 └────┘  OUT OF STOCK
BBQ                                                           [+ item] [⋮]
 ...
```
- Items are grouped by category in `sort_order`. Categories can be reordered by dragging (`reorderCategories`).
- **Search** is instant and runs on the client over the items already loaded, so the owner can type "mutt" to find Mutton Karahi straight away.
- **Filter chips** show In stock / Out of stock, with the out-of-stock count in the chip.
- Data comes from `getAdminMenu(restaurantId)`. It returns **all** active items, including `is_available = false` ones (the admin view never filters on availability).

#### 1.2 Add New Item — `/admin/[slug]/menu/new` (also a dialog from "+ item")
| Field | Input | Validation (`itemSchema`, zod) | DB column |
|---|---|---|---|
| Name | text | required, 2–80 chars, trimmed | `name` |
| Price | number input (numeric keypad on mobile) | required, ≥ 0, ≤ 999,999, max 2 decimals | `price numeric(10,2)` |
| Category | select + "+ New category" inline option | required, must belong to this restaurant | `category_id` |
| Image | file picker / camera | optional; jpg/png/webp/heic; ≤ 5 MB before compression | `image_url` |
| Description | textarea | optional, ≤ 300 chars | `description` |
| Available now | switch (default ON) | — | `is_available` |

**Image upload flow:**
1. The image is compressed in the browser: resized to max 800 px wide and converted to WebP at quality 0.8 (`browser-image-compression`), which gives roughly 50–120 KB.
2. It's uploaded straight from the browser to the Supabase Storage bucket `menu-images` at `<restaurant_id>/<uuid>.webp`.
3. The form saves only the **storage path**. The customer page builds the public URL, using Supabase image transforms for thumbnails.
4. **Storage policies:** the bucket is publicly readable; INSERT/UPDATE/DELETE are allowed only when `is_member(restaurant_id)` with role owner/manager, where `restaurant_id` is the first folder of the object name.
5. When an image is replaced or an item deleted, the old object is removed by the server action. If that fails, nothing breaks; a cleanup job can delete leftovers later.

**Server action** `createItem(slug, formData)`:
1. Validates with zod.
2. Resolves `slug → restaurant_id`.
3. Checks that `category_id` belongs to that restaurant. The composite FK enforces this too.
4. Inserts the item with `sort_order = max + 1` within its category.
5. Runs `revalidatePath('/admin/[slug]/menu')` and `revalidatePath('/r/[slug]')`.

#### 1.3 Edit Item — `/admin/[slug]/menu/[itemId]`
- Uses the same `<ItemForm/>`, pre-filled with the item's current values. `updateItem(slug, itemId, formData)` runs the same validation and revalidation.
- **Price changes don't affect past orders**, because `order_items` stores `unit_price` and `item_name` as copies taken at order time.
- Moving an item to another category is just a change of `category_id`.

#### 1.4 Delete Item
- The trash icon opens a confirm dialog: "Delete *Mutton Karahi*? It will disappear from the menu."
- `deleteItem` does a **soft delete** (`is_active = false`). The item disappears from both admin and customer views, but order history stays intact.
- A **"Undo"** toast is shown for 5 s, which sets `is_active = true` again.
- Deleting a category is only allowed when it has no active items. Otherwise the dialog says "Move or delete its N items first".

#### 1.5 SUPER FAST availability toggle (stock-out)

**Goal:** the kitchen runs out of Mutton Karahi, the owner taps once, and new customers no longer see it. The switch must feel instant (< 100 ms), work with one thumb, and never need a page reload.

**UI — `<AvailabilityToggle itemId initial />`**
- It's a large switch (44×24 px minimum touch target) on every row, with no confirm dialog.
- When OFF, the row dims and gets a red **OUT OF STOCK** badge, and it moves into the "Out of stock" filter count.
- The same component appears in three places:
  - the Menu list,
  - the Overview page ("Out of stock now" card with **Back in stock** buttons),
  - the kitchen's `<AvailabilityQuickList/>`.

**Flow**
```
tap
 └─▶ setOptimistic(!value)            // UI flips immediately (React useOptimistic)
     └─▶ server action toggleAvailability(slug, itemId, next)
           UPDATE menu_items SET is_available = $next
           WHERE id = $itemId AND restaurant_id = $rid      -- RLS also enforces
           RETURNING is_available
         ├─ ok    → keep; revalidatePath('/r/[slug]')        // next customer load hides it
         └─ error → revert switch + toast "Couldn't update, try again"
```
- It's one column update on one row by primary key, so it is the cheapest write in the system.
- **Fast taps:** each item keeps a request counter, and only the latest response is applied, so double-taps can't leave the switch in the wrong state.
- **Customers who already have the menu open:** the customer page listens on the Broadcast channel `menu:<restaurant_id>`, fed by a database trigger on `is_available`. When `is_available` goes false, the card is removed from the open menu and from the cart, with a notice: "Mutton Karahi just sold out". (`postgres_changes` would not work here; see Part 4 (QR & Realtime) §2.6.)
- Customers on a slow connection may never get that live update. They're still covered, because the `place_order` RPC rejects unavailable items (see Part 1 (Database) and Part 2 (Routes) §3.1).
- **What "customers will not see it" means:** the anon RLS policy and the `getPublicMenu` query both require `is_available = true`, so the item never reaches the browser.
- **Bulk actions** (on the "Out of stock" filter):
  - **"Mark all back in stock"**, for the start of a new day.
  - An optional setting **"Reset stock every morning at 6 AM"**, done by a `pg_cron` job that sets `is_available = true` for that restaurant.
- **Audit (optional, later):** a `menu_item_events` table recording who toggled what and when.

---

### 2. QR Code Management — `/admin/[slug]/tables`

#### 2.1 Tables list
```
[+ Add table]  [+ Add multiple…]                 [⬇ Download all QRs (PDF)]

 ☐  Table 1    [QR]   4 seats   [⬇ PNG] [🗑]
 ☐  Table 2    [QR]   2 seats   [⬇ PNG] [🗑]
 ...
                       [⬇ Download selected (PDF)]
```
- Tables are sorted by `table_number`. **There is no limit on the number of tables.** The list is paginated or virtualised past 100 rows and has a "Jump to table #" box.
- Each row shows a small live QR preview, rendered by `<QRCodeSVG>` from **qrcode.react**.

#### 2.2 Add Table
- **"Add table"** creates the next number (`max(table_number) + 1`, starting at 1), named "Table N". Nothing needs to be typed.
- **"Add multiple…"** opens a dialog: "Add [10] tables" creates, for example, Table 5 to Table 14 in one insert. The dialog accepts any count; inserts are batched in chunks of 500.
- The number can be edited, but it must be unique per restaurant: `UNIQUE (restaurant_id, table_number)`. If it's taken, the form shows "Table 3 already exists".
- **Seats** and **label override** (e.g. "Patio 3") are optional.
- If the restaurant has several branches, there is a branch selector; numbers stay unique across the whole restaurant (see Part 4 (QR & Realtime) §1.2).

#### 2.3 QR code contents
```
https://scan2serve.app/r/<slug>?table=1
```
- The QR holds a **permanent, static URL with no token and no expiry**. It's built from the slug and the table number, so it never changes and never needs reprinting.
- The URL is built in a single place, `lib/qr.ts → buildTableUrl(slug, tableNumber)`, using `NEXT_PUBLIC_APP_URL`.
- **QR settings:** error-correction level **M**, quiet zone of 4 modules, black on white.
- **Delete table** shows a confirm dialog. Past orders keep `table_id = NULL` (`ON DELETE SET NULL`), so sales history is unaffected. A deleted table's printed QR opens the menu in read-only mode.
- **⬇ PNG** renders a 1024 px `<QRCodeCanvas>` off-screen and downloads it with `canvas.toDataURL('image/png')`.
- With a static URL, anyone who knows it could order for a table remotely. The protections against that are described in Part 4 (QR & Realtime) §1.4.

#### 2.4 Download all QRs as a printable PDF
- The PDF is generated **in the browser** with **jsPDF**, using QR images from **qrcode.react**. There is no server endpoint, and the file downloads as `<slug>-table-qrs.pdf`.
- The table list comes from the page's already-loaded, RLS-protected data, so an owner can only ever print their own tables.
- The full generation algorithm is in Part 4 (QR & Realtime) §1.5.

**Page layout (A4 = 210 × 297 mm, 10 mm margins)**

| Option | Grid | Cell size | QR size | Best for |
|---|---|---|---|---|
| 6 per page (default) | 2 cols × 3 rows | 95 × 92 mm | 60 × 60 mm | Table tents / stickers |
| 4 per page | 2 cols × 2 rows | 95 × 138 mm | 80 × 80 mm | Larger stand-up cards |

```
┌──────────────────────── A4 ────────────────────────┐
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐       │
│   [logo] Karachi BBQ     [logo] Karachi BBQ         │
│ │    ┌─────────┐    │ │    ┌─────────┐    │       │
│      │  QR     │           │  QR     │              │
│ │    └─────────┘    │ │    └─────────┘    │       │
│       TABLE 1               TABLE 2                 │
│ │  Scan to view menu │ │  Scan to view menu │       │
│      & order               & order                  │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘       │
│   (row 2: Table 3, Table 4)                         │
│   (row 3: Table 5, Table 6)                         │
│                                   page 1 / 3        │
└─────────────────────────────────────────────────────┘
```
- **Each cell contains:**
  - the restaurant name (and logo if one is set);
  - the QR code;
  - **"TABLE N"** in large bold type (28 pt for the 6-up layout, 36 pt for 4-up);
  - "Scan to view menu & order" (an optional Urdu line can come later);
  - a tiny short URL under the QR as a fallback.
- **Dashed cut lines** run around each cell. Tables are filled in order of `table_number`, page by page, with a page number in the footer.
- **Fonts:** Helvetica is built in, so no font files are needed for English. Urdu later would need an embedded TTF.
- **Download options:**
  - **Download all**, which is all active tables;
  - **Download selected**, using the row checkboxes;
  - a choice of **4 or 6 per page** in a small dropdown next to the button.
- The admin UI shows the hint "Print at 100% / Actual size (not 'Fit to page')" so the QR codes print at the intended size.
- **Performance:** about 100 tables (17 pages) take around 1–2 s in the browser. For very large counts a progress bar is shown and QR images are generated in batches so the page stays responsive.

---

### 3. Orders & Sales — `/admin/[slug]/orders` + header strip

#### 3.1 What "today" means
- "Today" is calculated in the **restaurant's timezone** (`restaurants.timezone`, default `Asia/Karachi`), not in UTC and not in the browser's timezone.
- In SQL the day range is:
  `created_at >= (date_trunc('day', now() AT TIME ZONE tz) AT TIME ZONE tz)` and `< that + interval '1 day'`.
- An optional **day cut-off hour** setting (e.g. 4 AM) lets late-night orders after midnight count toward the previous business day. The default is midnight.

#### 3.2 Today's orders list
```
Today ▾ (date picker)   Status: [All] [Active] [Served] [Cancelled]   Payment: [All] [Unpaid] [Paid]

 #37  Table 4   9:42 PM   2× Mutton Karahi, 4× Naan        Rs 6,800   PREPARING  UNPAID  [Mark paid]
 #36  Table 1   9:30 PM   1× Chicken Tikka                 Rs   950   SERVED     PAID
 ...
```
- **Columns:** order #, table, time, an item summary (expandable to show quantities and notes), total, status badge, and payment badge.
- **Actions:**
  - **Mark paid** sets `payment_status = 'paid'`;
  - **Cancel** (with a reason) sets `status = 'cancelled'`;
  - opening an order shows its full details.
- **Live updates:** the page reuses `useOrdersChannel` from Part 2 (Routes) §3.2, so new orders appear at the top without a refresh and status changes made by the kitchen update the badges.
- Data comes from `getOrders(restaurantId, { date, status, payment })`, which paginates 50 at a time and is sorted by `created_at DESC`.
- The **date picker** lets the owner look at a previous day; today is the default.

#### 3.3 Daily sales total
Totals are calculated in the database by an RPC, `get_daily_sales(p_restaurant_id uuid, p_date date)`. It is `SECURITY INVOKER`, so RLS applies, and it returns:

| Field | Definition |
|---|---|
| `order_count` | orders that day, `status <> 'cancelled'` |
| `gross_sales` | `SUM(total)` of those orders |
| `collected` | `SUM(total)` where `payment_status = 'paid'` |
| `pending_payment` | `gross_sales - collected` |
| `avg_order_value` | `gross_sales / NULLIF(order_count, 0)` |
| `cancelled_count` | orders with `status = 'cancelled'` (not included in sales) |
| `top_items` | top 5 by quantity from `order_items` (name, qty, revenue) |

**Where it's shown:**
- **Header strip on every admin page:** "Sales Rs 48,350 · 37 orders". It refreshes after realtime order events, at most every 10 s.
- **Overview page:** cards for Gross sales, Collected, Pending payment, Orders, and Avg order, a "Top items today" list, and the "Out of stock now" card (§1.5).
- **Orders page:** a summary row above the list for the selected date.

**Rules:** money is formatted with `formatPrice()` in the restaurant's `currency`. Totals come from the stored `orders.total`, which was computed by the server at order time, so menu price changes never change past sales.

**Index:** `orders (restaurant_id, created_at DESC)`. Add it to the Part 1 (Database) §4 list in the migration step.

---

### 4. File additions vs. Part 2 (Routes)

```
app/admin/[slug]/
├── page.tsx                         # Overview: sales cards, top items, out-of-stock card
├── menu/page.tsx | new/page.tsx | [itemId]/page.tsx | actions.ts
├── tables/
│   ├── page.tsx
│   └── actions.ts                   # createTable, createTables(count), updateTable, deleteTable
└── orders/
    ├── page.tsx                     # date/status/payment filters + list
    └── actions.ts                   # NEW: markPaid, cancelOrder

components/admin/
├── availability-toggle.tsx          # useOptimistic, latest-request-wins
├── out-of-stock-card.tsx            # NEW: overview card + "back in stock" buttons
├── menu-search-filter.tsx           # NEW: search + in/out-of-stock chips
├── item-form.tsx | image-upload.tsx | category-form.tsx | item-table.tsx
├── add-tables-dialog.tsx            # NEW: "add multiple"
├── qr-card.tsx | table-list.tsx
├── pdf-download-button.tsx          # NEW: layout 4/6 + selected/all
├── sales-header.tsx                 # NEW: today's sales strip in admin layout
├── sales-summary-cards.tsx          # NEW
├── top-items-list.tsx               # NEW
├── orders-table.tsx | order-detail-sheet.tsx (NEW)

lib/
├── qr.ts                            # buildTableUrl(), qrToPngDataUrl()
├── pdf/qr-sheet.ts                  # NEW: buildQrSheetPdf(tables, restaurant, layout) — jsPDF, client-side
├── data/sales.ts                    # NEW: getDailySales() → rpc('get_daily_sales')
├── data/orders.ts                   # + getOrders(filters)
├── dates.ts                         # NEW: restaurant-timezone day range helpers
└── validation/menu.ts | table.ts (NEW)
```

**New database objects** (to be added in the migration step):
- the `get_daily_sales()` RPC;
- the `menu-images` Storage bucket and its policies;
- the optional `pg_cron` stock reset;
- the `orders (restaurant_id, created_at DESC)` index;
- the `menu_items.is_available` broadcast trigger (Part 4 (QR & Realtime) §2.6).

**npm packages:** `qrcode.react`, `jspdf`, `browser-image-compression`, `zod`, `@dnd-kit/core` (category reorder).

### 5. Acceptance checklist
- [ ] Add an item with name, price, category, and image, and it shows up on `/r/[slug]` on the next load.
- [ ] Editing a price doesn't change the totals of past orders.
- [ ] Deleting an item removes it from both menus and offers Undo for 5 s.
- [ ] Tapping the toggle flips it instantly; with an offline network it reverts and shows an error toast.
- [ ] Mutton Karahi OFF:
  - [ ] It's missing from the customer menu after a refresh.
  - [ ] It disappears live from an open menu and cart.
  - [ ] `place_order` with it in the cart fails with a clear message.
- [ ] "Add multiple (10)" creates the next 10 table numbers.
- [ ] Scanning a printed QR opens `/r/<slug>?table=N` and the table can order. An unknown table number gives a view-only menu.
- [ ] The PDF is A4, has 6 per page (or 4), prints at actual size, every cell shows "TABLE N", and every QR scans from about 30 cm.
- [ ] Today's orders and the sales total use Asia/Karachi day boundaries, and cancelled orders are excluded from sales.
- [ ] A manager of restaurant A can't see restaurant B's orders, sales, menu, or QR PDF.

---

## Part 4 — QR System & Realtime

---

### 1. QR System

#### 1.1 The QR contract (permanent URL)
```
https://scan2serve.app/r/<restaurant_slug>?table=<table_number>
e.g. https://scan2serve.app/r/karachi-bbq?table=5
```
- The URL is **static**: no token, no signature, no expiry. Printed QR codes keep working for as long as the restaurant and the table exist.
- It is built in one place only: `lib/qr.ts → buildTableUrl(slug, tableNumber)` = `` `${NEXT_PUBLIC_APP_URL}/r/${slug}?table=${tableNumber}` ``.
- **`NEXT_PUBLIC_APP_URL` must be the final production domain** before anyone prints. Changing the domain later would break every printed QR, unless the old domain permanently redirects to the new one.
- **The slug is locked once set.** The Settings page shows it read-only. If support ever has to rename it, a `slug_redirects (old_slug text PK, restaurant_id uuid)` table plus a lookup in `middleware.ts` sends a 308 redirect from `/r/<old>` to `/r/<new>`, which keeps the query string. That way printed QRs never break.
- **Table numbers are permanent too.** Deleting Table 5 and later adding a new Table 5 makes the old printed QR work again for the new table, which is intended.

#### 1.2 Unlimited tables per branch
- `tables.table_number` is an `int` with no upper limit in the database or the app; the only rule is `table_number > 0`.
- The URL contains only `slug` and `table`, so **table numbers must be unique per restaurant** (`UNIQUE (restaurant_id, table_number)`) to find exactly one table and branch. Branches still each get unlimited tables. For multiple branches, the recommended convention is **number ranges per branch**, e.g. DHA 1–199, Gulberg 201–399.
  - The "Add multiple…" dialog suggests the next free number **within the selected branch's range**, which is set as an optional `branches.table_number_start` (int, default 1).
  - If two branches really need overlapping numbers, give each branch its own restaurant slug (e.g. `karachi-bbq-dha`). The URL format doesn't change.
- **At scale:**
  - "Add multiple" inserts in chunks of 500.
  - The admin table list paginates and has a "Jump to table #" box.
  - PDF generation works in batches (§1.5).
  - `resolve_table` is an indexed lookup on `(restaurant_id, table_number)`, so speed doesn't depend on how many tables there are.

#### 1.3 Scan → menu flow (customer side)
```
Phone camera → https://scan2serve.app/r/karachi-bbq?table=5
  └─▶ app/r/[slug]/page.tsx (Server Component)
        1. parse searchParams.table → must be a positive integer, otherwise read-only mode
        2. rpc('resolve_table', { slug, table_number: 5 })
             → { restaurant_id, branch_id, table_id, label } or null
        3. null / inactive table → menu in read-only mode + "Scan the QR on your table to order"
        4. getPublicMenu(restaurant_id, branch_id)  (is_active AND is_available only)
        5. render menu; <CartProvider key="cart:karachi-bbq:5"> (table is part of the cart key)
```
- The customer page header shows **"Table 5"**, so the customer can confirm it matches their table.
- The table number is sent again with the order (`place_order(slug, 5, …)`) and checked again on the server. Nothing the client says about the table is trusted.

#### 1.4 Abuse protection without a token
With a static URL, a photo of a QR code (or just guessing the format) lets someone order for a table without being there. The following protections avoid changing the QR at all:
1. **Rate limit inside `place_order`:** at most 3 orders per table in 10 minutes, at most 30 items per order, and quantity ≤ 20 per line. Above that, the RPC returns `RATE_LIMITED`.
2. **The kitchen accepts each order.** Every order starts as `pending`, and the kitchen taps **Accept** or **Reject**. A fake order is rejected in one tap (`status = 'cancelled'`, reason "fake/spam").
3. **Per-device ID:** an httpOnly cookie `s2s_device` (random UUID) is set on the first menu load and stored on the order (`orders.device_id uuid`, a new nullable column). The kitchen sees "same device as order #31". Repeat abusers can be blocked per restaurant with a small `blocked_devices` table, added later only if needed.
4. **IP rate limit later:** middleware can limit requests per IP on the `placeOrder` action (Upstash Ratelimit), on top of the per-table limit, if abuse appears.

#### 1.5 QR generation — `qrcode.react` + `jsPDF` (all in the browser)

**Libraries**
| Package | Used for |
|---|---|
| `qrcode.react` | `<QRCodeSVG>` for on-screen previews; `<QRCodeCanvas>` to make PNGs for downloads and the PDF |
| `jspdf` | Building the A4 PDF in the browser; loaded only when the download button is clicked (`await import('jspdf')`) |

**QR settings (all outputs):** `level="M"`, `marginSize={4}`, `fgColor="#000000"`, `bgColor="#ffffff"`, `value = buildTableUrl(slug, n)`.

**Preview** — `components/admin/qr-card.tsx`: `<QRCodeSVG size={96} …/>` in each table row.

**Single PNG** — mounts an off-screen `<QRCodeCanvas size={1024}/>`, reads `canvas.toDataURL('image/png')`, and downloads it as `<slug>-table-5.png`.

**Printable PDF** — `lib/pdf/qr-sheet.ts` + `components/admin/pdf-download-button.tsx`

`qrcode.react` only provides React components (it has no plain function that returns an image), so PNGs are captured from components rendered off-screen, in batches:
```
onClick(layout = 6, tables = selected or all active, ordered by table_number):
  show progress "Preparing 0 / N"
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  for batch of 24 tables:
     render <QRCodeCanvas size={600} …/> for each into a hidden <div> (via a portal + refs)
     await nextAnimationFrame()               // let the canvases draw
     images[n] = canvas.toDataURL('image/png')
     unmount batch; update progress
  ... then lay out:

  A4 = 210 × 297 mm, margin m = 10, cols = 2, rows = layout === 6 ? 3 : 2
  cellW = (210 - 2m) / cols            = 95 mm
  cellH = (297 - 2m - 8 footer) / rows = 89.7 mm (6-up) | 134.5 mm (4-up)
  qr    = layout === 6 ? 58 : 80       (mm)

  for (i, table) of tables:
     if i > 0 && i % layout === 0 → doc.addPage()
     col = i % cols, row = floor((i % layout) / cols)
     x = m + col*cellW, y = m + row*cellH, cx = x + cellW/2

     doc.setLineDashPattern([2, 2], 0); doc.setDrawColor(160); doc.rect(x, y, cellW, cellH)   // cut line
     doc.setLineDashPattern([], 0)

     doc.setFont('helvetica', 'normal'); doc.setFontSize(13)
     doc.text(fitText(restaurant.name, cellW - 10), cx, y + 10, { align: 'center' })        // restaurant name
     doc.addImage(images[table.n], 'PNG', cx - qr/2, y + 15, qr, qr, undefined, 'FAST')     // QR
     doc.setFont('helvetica', 'bold'); doc.setFontSize(layout === 6 ? 26 : 36)
     doc.text(`TABLE ${table.n}`, cx, y + 15 + qr + 11, { align: 'center' })                 // table number
     doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
     doc.text('Scan to view menu & order', cx, y + 15 + qr + 18, { align: 'center' })

  footer on each page: `${restaurant.name} · page p / P` (size 8, grey)
  doc.save(`${slug}-table-qrs.pdf`)
```
- **The output is an A4 PDF** with 6 per page by default (2 × 3), or 4 per page (2 × 2). Each cell has the **restaurant name**, the **QR**, **TABLE N** in large bold type, and a "Scan to view menu & order" line, with dashed cut lines and page numbers.
- `fitText` shrinks the font (13 → 9 pt) and then uses `doc.splitTextToSize` for long restaurant names.
- **Logo (optional):** fetch `logo_url` → convert it to a data URL → `addImage` 10 mm high next to the name. It's skipped if loading fails (CORS or a timeout of 3 s).
- **Quality:** a 600 px QR printed at 58 mm is about 260 dpi, which is sharp. Scanning distance is about 30–50 cm, which is right for a table tent.
- **Unlimited tables:** batches of 24 keep memory low (about 10 KB per PNG). 500 tables means 84 pages, roughly a 5 MB PDF, built in a few seconds while a progress bar shows. Above 1,000 tables, the dialog suggests downloading by branch or range.
- **Fonts:** jsPDF's built-in Helvetica covers English. Urdu text later needs an embedded TTF (`doc.addFileToVFS` / `addFont`) and right-to-left shaping.
- The UI shows the hint: "Print at **100% / Actual size**".

#### 1.6 QR files
```
lib/qr.ts                              buildTableUrl(slug, n)
lib/pdf/qr-sheet.ts                    buildQrSheetPdf({ restaurant, tables, images, layout }) → jsPDF doc
components/admin/qr-card.tsx           <QRCodeSVG> preview + PNG download
components/admin/qr-canvas-batch.tsx   hidden off-screen <QRCodeCanvas> renderer → dataURLs
components/admin/pdf-download-button.tsx  layout picker (4/6), all/selected, progress bar
```

---

### 2. Realtime System

#### 2.1 End-to-end flow: order at Table 5 → kitchen screen
```
Customer phone (/r/karachi-bbq?table=5)
  └─ taps "Place order"
     └─▶ server action placeOrder()              app/r/[slug]/actions.ts
           zod validate → supabase.rpc('place_order', { slug, table_number: 5, items, … })
             ┌─────────────── ONE Postgres transaction (SECURITY DEFINER) ───────────────┐
             │ resolve table 5 → restaurant_id, branch_id, table_id                      │
             │ rate-limit check (§1.4)                                                  │
             │ lock + validate items: is_active AND is_available, same restaurant       │
             │ prices from menu_items; subtotal / tax / total                           │
             │ order_number = next per branch per day                                   │
             │ INSERT INTO orders (... status 'pending') RETURNING id, public_token     │
             │ INSERT INTO order_items (... name/price copies)                          │
             └───────────────────────────── COMMIT ─────────────────────────────────────┘
                     │ (WAL)
                     ▼
            Supabase Realtime (postgres_changes on public.orders)
                     │ checks each subscriber's RLS: is_member(restaurant_id)
                     ▼
Kitchen tablet (/r/karachi-bbq/kitchen)  channel "kitchen:<branch_id>"
  └─ INSERT event → fetch order + items → new card in PENDING + chime     (target < 1 s)
Customer phone
  └─ redirect → /r/karachi-bbq/order/<public_token>  (status tracker, §2.5)
```
- **"It inserts into the `orders` table"** happens inside `place_order`. The customer's browser never writes to `orders` directly; anon has no INSERT permission. This stops customers from changing prices and from ordering out-of-stock items. The Realtime INSERT event is exactly the same as it would be for a direct insert.
- **The order and its items are committed together.** Realtime only sends the event after COMMIT, so when the kitchen fetches the items they are guaranteed to exist.
- **`order_number` per branch per day** comes from a small counter table `order_counters (branch_id, day date, last int, PK(branch_id, day))`, updated with `INSERT … ON CONFLICT DO UPDATE SET last = last + 1 RETURNING last` inside the same transaction. It has no race conditions and resets daily.

#### 2.2 Database setup for Realtime (migration step)
| Item | Setting | Why |
|---|---|---|
| Publication | `alter publication supabase_realtime add table public.orders;` | enables `postgres_changes` for the kitchen |
| RLS SELECT on `orders` for `authenticated` | `is_member(restaurant_id)` (+ branch check) | Realtime delivers an event only to subscribers who could SELECT that row, which gives tenant isolation for free |
| Replica identity | default (primary key) | INSERT/UPDATE payloads already contain the full new row; DELETE events aren't used (orders are cancelled, not deleted) |
| Broadcast triggers | `orders` status change → `order:<public_token>`; `menu_items.is_available` change → `menu:<restaurant_id>` | customers (anon) get live updates without reading the tables (§2.5, §2.6) |
| Realtime authorization | public broadcast topics; the topic names are unguessable (`public_token`) or harmless (`menu:<uuid>` only carries item IDs and true/false) | keeps the anon side simple |

#### 2.3 Kitchen subscription — `lib/realtime/use-orders-channel.ts`
```
useOrdersChannel(branchId, { onInsert, onUpdate, onResync })

  const supabase = createBrowserClient()          // logged-in session → JWT sent to Realtime
  const channel = supabase
    .channel(`kitchen:${branchId}`)
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` },
        ({ new: row }) => onInsert(row))
    .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` },
        ({ new: row }) => onUpdate(row))
    .subscribe((status) => {
        if (status === 'SUBSCRIBED') onResync()             // first join AND every re-join
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnection('reconnecting')
     })
  cleanup: supabase.removeChannel(channel)
```

**`<KitchenBoard initialOrders branchId>` state & handlers**
- **State:** a `Map<orderId, Order>` holds the orders, and each column is a derived view (`pending`, `accepted|preparing`, `ready`) sorted by `created_at` ascending, oldest first.
- **`onInsert(row)`:**
  1. If the order is already in the map, ignore the event.
  2. Otherwise fetch `orders.select('*, order_items(*), tables(table_number,label)').eq('id', row.id).single()`. The event payload has no items, and RLS applies to this fetch too.
  3. Add the order to the map, play the chime, and flash the card.
- **`onUpdate(row)`:** merge `status` / `payment_status` into the map. If the status is `served`, `completed`, or `cancelled`, remove the card after 3 s, with an "Undo" option.
- **`onResync()`:** re-fetch `getActiveOrders(branchId)` and **merge** by id. This runs after the first subscribe and after every reconnect, so no order created while the connection was down is ever lost.
- **Start-up order matters.** The server first renders `initialOrders`. The client then subscribes, and `onResync` runs once the channel reports `SUBSCRIBED`. That resync covers the short gap between the server's snapshot and the subscription becoming active.
- **Tab or device wake-up:** on `visibilitychange → visible` and `online`, it calls `onResync()`. Mobile browsers suspend background tabs.
- **Fallback poll:** if the channel isn't `SUBSCRIBED` for more than 15 s, it polls `getActiveOrders` every 10 s until the channel is healthy again. A banner says "Live updates paused — reconnecting…".
- **Token refresh:** `@supabase/ssr` refreshes the session, and the realtime client picks up the new JWT (`supabase.realtime.setAuth`). If a shift lasts longer than the refresh token, a full re-login is needed, which the middleware handles.

**Kitchen actions** — `app/r/[slug]/kitchen/actions.ts`
- `updateOrderStatus(orderId, next)`:
  - Only allows valid steps: `pending → accepted | cancelled`, `accepted → preparing`, `preparing → ready`, `ready → served`.
  - Implemented as `UPDATE … WHERE id = $1 AND status = $expected`, so if two tablets tap at the same time, only one succeeds and the other just refreshes.
  - The UI updates optimistically. The resulting UPDATE event also reaches every other kitchen or admin screen for the branch, so all screens stay in sync.

#### 2.4 Kitchen alerts & screen behaviour
- **"Start shift" button** (full-screen overlay on first load): browsers block sound until the user taps something, so this tap unlocks an `AudioContext`. It also requests the **Screen Wake Lock** (`navigator.wakeLock.request('screen')`) so the tablet doesn't sleep. The wake lock is requested again after `visibilitychange`.
- **Chime** on each new order. A **reminder chime every 30 s** keeps playing while any order is still `pending` (not accepted).
- **Tab title** shows `(3) Kitchen · Karachi BBQ`; the 3 is the number of pending orders.
- **Card:** big table number ("TABLE 5"), order #, a live age timer (turns amber after 10 min and red after 20 min), items with quantity and notes, and customer notes. "Same device as #31" is shown when the device ID matches an earlier order (§1.4).
- **Connection dot:** green for live, amber for reconnecting, red when polling.

#### 2.5 Customer order tracking (anon, no login)
The customer's browser isn't logged in, so RLS would block `postgres_changes` on `orders`. Updates use **Broadcast** instead:
- **DB trigger:** `AFTER UPDATE OF status ON orders` → `realtime.send(jsonb_build_object('status', NEW.status, 'updated_at', NEW.updated_at), 'status', 'order:' || NEW.public_token, false)`. The last argument (`false`) makes it a public broadcast.
- **Customer page:** `/r/[slug]/order/[token]` subscribes to channel `order:<token>` (broadcast event `status`) and updates the step tracker: *Received → Accepted → Preparing → Ready → Served*.
- `public_token` is a random UUID, so nobody can guess another customer's channel. The message only carries the status.
- **Fallback:** the page polls `get_order_status(token)` every 15 s, and also when the tab becomes visible.

#### 2.6 Live stock-out for open customer menus
- **Fix to Step 3 §1.5:** a `postgres_changes` subscription on `menu_items` wouldn't work for anon customers. Once an item goes out of stock, its row no longer passes the anon SELECT policy (`is_available = true`), so Realtime would never send that UPDATE to customers.
- **Broadcast instead:**
  - **Trigger:** `AFTER UPDATE OF is_available ON menu_items` → `realtime.send({ item_id, is_available }, 'availability', 'menu:' || restaurant_id, false)`.
  - **Customer page:** subscribes to `menu:<restaurant_id>`.
  - **On `is_available = false`:** the item card and any cart line for it are removed, with the toast "Mutton Karahi just sold out".
  - **On `true`:** the page calls `router.refresh()` to show it again, because it needs the full item data.
- **Safety net:** even if the customer misses the broadcast, `place_order` still rejects unavailable items.

#### 2.7 Failure modes
| Situation | What happens |
|---|---|
| Kitchen Wi-Fi drops for 2 min | Banner shows reconnecting → poll fallback. On re-subscribe, `onResync` brings in any missed orders, and the chime plays for new pending ones |
| Kitchen tablet asleep / tab in background | Wake Lock keeps the screen on. Otherwise, `visibilitychange` triggers a resync |
| Two tablets tap "Accept" at once | Conditional UPDATE: one succeeds, and the other sees the change through Realtime |
| Customer double-taps "Place order" | Button is disabled while sending, plus an idempotency key (`client_order_id uuid` from the cart) checked by a `UNIQUE` constraint in `place_order`, so the same order is never created twice |
| Item goes out of stock while it's in a customer's cart | Broadcast removes it from the cart. If that's missed, `place_order` returns `ITEM_UNAVAILABLE` with the ids, and the cart drops those lines |
| Spam orders from a shared QR photo | Per-table rate limit, plus kitchen Reject, plus device ID (§1.4) |
| Realtime service outage | Kitchen board falls back to polling every 10 s, so orders are still delivered, only slower |

#### 2.8 Limits & scaling notes
- `postgres_changes` checks RLS for every subscriber on every event. That's fine here, because each branch has only a few kitchen and admin screens.
- If load grows, move the kitchen feed to **Broadcast from a database trigger** too: an `AFTER INSERT` trigger on `order_items` (or a deferred trigger on `orders`) sends to a **private** channel `kitchen:<branch_id>`, using Realtime Authorization policies on `realtime.messages`.
- Watch the plan's concurrent Realtime connection limit. Each kitchen, admin, and order-tracking screen uses one connection, and menu pages use one while open.

#### 2.9 Realtime files
```
lib/realtime/use-orders-channel.ts     kitchen + admin orders feed (postgres_changes, resync, fallback poll)
lib/realtime/use-order-status.ts       customer tracker (broadcast order:<token> + poll)
lib/realtime/use-menu-availability.ts  customer menu (broadcast menu:<restaurant_id>)
components/kitchen/kitchen-board.tsx   Map state, columns, handlers
components/kitchen/start-shift-overlay.tsx  audio unlock + wake lock
components/kitchen/new-order-alert.tsx chime + reminder loop
components/kitchen/connection-indicator.tsx
```

**New database objects** (added to the migration list):
- the `order_counters` table;
- the `orders.device_id` and `orders.client_order_id` columns (UNIQUE per restaurant);
- the `branches.table_number_start` column;
- the optional `slug_redirects` table;
- the two broadcast triggers;
- `orders` added to the `supabase_realtime` publication;
- rate-limit logic in `place_order`.

---

### 3. Acceptance checklist
- [ ] A printed QR opens `/r/<slug>?table=N`, the header shows "Table N", and an order can be placed. A non-numeric or unknown `table` gives read-only mode.
- [ ] The PDF is A4, 6 (or 4) per page, and every cell has the restaurant name, a QR that scans, and "TABLE N". It prints at actual size, and 200 tables generate without the browser freezing.
- [ ] Table 5 places an order → the kitchen card appears in under 1 s with a chime, without refreshing.
- [ ] Kitchen offline for 1 min while 2 orders arrive → both appear after reconnecting.
- [ ] A user from restaurant B, subscribed with a crafted filter, receives **no** events for restaurant A.
- [ ] Kitchen moves the order Accept → Ready → customer tracker updates live.
- [ ] Toggling Mutton Karahi OFF removes it live from an open customer menu and cart.
- [ ] A 4th order from the same table within 10 minutes is rejected with a friendly message.
