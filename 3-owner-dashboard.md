# Scan2Serve — Step 3: Owner Dashboard Features

> Planning document — no code yet. Builds on [1-database.md](1-database.md) (schema + RLS) and [2-routes.md](2-routes.md) (routes + files).
> Route: `/admin/[slug]/*`. Access: `requireRole(slug, ['owner','manager'])` in `app/admin/[slug]/layout.tsx`.

## 0. Dashboard layout

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

## 1. Menu Management — `/admin/[slug]/menu`

### 1.1 Menu list screen
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

### 1.2 Add New Item — `/admin/[slug]/menu/new` (also a dialog from "+ item")
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

### 1.3 Edit Item — `/admin/[slug]/menu/[itemId]`
- Uses the same `<ItemForm/>`, pre-filled with the item's current values. `updateItem(slug, itemId, formData)` runs the same validation and revalidation.
- **Price changes don't affect past orders**, because `order_items` stores `unit_price` and `item_name` as copies taken at order time.
- Moving an item to another category is just a change of `category_id`.

### 1.4 Delete Item
- The trash icon opens a confirm dialog: "Delete *Mutton Karahi*? It will disappear from the menu."
- `deleteItem` does a **soft delete** (`is_active = false`). The item disappears from both admin and customer views, but order history stays intact.
- A **"Undo"** toast is shown for 5 s, which sets `is_active = true` again.
- Deleting a category is only allowed when it has no active items. Otherwise the dialog says "Move or delete its N items first".

### 1.5 SUPER FAST availability toggle (stock-out)

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
- **Customers who already have the menu open:** the customer page listens on the Broadcast channel `menu:<restaurant_id>`, fed by a database trigger on `is_available`. When `is_available` goes false, the card is removed from the open menu and from the cart, with a notice: "Mutton Karahi just sold out". (`postgres_changes` would not work here; see [4-qr-realtime.md](4-qr-realtime.md) §2.6.)
- Customers on a slow connection may never get that live update. They're still covered, because the `place_order` RPC rejects unavailable items (see [1-database.md](1-database.md) and [2-routes.md](2-routes.md) §3.1).
- **What "customers will not see it" means:** the anon RLS policy and the `getPublicMenu` query both require `is_available = true`, so the item never reaches the browser.
- **Bulk actions** (on the "Out of stock" filter):
  - **"Mark all back in stock"**, for the start of a new day.
  - An optional setting **"Reset stock every morning at 6 AM"**, done by a `pg_cron` job that sets `is_available = true` for that restaurant.
- **Audit (optional, later):** a `menu_item_events` table recording who toggled what and when.

---

## 2. QR Code Management — `/admin/[slug]/tables`

### 2.1 Tables list
```
[+ Add table]  [+ Add multiple…]                 [⬇ Download all QRs (PDF)]

 ☐  Table 1    [QR]   4 seats   [⬇ PNG] [🗑]
 ☐  Table 2    [QR]   2 seats   [⬇ PNG] [🗑]
 ...
                       [⬇ Download selected (PDF)]
```
- Tables are sorted by `table_number`. **There is no limit on the number of tables.** The list is paginated or virtualised past 100 rows and has a "Jump to table #" box.
- Each row shows a small live QR preview, rendered by `<QRCodeSVG>` from **qrcode.react**.

### 2.2 Add Table
- **"Add table"** creates the next number (`max(table_number) + 1`, starting at 1), named "Table N". Nothing needs to be typed.
- **"Add multiple…"** opens a dialog: "Add [10] tables" creates, for example, Table 5 to Table 14 in one insert. The dialog accepts any count; inserts are batched in chunks of 500.
- The number can be edited, but it must be unique per restaurant: `UNIQUE (restaurant_id, table_number)`. If it's taken, the form shows "Table 3 already exists".
- **Seats** and **label override** (e.g. "Patio 3") are optional.
- If the restaurant has several branches, there is a branch selector; numbers stay unique across the whole restaurant (see [4-qr-realtime.md](4-qr-realtime.md) §1.2).

### 2.3 QR code contents
```
https://scan2serve.app/r/<slug>?table=1
```
- The QR holds a **permanent, static URL with no token and no expiry**. It's built from the slug and the table number, so it never changes and never needs reprinting.
- The URL is built in a single place, `lib/qr.ts → buildTableUrl(slug, tableNumber)`, using `NEXT_PUBLIC_APP_URL`.
- **QR settings:** error-correction level **M**, quiet zone of 4 modules, black on white.
- **Delete table** shows a confirm dialog. Past orders keep `table_id = NULL` (`ON DELETE SET NULL`), so sales history is unaffected. A deleted table's printed QR opens the menu in read-only mode.
- **⬇ PNG** renders a 1024 px `<QRCodeCanvas>` off-screen and downloads it with `canvas.toDataURL('image/png')`.
- With a static URL, anyone who knows it could order for a table remotely. The protections against that are described in [4-qr-realtime.md](4-qr-realtime.md) §1.4.

### 2.4 Download all QRs as a printable PDF
- The PDF is generated **in the browser** with **jsPDF**, using QR images from **qrcode.react**. There is no server endpoint, and the file downloads as `<slug>-table-qrs.pdf`.
- The table list comes from the page's already-loaded, RLS-protected data, so an owner can only ever print their own tables.
- The full generation algorithm is in [4-qr-realtime.md](4-qr-realtime.md) §1.5.

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

## 3. Orders & Sales — `/admin/[slug]/orders` + header strip

### 3.1 What "today" means
- "Today" is calculated in the **restaurant's timezone** (`restaurants.timezone`, default `Asia/Karachi`), not in UTC and not in the browser's timezone.
- In SQL the day range is:
  `created_at >= (date_trunc('day', now() AT TIME ZONE tz) AT TIME ZONE tz)` and `< that + interval '1 day'`.
- An optional **day cut-off hour** setting (e.g. 4 AM) lets late-night orders after midnight count toward the previous business day. The default is midnight.

### 3.2 Today's orders list
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
- **Live updates:** the page reuses `useOrdersChannel` from [2-routes.md](2-routes.md) §3.2, so new orders appear at the top without a refresh and status changes made by the kitchen update the badges.
- Data comes from `getOrders(restaurantId, { date, status, payment })`, which paginates 50 at a time and is sorted by `created_at DESC`.
- The **date picker** lets the owner look at a previous day; today is the default.

### 3.3 Daily sales total
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

**Index:** `orders (restaurant_id, created_at DESC)`. Add it to the [1-database.md](1-database.md) §4 list in the migration step.

---

## 4. File additions vs. [2-routes.md](2-routes.md)

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
- the `menu_items.is_available` broadcast trigger ([4-qr-realtime.md](4-qr-realtime.md) §2.6).

**npm packages:** `qrcode.react`, `jspdf`, `browser-image-compression`, `zod`, `@dnd-kit/core` (category reorder).

## 5. Acceptance checklist
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
