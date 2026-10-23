# Scan2Serve — Step 4: QR System & Realtime Logic

> Planning document — no code yet (pseudocode only). Builds on [1-database.md](1-database.md), [2-routes.md](2-routes.md), [3-owner-dashboard.md](3-owner-dashboard.md).

---

## 1. QR System

### 1.1 The QR contract (permanent URL)
```
https://scan2serve.app/r/<restaurant_slug>?table=<table_number>
e.g. https://scan2serve.app/r/karachi-bbq?table=5
```
- The URL is **static**: no token, no signature, no expiry. Printed QR codes keep working for as long as the restaurant and the table exist.
- It is built in one place only: `lib/qr.ts → buildTableUrl(slug, tableNumber)` = `` `${NEXT_PUBLIC_APP_URL}/r/${slug}?table=${tableNumber}` ``.
- **`NEXT_PUBLIC_APP_URL` must be the final production domain** before anyone prints. Changing the domain later would break every printed QR, unless the old domain permanently redirects to the new one.
- **The slug is locked once set.** The Settings page shows it read-only. If support ever has to rename it, a `slug_redirects (old_slug text PK, restaurant_id uuid)` table plus a lookup in `middleware.ts` sends a 308 redirect from `/r/<old>` to `/r/<new>`, which keeps the query string. That way printed QRs never break.
- **Table numbers are permanent too.** Deleting Table 5 and later adding a new Table 5 makes the old printed QR work again for the new table, which is intended.

### 1.2 Unlimited tables per branch
- `tables.table_number` is an `int` with no upper limit in the database or the app; the only rule is `table_number > 0`.
- The URL contains only `slug` and `table`, so **table numbers must be unique per restaurant** (`UNIQUE (restaurant_id, table_number)`) to find exactly one table and branch. Branches still each get unlimited tables. For multiple branches, the recommended convention is **number ranges per branch**, e.g. DHA 1–199, Gulberg 201–399.
  - The "Add multiple…" dialog suggests the next free number **within the selected branch's range**, which is set as an optional `branches.table_number_start` (int, default 1).
  - If two branches really need overlapping numbers, give each branch its own restaurant slug (e.g. `karachi-bbq-dha`). The URL format doesn't change.
- **At scale:**
  - "Add multiple" inserts in chunks of 500.
  - The admin table list paginates and has a "Jump to table #" box.
  - PDF generation works in batches (§1.5).
  - `resolve_table` is an indexed lookup on `(restaurant_id, table_number)`, so speed doesn't depend on how many tables there are.

### 1.3 Scan → menu flow (customer side)
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

### 1.4 Abuse protection without a token
With a static URL, a photo of a QR code (or just guessing the format) lets someone order for a table without being there. The following protections avoid changing the QR at all:
1. **Rate limit inside `place_order`:** at most 3 orders per table in 10 minutes, at most 30 items per order, and quantity ≤ 20 per line. Above that, the RPC returns `RATE_LIMITED`.
2. **The kitchen accepts each order.** Every order starts as `pending`, and the kitchen taps **Accept** or **Reject**. A fake order is rejected in one tap (`status = 'cancelled'`, reason "fake/spam").
3. **Per-device ID:** an httpOnly cookie `s2s_device` (random UUID) is set on the first menu load and stored on the order (`orders.device_id uuid`, a new nullable column). The kitchen sees "same device as order #31". Repeat abusers can be blocked per restaurant with a small `blocked_devices` table, added later only if needed.
4. **IP rate limit later:** middleware can limit requests per IP on the `placeOrder` action (Upstash Ratelimit), on top of the per-table limit, if abuse appears.

### 1.5 QR generation — `qrcode.react` + `jsPDF` (all in the browser)

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

### 1.6 QR files
```
lib/qr.ts                              buildTableUrl(slug, n)
lib/pdf/qr-sheet.ts                    buildQrSheetPdf({ restaurant, tables, images, layout }) → jsPDF doc
components/admin/qr-card.tsx           <QRCodeSVG> preview + PNG download
components/admin/qr-canvas-batch.tsx   hidden off-screen <QRCodeCanvas> renderer → dataURLs
components/admin/pdf-download-button.tsx  layout picker (4/6), all/selected, progress bar
```

---

## 2. Realtime System

### 2.1 End-to-end flow: order at Table 5 → kitchen screen
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

### 2.2 Database setup for Realtime (migration step)
| Item | Setting | Why |
|---|---|---|
| Publication | `alter publication supabase_realtime add table public.orders;` | enables `postgres_changes` for the kitchen |
| RLS SELECT on `orders` for `authenticated` | `is_member(restaurant_id)` (+ branch check) | Realtime delivers an event only to subscribers who could SELECT that row, which gives tenant isolation for free |
| Replica identity | default (primary key) | INSERT/UPDATE payloads already contain the full new row; DELETE events aren't used (orders are cancelled, not deleted) |
| Broadcast triggers | `orders` status change → `order:<public_token>`; `menu_items.is_available` change → `menu:<restaurant_id>` | customers (anon) get live updates without reading the tables (§2.5, §2.6) |
| Realtime authorization | public broadcast topics; the topic names are unguessable (`public_token`) or harmless (`menu:<uuid>` only carries item IDs and true/false) | keeps the anon side simple |

### 2.3 Kitchen subscription — `lib/realtime/use-orders-channel.ts`
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

### 2.4 Kitchen alerts & screen behaviour
- **"Start shift" button** (full-screen overlay on first load): browsers block sound until the user taps something, so this tap unlocks an `AudioContext`. It also requests the **Screen Wake Lock** (`navigator.wakeLock.request('screen')`) so the tablet doesn't sleep. The wake lock is requested again after `visibilitychange`.
- **Chime** on each new order. A **reminder chime every 30 s** keeps playing while any order is still `pending` (not accepted).
- **Tab title** shows `(3) Kitchen · Karachi BBQ`; the 3 is the number of pending orders.
- **Card:** big table number ("TABLE 5"), order #, a live age timer (turns amber after 10 min and red after 20 min), items with quantity and notes, and customer notes. "Same device as #31" is shown when the device ID matches an earlier order (§1.4).
- **Connection dot:** green for live, amber for reconnecting, red when polling.

### 2.5 Customer order tracking (anon, no login)
The customer's browser isn't logged in, so RLS would block `postgres_changes` on `orders`. Updates use **Broadcast** instead:
- **DB trigger:** `AFTER UPDATE OF status ON orders` → `realtime.send(jsonb_build_object('status', NEW.status, 'updated_at', NEW.updated_at), 'status', 'order:' || NEW.public_token, false)`. The last argument (`false`) makes it a public broadcast.
- **Customer page:** `/r/[slug]/order/[token]` subscribes to channel `order:<token>` (broadcast event `status`) and updates the step tracker: *Received → Accepted → Preparing → Ready → Served*.
- `public_token` is a random UUID, so nobody can guess another customer's channel. The message only carries the status.
- **Fallback:** the page polls `get_order_status(token)` every 15 s, and also when the tab becomes visible.

### 2.6 Live stock-out for open customer menus
- **Fix to Step 3 §1.5:** a `postgres_changes` subscription on `menu_items` wouldn't work for anon customers. Once an item goes out of stock, its row no longer passes the anon SELECT policy (`is_available = true`), so Realtime would never send that UPDATE to customers.
- **Broadcast instead:**
  - **Trigger:** `AFTER UPDATE OF is_available ON menu_items` → `realtime.send({ item_id, is_available }, 'availability', 'menu:' || restaurant_id, false)`.
  - **Customer page:** subscribes to `menu:<restaurant_id>`.
  - **On `is_available = false`:** the item card and any cart line for it are removed, with the toast "Mutton Karahi just sold out".
  - **On `true`:** the page calls `router.refresh()` to show it again, because it needs the full item data.
- **Safety net:** even if the customer misses the broadcast, `place_order` still rejects unavailable items.

### 2.7 Failure modes
| Situation | What happens |
|---|---|
| Kitchen Wi-Fi drops for 2 min | Banner shows reconnecting → poll fallback. On re-subscribe, `onResync` brings in any missed orders, and the chime plays for new pending ones |
| Kitchen tablet asleep / tab in background | Wake Lock keeps the screen on. Otherwise, `visibilitychange` triggers a resync |
| Two tablets tap "Accept" at once | Conditional UPDATE: one succeeds, and the other sees the change through Realtime |
| Customer double-taps "Place order" | Button is disabled while sending, plus an idempotency key (`client_order_id uuid` from the cart) checked by a `UNIQUE` constraint in `place_order`, so the same order is never created twice |
| Item goes out of stock while it's in a customer's cart | Broadcast removes it from the cart. If that's missed, `place_order` returns `ITEM_UNAVAILABLE` with the ids, and the cart drops those lines |
| Spam orders from a shared QR photo | Per-table rate limit, plus kitchen Reject, plus device ID (§1.4) |
| Realtime service outage | Kitchen board falls back to polling every 10 s, so orders are still delivered, only slower |

### 2.8 Limits & scaling notes
- `postgres_changes` checks RLS for every subscriber on every event. That's fine here, because each branch has only a few kitchen and admin screens.
- If load grows, move the kitchen feed to **Broadcast from a database trigger** too: an `AFTER INSERT` trigger on `order_items` (or a deferred trigger on `orders`) sends to a **private** channel `kitchen:<branch_id>`, using Realtime Authorization policies on `realtime.messages`.
- Watch the plan's concurrent Realtime connection limit. Each kitchen, admin, and order-tracking screen uses one connection, and menu pages use one while open.

### 2.9 Realtime files
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

## 3. Acceptance checklist
- [ ] A printed QR opens `/r/<slug>?table=N`, the header shows "Table N", and an order can be placed. A non-numeric or unknown `table` gives read-only mode.
- [ ] The PDF is A4, 6 (or 4) per page, and every cell has the restaurant name, a QR that scans, and "TABLE N". It prints at actual size, and 200 tables generate without the browser freezing.
- [ ] Table 5 places an order → the kitchen card appears in under 1 s with a chime, without refreshing.
- [ ] Kitchen offline for 1 min while 2 orders arrive → both appear after reconnecting.
- [ ] A user from restaurant B, subscribed with a crafted filter, receives **no** events for restaurant A.
- [ ] Kitchen moves the order Accept → Ready → customer tracker updates live.
- [ ] Toggling Mutton Karahi OFF removes it live from an open customer menu and cart.
- [ ] A 4th order from the same table within 10 minutes is rejected with a friendly message.
