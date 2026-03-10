# Rentify: Multi-Tenanted Rental Marketplace Platform

## 1. Vision & Scope

Rentify is a **multi-tenanted online rental marketplace** enabling merchants (tenants) to list and rent out physical goods to consumers. The platform is category-agnostic, supporting all rental verticals: camera equipment, baby gear, party hire, power tools, sporting equipment, construction machinery, event furnishings, and any other leaseable physical asset.

The platform operates as a two-sided marketplace: **tenants** (businesses or individuals who own rental inventory) and **renters** (consumers who book items). The platform operator earns revenue via commission on each transaction.

### Core Value Proposition

- Tenants get a fully-managed online storefront with payment processing, availability management, and logistics coordination
- Renters get a unified discovery experience across multiple rental vendors with built-in trust (insurance, inspections, reviews)
- The platform handles the rental-specific complexity (time-based inventory, deposits, condition tracking, return logistics) that generic e-commerce cannot

### Market Context (Australia-First)

Rentify targets the Australian market first. The Australian "hire" economy is multi-billion-dollar and heavily fragmented across verticals (construction equipment, baby gear, party hire, cameras, fashion, consumer electronics). Key market dynamics:

- **Vertical specialists dominate**: Kennards Hire (equipment), Camplify (RVs), GlamCorner (fashion), Hire for Baby (baby gear). No single horizontal marketplace has consolidated general goods rental.
- **Dual-sided fee models are the norm**: Camplify charges 16% owner commission + 10.5% hirer booking fee. Sharehire takes 7.5% from owners. Designerex takes 16-25% as service fee. Platform must support dual-sided fees from day one.
- **Category-adaptive trust stacks**: Different verticals require different trust primitives. Baby gear requires cleaning/sanitisation + safety checks. Equipment requires ID verification + deposits. Fashion requires reverse logistics. A one-size-fits-all trust model won't compete with vertical specialists.
- **Compliance is a competitive moat, not a cost centre**: ACCC consumer guarantees apply to hire/lease, ATO requires platform-level transaction reporting, ASIC unfair contract term reforms carry substantial penalties. Platforms that embed compliance into the product experience (vs. treating it as legal overhead) can differentiate.
- **Operational reliability > catalogue beauty**: The competitive benchmark (per HirePOS, Point of Rental, and category leaders) is accurate availability, predictable fulfilment, and fast issue resolution — not UX polish.

### Out of Scope (v1)

- Rent-to-own / lease-to-purchase conversion (noted as emerging trend — defer to v2)
- Peer-to-peer consumer-to-consumer lending (v1 is B2C marketplace: tenants are businesses or serious individuals)
- In-house delivery fleet (tenants manage their own or use third-party logistics)
- Mobile native apps (responsive web first, native apps in future phase)
- Multi-currency support (AUD only for v1; multi-currency deferred)
- White-label / embedded storefronts (tenant storefronts are platform-hosted subpaths)
- Account-based B2B pricing / quote workflows (enterprise equipment hire — v2)
- Subscription/membership rental models for renters (e.g., "rent X items/month" — v2)

---

## 2. Actors & Roles

| Actor | Description |
|---|---|
| **Platform Admin** | Operates the marketplace. Manages categories, commission rates, tenant onboarding, dispute escalation, platform settings. |
| **Tenant Owner** | Business or individual who creates a tenant account, lists inventory, manages bookings, handles inspections and payouts. |
| **Tenant Staff** | Invited by tenant owner. Can manage listings, bookings, and inspections for the tenant. Configurable permissions. |
| **Renter** | Consumer who browses, books, pays, and returns rental items. |
| **System** | Automated processes: availability sync, payment captures/releases, notifications, maintenance scheduling, payout batching. |

### Role Matrix

A single `User` identity can hold multiple roles:
- A user can be a renter on one tenant's listings and a tenant owner on their own storefront
- Tenant membership is via a join table: `{ user_id, tenant_id, role: owner | admin | staff }`

---

## 3. Domain Model

### 3.1 Entity Relationship Overview

```
Platform
  ├── Categories (hierarchical, platform-global)
  │     ├── attribute_schema (JSONB) — defines custom attrs per category
  │     ├── trust_requirements (JSONB) — category-adaptive trust stack
  │     └── safety_standards / listing_restrictions — regulatory compliance
  ├── Users (shared identity pool)
  │     ├── Addresses
  │     └── Payment methods (via Stripe customer)
  └── Tenants (incl. ABN, GST registration for ATO reporting)
        ├── Tenant Memberships (user ↔ tenant ↔ role)
        ├── Locations (pickup/warehouse points)
        ├── Products (catalog listings)
        │     ├── Product Variants
        │     ├── Pricing Rules (multi-period, tiered)
        │     ├── Seasonal Pricing Rules
        │     ├── Blackout Dates
        │     ├── Damage Waiver Options
        │     └── Inventory Items (physical units)
        │           ├── Condition Inspections
        │           └── Maintenance Records
        ├── Bundles
        │     └── Bundle Items (product refs + quantity)
        ├── Bookings (incl. service fee, booking fee, GST)
        │     ├── Booking Line Items
        │     ├── Payments / Transactions
        │     ├── Deliveries
        │     ├── Inspections (pre/post rental)
        │     ├── Disputes / Damage Claims
        │     ├── Messages (booking-linked conversations)
        │     └── Reviews (bidirectional)
        ├── Payouts
        ├── Coupons / Promotions
        └── Audit Log

Compliance (platform-level):
  ├── Tax Reports (ATO biannual submissions)
  └── Category Safety Attestations
```

### 3.2 Core Entities

#### Tenant

The merchant account. All tenant-scoped data carries `tenant_id` for row-level isolation.

| Field | Type | Notes |
|---|---|---|
| `tenant_id` | UUID PK | Partition/isolation key on all child tables |
| `business_name` | text | Display name |
| `slug` | text unique | URL path segment (e.g., `joes-cameras`) |
| `owner_user_id` | FK → users | Account creator |
| `business_type` | enum | `individual`, `registered_business` |
| `tax_id` | text nullable | VAT/EIN for invoicing |
| `stripe_connect_account_id` | text | Connected account for payouts |
| `abn` | text nullable | Australian Business Number (required for ATO reporting) |
| `gst_registered` | boolean | Whether tenant is GST-registered |
| `commission_rate_bps` | int | Platform fee in basis points (e.g., 1500 = 15%) |
| `payout_schedule` | jsonb | `{ frequency, day_of_week, min_threshold_cents }` |
| `kyc_status` | enum | `pending`, `verified`, `suspended` |
| `branding` | jsonb | `{ logo_url, accent_color, banner_url }` |
| `settings` | jsonb | `{ timezone, currency, default_buffer_hours, policies }` |
| `status` | enum | `onboarding`, `active`, `suspended` |
| `created_at`, `updated_at` | timestamptz | |

#### User

Shared identity across renters and tenant staff.

| Field | Type | Notes |
|---|---|---|
| `user_id` | UUID PK | |
| `email` | text unique | Login + contact |
| `phone` | text nullable | SMS verification |
| `password_hash` | text | bcrypt/argon2 |
| `display_name` | text | Public name |
| `avatar_url` | text nullable | |
| `identity_verified` | boolean | Passed ID check |
| `stripe_customer_id` | text nullable | Payment methods on file |
| `default_address_id` | FK → addresses nullable | |
| `status` | enum | `active`, `suspended`, `banned` |
| `created_at`, `updated_at` | timestamptz | |

#### Tenant Membership

| Field | Type | Notes |
|---|---|---|
| `user_id` | FK → users | |
| `tenant_id` | FK → tenants | |
| `role` | enum | `owner`, `admin`, `staff` |
| PK | composite | `(user_id, tenant_id)` |

#### Category

Platform-global hierarchical taxonomy. Tenants select which categories they operate in.

| Field | Type | Notes |
|---|---|---|
| `category_id` | UUID PK | |
| `parent_category_id` | FK → categories nullable | Self-referencing for tree |
| `name` | text | e.g., "Camera Equipment" |
| `slug` | text unique | URL-safe |
| `icon` | text nullable | Icon identifier |
| `attribute_schema` | jsonb | JSON Schema defining custom attributes for this category (e.g., sensor type, weight capacity, age range) |
| `default_rental_terms` | jsonb | `{ pricing_models, requires_deposit, requires_waiver, buffer_hours }` |
| `trust_requirements` | jsonb | Category-adaptive trust stack (see below) |
| `safety_standards` | jsonb nullable | Applicable mandatory safety standards (e.g., baby sleep product standards) |
| `listing_restrictions` | jsonb nullable | Required warnings, banned claims, image content rules |
| `requires_safety_attestation` | boolean | Tenant must attest compliance before listing in this category |
| `requires_admin_approval` | boolean | Category-gated: listings need platform admin approval |
| `sort_order` | int | Display ordering |

**Category-Adaptive Trust Stack** (`trust_requirements` schema):

Different categories require different trust primitives. This is configurable per category rather than platform-wide:

```json
{
  "identity_verification": "required" | "high_value_only" | "none",
  "deposit": "required" | "optional" | "none",
  "deposit_default_pct": 25,
  "damage_waiver": "required" | "optional" | "none",
  "pre_rental_inspection": "required" | "optional",
  "post_rental_inspection": "required" | "optional",
  "cleaning_attestation": "required" | "none",
  "safety_check_attestation": "required" | "none",
  "condition_photos": "required" | "optional",
  "minimum_tenant_rating": null | 4.0,
  "renter_age_minimum": null | 18
}
```

Examples:
- **Baby gear**: `{ cleaning_attestation: "required", safety_check_attestation: "required", condition_photos: "required", pre_rental_inspection: "required" }`
- **Camera equipment**: `{ identity_verification: "required", deposit: "required", deposit_default_pct: 50, pre_rental_inspection: "required" }`
- **Party hire**: `{ deposit: "required", pre_rental_inspection: "optional" }` (delivery/setup handles inspection)

#### Product (Catalog Listing)

The abstract "thing available for rent" — not a physical unit.

| Field | Type | Notes |
|---|---|---|
| `product_id` | UUID PK | |
| `tenant_id` | FK → tenants | Isolation key |
| `category_id` | FK → categories | |
| `title` | text | Display name |
| `slug` | text | Unique within tenant |
| `description` | text | Rich text / markdown |
| `brand` | text nullable | Manufacturer |
| `model` | text nullable | Model name |
| `year` | int nullable | Manufacture year |
| `custom_attributes` | jsonb | Category-specific fields validated against `category.attribute_schema` |
| `images` | jsonb | Array of `{ url, alt_text, sort_order }` |
| `location_id` | FK → locations | Default pickup point |
| `rental_type` | enum | `hourly`, `daily`, `weekly`, `monthly`, `event` |
| `min_rental_duration` | int | Minimum periods |
| `max_rental_duration` | int nullable | Maximum periods (null = unlimited) |
| `buffer_hours` | int | Turnaround time between rentals |
| `requires_deposit` | boolean | |
| `deposit_amount_cents` | int nullable | Fixed deposit (or use `deposit_pct`) |
| `deposit_pct` | int nullable | % of replacement value |
| `insurance_required` | boolean | |
| `delivery_available` | boolean | |
| `delivery_radius_km` | int nullable | Max delivery distance |
| `delivery_fee_cents` | int nullable | |
| `tags` | text[] | Search enhancement |
| `status` | enum | `draft`, `active`, `paused`, `archived` |
| `created_at`, `updated_at` | timestamptz | |

#### Product Variant

Same product in different configurations (condition tiers, sizes, kits).

| Field | Type | Notes |
|---|---|---|
| `variant_id` | UUID PK | |
| `product_id` | FK → products | |
| `tenant_id` | FK (denormalized) | |
| `name` | text | e.g., "Like New", "Body + Lens Kit" |
| `sku` | text nullable | Internal reference |
| `price_modifier_cents` | int | Add/subtract from base price |
| `attributes` | jsonb | Variant-specific overrides |
| `status` | enum | `active`, `inactive` |

#### Inventory Item (Physical Unit)

The trackable physical asset. This is the key rental-domain entity that has no e-commerce equivalent.

| Field | Type | Notes |
|---|---|---|
| `inventory_item_id` | UUID PK | |
| `product_id` | FK → products | |
| `variant_id` | FK → variants nullable | |
| `tenant_id` | FK (denormalized) | |
| `serial_number` | text nullable | For serialized items |
| `internal_barcode` | text nullable | QR/barcode for scanning |
| `tracking_type` | enum | `serialized` (individual), `bulk` (quantity-based) |
| `quantity_total` | int | 1 for serialized; N for bulk |
| `quantity_available` | int | Computed or denormalized for bulk |
| `condition` | enum | `new`, `like_new`, `good`, `fair`, `needs_repair` |
| `purchase_date` | date nullable | For depreciation |
| `purchase_price_cents` | int nullable | For insurance valuation |
| `current_value_cents` | int nullable | Depreciating replacement value |
| `location_id` | FK → locations | Current physical location |
| `status` | enum | `available`, `rented`, `reserved`, `maintenance`, `retired` |
| `total_rentals` | int | Lifecycle counter |
| `notes` | text nullable | |
| `created_at`, `updated_at` | timestamptz | |

### 3.3 Pricing Entities

#### Pricing Rule

Multi-period pricing with tiered discounts. A product can have multiple rules (one per period type).

| Field | Type | Notes |
|---|---|---|
| `pricing_rule_id` | UUID PK | |
| `product_id` | FK | |
| `tenant_id` | FK (denormalized) | |
| `period_type` | enum | `hourly`, `daily`, `weekly`, `monthly` |
| `base_price_cents` | int | Rate per period |
| `currency` | text | ISO 4217 (e.g., `AUD`, `USD`) |
| `min_periods` | int | Minimum rental in these periods |
| `tiered_discounts` | jsonb | `[{ min_periods: 3, discount_pct: 10 }, { min_periods: 7, discount_pct: 20 }]` |
| `effective_from` | date nullable | For seasonal pricing |
| `effective_to` | date nullable | |
| `priority` | int | Higher wins on overlap |

#### Seasonal / Dynamic Pricing Rule

Calendar-based adjustments layered on top of base rates.

| Field | Type | Notes |
|---|---|---|
| `dynamic_rule_id` | UUID PK | |
| `product_id` or `category_id` | FK | Scope: product-level or category-wide |
| `tenant_id` | FK | |
| `name` | text | e.g., "Summer Peak", "Weekend Surcharge" |
| `date_from`, `date_to` | date | Applicable window |
| `day_of_week_mask` | int nullable | Bitmask for day-of-week rules (e.g., Sat+Sun) |
| `adjustment_type` | enum | `percentage`, `fixed` |
| `adjustment_value` | int | Percentage or cents |
| `recurrence` | enum | `none`, `yearly` |

#### Damage Waiver Option

| Field | Type | Notes |
|---|---|---|
| `waiver_option_id` | UUID PK | |
| `tenant_id` | FK (nullable for platform-global) | |
| `name` | text | e.g., "Basic Protection" |
| `coverage_tier` | enum | `basic`, `standard`, `premium` |
| `pricing_type` | enum | `flat_fee`, `percentage_of_rental`, `per_day` |
| `price_cents` | int | Amount or percentage × 100 |
| `max_coverage_cents` | int | Cap on claims |
| `deductible_cents` | int | Customer pays first $X |
| `covers` | jsonb | `{ accidental: true, theft: true, loss: false }` |
| `exclusions` | text[] | List of exclusion descriptions |
| `terms_url` | text nullable | Link to full T&C |

### 3.4 Availability & Calendar

The availability model uses **availability blocks** (not per-day rows). Availability is computed as the absence of blocks for a given date range.

#### Availability Block

| Field | Type | Notes |
|---|---|---|
| `block_id` | UUID PK | |
| `inventory_item_id` | FK | |
| `tenant_id` | FK (denormalized) | |
| `block_type` | enum | `booking`, `maintenance`, `buffer`, `manual_block` |
| `start_date` | date | |
| `end_date` | date | |
| `period` | daterange | PostgreSQL range type — `[start_date, end_date]` |
| `booking_id` | FK nullable | If block_type = booking |
| `reason` | text nullable | For manual blocks |

**Double-booking prevention**: PostgreSQL exclusion constraint on `(inventory_item_id, period)` using GiST index. This makes overlapping bookings a database-level impossibility.

```sql
EXCLUDE USING GIST (
  inventory_item_id WITH =,
  period WITH &&
)
```

#### Blackout Date

Recurring or one-off date ranges when a product is unavailable (not tied to inventory item).

| Field | Type | Notes |
|---|---|---|
| `blackout_id` | UUID PK | |
| `product_id` | FK | |
| `tenant_id` | FK | |
| `start_date`, `end_date` | date | |
| `reason` | text | |
| `recurrence` | enum | `none`, `yearly` |

### 3.5 Booking & Order Entities

#### Booking

The central transactional entity.

| Field | Type | Notes |
|---|---|---|
| `booking_id` | UUID PK | |
| `booking_number` | text unique | Human-readable (e.g., `RNT-2026-00042`) |
| `tenant_id` | FK | |
| `customer_user_id` | FK → users | The renter |
| `status` | enum | See state machine below |
| `start_date` | date | Rental start |
| `end_date` | date | Rental end |
| `start_time` | time nullable | For hourly rentals |
| `end_time` | time nullable | |
| `pickup_type` | enum | `self_pickup`, `delivery` |
| `delivery_address_id` | FK nullable | |
| `subtotal_cents` | int | Rental fee total |
| `deposit_amount_cents` | int | Security deposit held |
| `insurance_amount_cents` | int | Damage waiver fee |
| `delivery_fee_cents` | int | |
| `service_fee_cents` | int | Tenant-set fee covering cleaning/maintenance/turnaround |
| `booking_fee_cents` | int | Platform booking fee charged to renter (dual-sided fee model) |
| `discount_amount_cents` | int | Coupon / loyalty / tiered |
| `gst_amount_cents` | int | GST component (10% in Australia) |
| `tax_amount_cents` | int | Total tax (GST + any other applicable tax) |
| `total_amount_cents` | int | Grand total charged to renter (includes booking fee) |
| `platform_commission_cents` | int | Commission deducted from tenant's rental fee |
| `currency` | text | |
| `customer_notes` | text nullable | |
| `cancellation_reason` | text nullable | |
| `cancelled_at` | timestamptz nullable | |
| `created_at`, `updated_at` | timestamptz | |

#### Booking State Machine

```
PENDING_APPROVAL ──→ APPROVED ──→ PAYMENT_AUTHORIZED ──→ CONFIRMED
     │                                                       │
     ↓                                                       ↓
  DECLINED                                           PICKED_UP / DELIVERED
                                                             │
                                                             ↓
                                                       ACTIVE_RENTAL
                                                       │          │
                                                       ↓          ↓
                                                  EXTENDED    RETURN_INITIATED
                                                                  │
                                                                  ↓
                                                            RETURNED
                                                          (inspection)
                                                          │         │
                                                          ↓         ↓
                                                    COMPLETED   DISPUTE_OPEN
                                                         │          │
                                                         ↓          ↓
                                                  DEPOSIT_RELEASED  DISPUTE_RESOLVED

Also from any active state:
  *  ──→ CANCELLED (by renter, subject to cancellation policy)
```

#### Booking Line Item

| Field | Type | Notes |
|---|---|---|
| `line_item_id` | UUID PK | |
| `booking_id` | FK | |
| `product_id` | FK | |
| `variant_id` | FK nullable | |
| `inventory_item_id` | FK | Specific unit assigned |
| `quantity` | int | For bulk items |
| `unit_price_cents` | int | Rate at time of booking |
| `period_type` | enum | |
| `periods` | int | Number of periods |
| `line_total_cents` | int | Computed |
| `condition_at_checkout` | enum | Condition when dispatched |
| `condition_at_return` | enum nullable | Condition when returned |

### 3.6 Payment & Financial Entities

#### Payment / Transaction

| Field | Type | Notes |
|---|---|---|
| `payment_id` | UUID PK | |
| `booking_id` | FK | |
| `tenant_id` | FK (denormalized) | |
| `payment_type` | enum | `rental_fee`, `deposit_hold`, `deposit_capture`, `deposit_release`, `insurance_fee`, `late_fee`, `damage_charge`, `extension`, `refund` |
| `amount_cents` | int | |
| `currency` | text | |
| `stripe_payment_intent_id` | text nullable | Provider reference |
| `status` | enum | `pending`, `authorized`, `captured`, `released`, `refunded`, `failed` |
| `created_at` | timestamptz | |

**Deposit flow**: Security deposits use Stripe's manual capture (`capture_method: manual`). Funds are authorized (card hold) but not charged. On successful return, the hold is released. On damage, partial or full capture occurs. Extended authorization supports holds up to 28-30 days.

**Split payment flow (Stripe Connect, dual-sided fees)**:
```
Renter pays $345 total:
  Rental fee:       $200 → split → Tenant ($170) + Platform commission ($30)
  Service fee:      $20  → Tenant (cleaning/maintenance/turnaround)
  Damage waiver:    $30  → Platform waiver fee pool
  Delivery fee:     $20  → Tenant
  Booking fee:      $25  → Platform (10.5% of rental fee + extras, charged to renter)
  GST:              $0   → Calculated per tenant's GST registration
  Deposit hold:     $50  → Pre-auth only (released after successful return)
```

#### Payout

| Field | Type | Notes |
|---|---|---|
| `payout_id` | UUID PK | |
| `tenant_id` | FK | |
| `stripe_transfer_id` | text | Provider reference |
| `amount_cents` | int | Net after commission |
| `commission_deducted_cents` | int | Platform fee |
| `currency` | text | |
| `status` | enum | `pending`, `processing`, `completed`, `failed` |
| `payout_period_start`, `payout_period_end` | date | Covered bookings window |
| `scheduled_for` | date | |
| `completed_at` | timestamptz nullable | |

### 3.7 Inspection, Maintenance & Condition Tracking

#### Condition Inspection

| Field | Type | Notes |
|---|---|---|
| `inspection_id` | UUID PK | |
| `booking_id` | FK nullable | |
| `inventory_item_id` | FK | |
| `inspection_type` | enum | `pre_rental`, `post_rental`, `maintenance`, `intake` |
| `condition_grade` | enum | `A` (like new), `B` (good), `C` (fair), `D` (needs repair), `X` (retired) |
| `checklist` | jsonb | `[{ item: "Lens glass", pass: true }, { item: "Battery", pass: false, note: "..." }]` |
| `photos` | jsonb | Array of image URLs |
| `damage_found` | boolean | |
| `damage_description` | text nullable | |
| `estimated_repair_cost_cents` | int nullable | |
| `inspected_by_user_id` | FK | |
| `created_at` | timestamptz | |

#### Maintenance Record

| Field | Type | Notes |
|---|---|---|
| `maintenance_id` | UUID PK | |
| `inventory_item_id` | FK | |
| `tenant_id` | FK | |
| `type` | enum | `scheduled`, `repair`, `cleaning`, `calibration` |
| `description` | text | What was done |
| `cost_cents` | int nullable | |
| `scheduled_date` | date | |
| `completed_date` | date nullable | |
| `performed_by` | text | Staff name or vendor |
| `status` | enum | `scheduled`, `in_progress`, `completed`, `cancelled` |
| `triggered_by_inspection_id` | FK nullable | |

### 3.8 Reviews & Trust

#### Review

Bidirectional: renters review products/tenants, tenants review renters.

| Field | Type | Notes |
|---|---|---|
| `review_id` | UUID PK | |
| `booking_id` | FK | One review per direction per booking |
| `reviewer_user_id` | FK | |
| `reviewee_type` | enum | `product`, `tenant`, `customer` |
| `reviewee_id` | UUID | Polymorphic FK |
| `rating` | int | 1-5 |
| `comment` | text | |
| `response` | text nullable | Tenant reply |
| `status` | enum | `pending_moderation`, `published`, `hidden` |
| `created_at` | timestamptz | |

### 3.9 Delivery & Logistics

#### Delivery

| Field | Type | Notes |
|---|---|---|
| `delivery_id` | UUID PK | |
| `booking_id` | FK | |
| `type` | enum | `delivery`, `return_pickup` |
| `address_id` | FK | |
| `scheduled_datetime` | timestamptz | |
| `actual_datetime` | timestamptz nullable | |
| `fee_cents` | int | |
| `status` | enum | `scheduled`, `in_transit`, `completed`, `failed` |
| `tracking_reference` | text nullable | |
| `driver_notes` | text nullable | |

### 3.10 Disputes & Damage Claims

#### Dispute

| Field | Type | Notes |
|---|---|---|
| `dispute_id` | UUID PK | |
| `booking_id` | FK | |
| `opened_by_user_id` | FK | |
| `type` | enum | `damage`, `missing_item`, `late_return`, `billing`, `quality` |
| `description` | text | |
| `evidence_photos` | jsonb | Array of URLs |
| `amount_claimed_cents` | int nullable | |
| `status` | enum | `open`, `under_review`, `resolved_for_tenant`, `resolved_for_customer`, `escalated` |
| `resolution_notes` | text nullable | |
| `amount_awarded_cents` | int nullable | |
| `resolved_at` | timestamptz nullable | |

### 3.11 Supporting Entities

#### Address
`{ address_id, user_id | tenant_id, line1, line2, city, state, postal_code, country, lat, lng }`

#### Location (Tenant Pickup Points)
`{ location_id, tenant_id, name, address_id, operating_hours (jsonb), is_default }`

#### Message (Booking-Linked Messaging)
`{ message_id, conversation_id, sender_user_id, recipient_user_id, booking_id (nullable), content, read_at, created_at }`

Conversations are typically tied to a booking or product inquiry. Platform can moderate messages (flag keywords, prevent sharing of contact details to keep transactions on-platform).

#### Notification
`{ notification_id, user_id, type, channel (email|sms|push), payload (jsonb), sent_at, read_at }`

#### Coupon / Promotion
`{ coupon_id, tenant_id, code, type (percentage|fixed), value, min_order_cents, valid_from, valid_to, usage_limit, usage_count }`

#### Bundle
`{ bundle_id, tenant_id, name, description, pricing_type, price_cents, valid_from, valid_to, items: [{ product_id, quantity }] }`

#### Audit Log
`{ log_id, tenant_id, user_id, action, entity_type, entity_id, changes (jsonb), ip_address, created_at }`

---

## 4. Purchase Funnel (Booking Flow)

### Stage 1: Search & Discovery

**Inputs**: Category browse, text search, map/location search, direct URL, date-range filter.

**Behaviour**:
- Category tree navigation with faceted search (dynamic counts per filter)
- Text search across product title, description, brand, model, tags
- Location-based filtering: "near me" with radius control, or specific city/area
- **Date-range filter is primary**: renter selects desired dates first; only products with available inventory for that range are shown
- Filters: category, subcategory, price range, dates, location/radius, condition, brand, rating, delivery available
- Sort: relevance, price (low/high), distance, rating, newest
- Results show: thumbnail, title, daily price, rating, distance, availability indicator

**Availability check at search time**: For each matching product, compute available unit count for the requested date range:
```
available_count = total_units(status=available)
  - units with overlapping booking blocks
  - units with overlapping maintenance blocks
  - units with overlapping manual blocks
  - blackout date exclusions
```

Only products with `available_count > 0` appear in results.

### Stage 2: Product Detail Page

**Content**:
- Image gallery (multiple images with zoom)
- Title, description, brand/model/year
- Specifications table (rendered from `custom_attributes` per category schema)
- Pricing breakdown: daily/weekly/monthly rates with tiered discount table
- Availability calendar (visual — shows available/unavailable dates)
- Insurance/waiver options with coverage details
- Delivery options and fee
- Pickup location with map
- Tenant profile card: name, rating, response rate, total rentals
- Reviews (sortable by recency, rating)
- Related/similar products

**Interactive elements**:
- Date picker (start + end) with real-time availability check
- Variant selector (if applicable)
- "Add to booking" / "Book now" CTA
- "Message tenant" for questions

### Stage 3: Booking Creation

**Flow**:
1. Renter selects dates, variant, quantity
2. System assigns specific inventory items (or reserves from bulk pool)
3. Renter selects insurance tier
4. Renter selects pickup vs. delivery (if available)
5. Renter optionally adds accessories or bundle items
6. Real-time price calculator shows:
   - Base rental fee (rate × periods)
   - Tiered discount (if applicable)
   - Seasonal adjustment (if applicable)
   - Service fee (tenant-set: cleaning/turnaround)
   - Damage waiver fee
   - Delivery fee
   - **Subtotal**
   - Platform booking fee (% of subtotal, charged to renter)
   - GST (10%, shown if applicable)
   - **Total charge**
   - Security deposit (held separately, not charged — shown as "card hold")
   - **Total charge + deposit hold**

### Stage 4: Identity & Deposit

**First-time renters**:
- Email verification (mandatory)
- Phone verification (mandatory for high-value items)
- ID verification via Stripe Identity or equivalent (for rentals above configurable threshold)
- Digital rental agreement acceptance (liability, return conditions, cancellation policy)

**Deposit**:
- Pre-authorization (card hold) for deposit amount
- No actual charge — funds reserved only
- Hold duration: up to 28-30 days (Stripe extended authorization)
- For rentals exceeding hold window: deposit charged upfront with refund after return

### Stage 5: Payment Processing

**Payment architecture**: Stripe Connect (Express accounts).

**Charge breakdown**:
1. **Rental fee + insurance + delivery + tax**: Charged immediately (or on rental start, per tenant policy)
2. **Security deposit**: Pre-authorized (manual capture), separate PaymentIntent
3. **Platform commission**: Deducted from rental fee as application fee via Stripe Connect

**Escrow behavior**: Rental fee held by Stripe until payout schedule triggers transfer to tenant's connected account.

### Stage 6: Booking Confirmation

**Outputs**:
- Confirmation screen with booking details and booking number
- Email confirmation with: dates, item details, pickup/delivery info, cancellation policy, rental agreement link
- Calendar event (ICS) with pickup/return times
- Push notification (if app)
- Tenant receives booking notification with preparation instructions

### Stage 7: Pickup / Delivery

**Self-pickup flow**:
1. Tenant prepares item, runs pre-rental inspection (photos + checklist)
2. Renter arrives at pickup location
3. Renter verifies item, signs digital receipt
4. Booking transitions to `ACTIVE_RENTAL`

**Delivery flow**:
1. Tenant or courier delivers item to renter's address
2. Pre-rental inspection documented before dispatch
3. Renter accepts delivery (digital signature or confirmation)
4. Booking transitions to `ACTIVE_RENTAL`

### Stage 8: Active Rental Period

**Available actions**:
- **Extension request**: Renter requests additional days/weeks. Triggers availability check for the extension window. If available, creates extension charge and adjusts booking end date.
- **Issue reporting**: Renter reports malfunction or problem. Creates support ticket for tenant.
- **Messaging**: Renter ↔ tenant direct messaging tied to booking.
- **Automated reminders**: System sends return reminder 24h and 2h before end date.

### Stage 9: Return & Inspection

1. Renter initiates return (or auto-triggered at end date)
2. For delivery bookings: return pickup scheduled
3. For self-pickup: renter returns to location
4. **Post-rental inspection**:
   - Condition grade compared against pre-rental baseline
   - Photos taken, checklist completed
   - If condition unchanged or acceptable wear: `COMPLETED`
   - If damage found: `DISPUTE_OPEN`, deposit partially/fully captured
5. Inventory item status updated based on inspection
6. Buffer block created for turnaround before next availability

### Stage 10: Post-Rental Settlement

1. If no damage: deposit hold released (customer sees authorization drop off card)
2. If damage claim: deposit partially/fully captured, renter notified with evidence
3. Review prompts sent to both parties (24-48h after return)
4. Tenant payout calculated: rental fee - platform commission
5. Payout batched per tenant's payout schedule
6. Dispute window: 48-72h for damage claims after return

---

## 5. Australian Regulatory & Compliance Requirements

These are legal obligations that shape the data model and platform behaviour, not optional features.

### 5.1 Consumer Guarantees (ACCC)

The ACCC confirms that most Australian Consumer Law consumer guarantees apply when a consumer **hires or leases** a product, even though ownership-related guarantees do not apply. Online platforms have the same responsibilities as physical businesses. Implications:

- **Complaint handling and dispute resolution**: Platform must have clear, accessible processes (not just tenant-managed). The ACCC expects platform operators to have complaint-handling infrastructure.
- **Accurate trust claims**: Any claims about safety, security, verification, or trust (e.g., "verified sellers", "safety-checked") must be substantiated. Do not display trust badges unless the underlying process exists.
- **Refund/remedy workflows**: Platform must support structured remedy flows when goods are not of acceptable quality, not fit for purpose, or don't match description.

**Data model impact**: The `Dispute` entity must support ACCC-aligned resolution types. Platform needs a `complaint` type distinct from `damage` disputes.

### 5.2 Product Safety (Product Safety Australia)

Certain categories have mandatory safety standards that affect what can be listed and how:

- **Baby sleep products** (bassinets, cots, co-sleepers, portable folding cots): Two mandatory standards (safety + information). Marketing imagery can trigger regulatory classification — an inclined non-sleep product marketed with sleep imagery may be treated as a sleep product.
- **Other regulated products**: Children's toys, electrical equipment, protective equipment.

**Data model impact**: Category entity needs:
- `safety_standards` (jsonb) — list of applicable mandatory standards
- `listing_restrictions` (jsonb) — required warnings, banned claims, image content rules
- `requires_safety_attestation` (boolean) — tenant must attest compliance before listing in this category

Platform must support **category gating**: certain categories require tenant attestation or admin approval before products can go live.

### 5.3 Tax Reporting (ATO Sharing Economy Reporting Regime)

From 1 July 2024, electronic distribution platforms must report **all reportable transactions** to the ATO, explicitly including "movable assets such as heavy vehicles, caravans, and aquatic vessels" and other hire/loan-of-asset transactions. Reporting is **biannual** with defined due dates.

**Data model impact**:
- Tenant entity needs: `abn` (Australian Business Number), `tax_registration_status` (enum: `registered`, `not_registered`, `pending`), `gst_registered` (boolean)
- Platform must collect and validate tenant identity + ABN during onboarding
- Transaction records must be exportable in ATO-required format
- New entity: **Tax Report** `{ report_id, period_start, period_end, submitted_at, status, tenant_count, transaction_count }`

### 5.4 Privacy & Data Breach (OAIC / Privacy Act)

If the Privacy Act covers the organisation (revenue > $3M threshold, or handling health/financial data), mandatory data breach notification applies: notify affected individuals and the OAIC when a breach involving personal information is likely to result in serious harm.

**Data model impact**: PII fields must be identified and encrypted at rest. Audit log must track access to PII. Platform needs an incident response workflow (out of scope for v1 app code, but infra/ops requirement).

### 5.5 Unfair Contract Terms (ASIC)

Since 9 November 2023, unfair terms in standard-form contracts are **illegal** with substantial penalties per contravention. Each unfair term is a separate contravention.

**Platform impact**: Standard rental agreements, cancellation policies, fee structures, deposit terms, and dispute processes must be reviewed for fairness. The platform's templated terms (used by tenants) must not be unfair. Cancellation policies must offer reasonable options (not just "no refunds").

### 5.6 GST Handling

Australian GST is 10%. Tenants may or may not be GST-registered (threshold: $75K annual turnover).

**Data model impact**:
- Booking entity: `gst_amount_cents` field (breakdown of GST within total)
- Payout: GST treatment depends on tenant's GST registration status
- Platform fees: the platform's own commission is a taxable supply (platform charges GST on its commission to GST-registered tenants)
- Tax invoices must be generated for GST-registered tenants

### 5.7 Insurance vs. Damage Waiver (Legal Framing)

The platform does **not** provide insurance (which is a regulated financial product in Australia). What the platform offers are **damage waivers** / **damage liability reduction** arrangements:

- A damage waiver reduces or eliminates the renter's financial exposure to accidental damage, typically by capping the renter's liability at a defined excess amount
- Framing must avoid implying the platform is an insurer or that the waiver is an insurance product
- Platform earns the waiver fee; claims against waivers are settled from the waiver fee pool or deposit

**Rename in data model**: The entity previously called "Insurance / Damage Waiver Option" is renamed to **Damage Waiver Option** throughout.

---

## 6. Multi-Tenancy Design

### 6.1 Data Isolation

**Strategy**: Shared database, shared tables, `tenant_id` on every tenant-scoped row.

- Every query in tenant context includes `WHERE tenant_id = ?`
- PostgreSQL Row-Level Security (RLS) as safety net
- `tenant_id` denormalized onto child tables (no join required to enforce isolation)
- Composite indexes: `(tenant_id, ...)` on all primary query patterns

### 6.2 Tenant Storefront

Each tenant gets a storefront accessible at `/store/{slug}`:
- Custom branding (logo, accent color, banner)
- Curated product catalog (their listings only)
- About page and rental policies
- Contact information and pickup locations
- Aggregated ratings and review count

### 6.3 Commission & Fees (Dual-Sided Model)

Australian marketplace benchmarks show dual-sided fees are the norm. Rentify charges both sides:

| Fee | Payer | Implementation | Benchmark |
|---|---|---|---|
| **Tenant commission** | Tenant (deducted from payout) | `commission_rate_bps` per tenant | Camplify 16%, Sharehire 7.5%, Designerex 16-25% |
| **Renter booking fee** | Renter (added to checkout total) | `booking_fee_rate_bps` platform-wide setting | Camplify 10.5% of hire fee + extras |
| **Tiered commission** | Tenant | `commission_rate_bps` overridable per tenant based on volume tier | Standard marketplace practice |
| **Tenant service fee** | Renter (set by tenant) | Per-product `service_fee_cents` covering cleaning/maintenance/turnaround | Camplify owner-set service fee |

The booking fee is presented transparently at checkout (ACCC requirement: no hidden fees, no misleading conduct). The booking fee justifies platform services: payment security, support, verification, availability management.

### 6.4 Payout Configuration

Per-tenant configurable:
- **Frequency**: daily, weekly (specific day), bi-weekly, monthly
- **Hold period**: minimum days after rental completion before payout eligible
- **Minimum threshold**: don't transfer until balance exceeds threshold
- **Method**: Stripe Connect transfer to tenant's connected bank account

### 6.5 Tenant Analytics Dashboard

Metrics exposed per tenant:
- Revenue: gross, net (after commission), trending over time
- Booking volume, conversion rate (product views → bookings)
- Average rental duration, average order value
- Utilization rate per product (% of days rented vs. available)
- Top-performing products
- Customer satisfaction (average rating)
- Inventory health (items in maintenance, depreciation alerts)

### 6.6 Platform Admin Dashboard

- GMV (gross merchandise value), platform revenue (commissions)
- Tenant acquisition, active tenants, churn rate
- Category performance
- Geographic demand heatmap
- Dispute rate and resolution metrics
- Payout processing status

---

## 7. Non-Functional Requirements

### 7.1 Performance

- Search results: < 300ms for 95th percentile
- Availability check: < 100ms for a single product, < 500ms for search page (batch)
- Booking creation: < 2s end-to-end (including payment authorization)
- Page load: < 2s LCP on 3G connection

### 7.2 Scalability

- Support 1,000+ tenants, 100,000+ products, 10,000+ concurrent users (v1 target)
- Availability block table will grow fastest — partition by tenant_id or date range
- Search index (Meilisearch, Elasticsearch, or Algolia) for product discovery — not direct DB queries

### 7.3 Security

- All monetary values stored as cents (integer) to avoid floating-point errors
- PII encrypted at rest (email, phone, addresses, tax IDs)
- Stripe handles all card data (PCI DSS compliance via Stripe Elements, never touch raw card data)
- RBAC: tenant staff can only access their own tenant's data
- Rate limiting on auth endpoints, booking creation, search
- CSRF protection on all state-mutating endpoints
- Input sanitization for XSS prevention in user-generated content (descriptions, reviews)

### 7.4 Reliability

- Booking creation must be atomic: either all steps succeed (availability reserved, payment authorized, booking created) or all roll back
- Idempotent payment operations (Stripe idempotency keys)
- Retry with backoff for webhook delivery
- Database transactions with appropriate isolation level for availability checks (SERIALIZABLE for booking creation)

### 7.5 Observability

- Structured logging with correlation IDs per request
- Booking lifecycle events emitted for audit trail
- Payment event tracking for reconciliation
- Error alerting on: failed payments, double-booking attempts, payout failures

### 7.6 Data Integrity

- All timestamps in UTC, timezone stored on tenant/product for display conversion
- Soft deletes for tenants, users, products (status flags, not row deletion)
- Audit log for all write operations on financial entities
- Booking price calculated and locked at creation time (immune to subsequent price changes)

---

## 8. Technical Architecture Guidance

### 8.1 Starting Architecture

Modular monolith with clear bounded contexts. Extract services only when scaling demands it. Bounded contexts:

1. **Catalog** — products, categories, variants, attributes
2. **Inventory** — physical units, condition, maintenance, availability blocks
3. **Booking** — reservation lifecycle, line items, extensions
4. **Payments** — charges, deposits, refunds, payouts (Stripe integration)
5. **Identity** — users, tenants, memberships, auth, verification
6. **Reviews** — ratings, moderation
7. **Notifications** — email, SMS, push delivery
8. **Search** — product discovery, faceted search (backed by search engine)

### 8.2 Database

PostgreSQL with:
- Range types + exclusion constraints for double-booking prevention
- JSONB + GIN indexes for custom attributes
- Row-Level Security for tenant isolation
- Full-text search via `tsvector` (supplemented by external search engine for production)

### 8.3 Payments

Stripe Connect (Express accounts):
- Tenant onboarding via Stripe Connect Onboarding
- Charges via destination charges with application fee
- Deposits via manual capture PaymentIntents
- Payouts via Stripe scheduled transfers
- Webhooks for payment event processing

### 8.4 Search

External search engine (Meilisearch recommended for cost, Algolia for managed):
- Product catalog indexed with: title, description, brand, model, tags, category, location, price, rating
- Faceted filtering on category, price range, location, condition, availability
- Geo-search for location-based discovery

---

## 9. Glossary

| Term | Definition |
|---|---|
| **Tenant** | A business or individual who lists rental inventory on the platform (the "merchant" / "vendor" / "lender") |
| **Renter** | A consumer who books and pays to use a rental item (the "customer" / "borrower") |
| **Product** | A catalog listing describing something available for rent (abstract — not a physical unit) |
| **Inventory Item** | A specific physical unit of a product, with its own serial number, condition, and lifecycle |
| **Variant** | A configuration of a product (e.g., condition tier, size, kit composition) |
| **Booking** | A reservation of one or more inventory items for a date range, with associated payment |
| **Availability Block** | A date range during which an inventory item is unavailable (booked, maintenance, manual block) |
| **Buffer Time** | Turnaround period between rentals for cleaning, inspection, or preparation |
| **Deposit Hold** | Pre-authorization on a renter's payment method; no charge unless damage occurs |
| **Damage Waiver** | Fee-based arrangement reducing renter's liability for accidental damage; not regulated insurance |
| **Booking Fee** | Platform fee charged to renter at checkout (dual-sided fee model) |
| **Service Fee** | Tenant-set fee covering cleaning, sanitisation, maintenance between rentals |
| **Payout** | Transfer of earned rental fees (minus commission) from platform to tenant |
| **Commission** | Platform's percentage fee deducted from tenant's rental revenue |
| **Trust Stack** | Category-adaptive set of trust requirements (ID verification, deposits, inspections, safety attestations) |
| **Condition Grade** | A–D scale rating an inventory item's physical condition (A=like new, D=needs repair, X=retired) |
| **Inspection** | Documented condition check (photos + checklist) performed before or after a rental |
| **ABN** | Australian Business Number — required for ATO sharing economy transaction reporting |
| **GST** | Goods and Services Tax (10% in Australia) — applicable to platform fees and rental transactions |
| **Category Gating** | Admin approval required before tenants can list in safety-regulated categories |
