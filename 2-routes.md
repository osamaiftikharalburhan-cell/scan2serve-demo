# Scan2Serve — Step 2: Next.js App Router Structure

> Planning document — no code yet. Builds on [1-database.md](1-database.md).
> Stack: Next.js (App Router, TypeScript), Supabase (`@supabase/ssr`), Tailwind CSS.

## 1. Routes at a glance

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

**QR URL format (permanent, static):** `https://scan2serve.app/r/<slug>?table=1`. The `slug` picks the restaurant and `table` is the table number (checked server-side by `resolve_table(slug, table)`). The QR never expires and never needs reprinting. If `table` is missing or unknown, the menu is shown read-only with "Scan the QR on your table to order". See [4-qr-realtime.md](4-qr-realtime.md).

## 2. Folder & file tree

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

## 3. Route details

### 3.1 `/r/[slug]` — Customer page
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

### 3.2 `/r/[slug]/kitchen` — Kitchen dashboard
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

### 3.3 `/admin/[slug]` — Owner dashboard
- **`layout.tsx`** calls `requireRole(slug, ['owner','manager'])` and renders `<Sidebar/>` with links to Overview, Menu, Tables, Orders, Settings, and Kitchen (`/r/[slug]/kitchen`).
- **Overview (`page.tsx`)** shows today's order count, revenue, active orders, and the out-of-stock items with a one-click "Back in stock".
- **Menu (`menu/`)**, full CRUD:
  - Categories can be created, renamed, deleted (only if empty, or by cascading confirmation), reordered by drag (`sort_order`), and toggled with `is_active`.
  - Items can be created and edited through `<ItemForm/>` (zod `itemSchema`; image uploaded to Storage at `menu/<restaurant_id>/<uuid>.webp`). Deleting an item is a soft delete (`is_active = false`), so old orders keep their history; a hard delete is also possible because `order_items` stores copies of the name and price.
  - **Availability toggle:** `<AvailabilityToggle/>` on every row calls `toggleAvailability(itemId, value)`, updates optimistically, and then calls `revalidatePath('/r/[slug]')`.
  - Admin queries do **not** filter on `is_available`. Out-of-stock items stay visible here with an "Out of stock" badge.
- **Tables** lets the owner add or remove tables per branch, and download QR codes as PNG or as a printable A4 PDF, generated in the browser with `qrcode.react` + jsPDF (`lib/qr.ts`, `lib/pdf/qr-sheet.ts`).
- **Orders** shows the order history with filters. **Settings** covers the restaurant profile, branches, and staff (invite by email, set role and branch).

## 4. Server actions (mutations)

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

## 5. Middleware & access control
- `middleware.ts` calls `updateSession()` (from `lib/supabase/middleware.ts`) to refresh the auth cookie on every request.
- **Matcher:** `/admin/:path*` and `/r/:slug/kitchen/:path*` redirect to `/login` when there's no session. Membership and role checks happen in the layouts (`lib/auth/guards.ts`), because they need the database. RLS is the final safety net.
- Customer routes (`/r/[slug]`, `/r/[slug]/order/*`) are public.

## 6. Out of scope for Step 2
- Payments, i18n/RTL, PWA/offline mode, push notifications, and analytics charts.
