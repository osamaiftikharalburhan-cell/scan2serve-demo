# Scan2Serve — Step 1: Database Schema (Supabase)

> Planning document — no code yet. Multi-tenant QR ordering SaaS.

## 1. Overview
- **Tenant = restaurant.** Every tenant-owned row has a `restaurant_id uuid NOT NULL`, including child tables such as `order_items`. Adding the column to children means each RLS check reads only its own row and never needs a join.
- **Users:** the restaurant owner and staff log in with Supabase Auth (`auth.users`). Customers scanning a QR code are **anonymous** (`anon` role), with no login.
- **Primary keys:** `uuid DEFAULT gen_random_uuid()`. **Timestamps:** `timestamptz DEFAULT now()`. A trigger keeps `updated_at` current.
- **Money:** `numeric(10,2)`, never float.

## 2. Enums
- `member_role`: `owner`, `manager`, `staff`, `kitchen`
- `order_status`: `pending`, `accepted`, `preparing`, `ready`, `served`, `completed`, `cancelled`
- `payment_status`: `unpaid`, `paid`, `refunded`

## 3. Tables

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

## 4. Indexes
- `restaurant_id` on every tenant table.
- `orders (branch_id, status, created_at DESC)`, for the kitchen dashboard.
- `menu_items (category_id, sort_order)` and `menu_categories (restaurant_id, sort_order)`.
- `tables (restaurant_id, table_number)` (already indexed by its UNIQUE constraint).

## 5. How multi-tenancy works
1. Every row carries `restaurant_id`. **Composite FKs** (`(x_id, restaurant_id)` → parent `(id, restaurant_id)`) make it impossible for a child row to point at another tenant's parent row. For example, an item in restaurant A cannot be placed in a category owned by restaurant B.
2. Isolation is enforced **in the database by RLS**, not only in the frontend. The app also filters with `.eq('restaurant_id', currentRestaurantId)` for speed and clarity, but if that filter is missing, data still cannot leak.
3. The helper functions are `SECURITY DEFINER`, `STABLE`, and use `search_path = public`:
   - `is_member(rid uuid) → boolean`: `EXISTS (SELECT 1 FROM restaurant_members WHERE restaurant_id = rid AND user_id = auth.uid())`
   - `has_role(rid uuid, roles member_role[]) → boolean`
4. When a restaurant is created, a trigger adds the creator to `restaurant_members` as `owner`.

## 6. RLS policies
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
  - `place_order(slug text, table_number int, items jsonb, customer_name text, notes text)` is a SECURITY DEFINER RPC. It validates the table, rate-limits per table (see [4-qr-realtime.md](4-qr-realtime.md)), rejects items that are `is_available = false`, inactive, or from another restaurant, takes prices from `menu_items` rather than from the client, computes the totals, assigns `order_number`, inserts the order and its items in one transaction, and returns `public_token`.
  - `get_order_status(public_token uuid)` returns the order's status and items, for the customer's tracking screen.
- **Realtime:** the kitchen and staff subscribe to `orders` filtered by `branch_id`. Realtime respects RLS, so staff receive only their own tenant's events. The customer's tracking screen listens on a Broadcast channel keyed by `public_token`, falling back to polling `get_order_status`. Full design: [4-qr-realtime.md](4-qr-realtime.md).

## 7. Out of scope for Step 1
- Subscriptions/billing, item modifiers/variants, payments integration, and analytics tables. These are left for later steps.

