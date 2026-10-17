# Roastery Manager Pro — TestSprite test plan

What the TestSprite suite must prove about the staging app, written so the
generated tests check **numbers**, not just that a page opened.

- **App:** https://roastery-manager-hackathon.vercel.app (staging copy, demo data only)
- **Story:** green coffee arrives in lots → roasting draws from the **oldest lot
  first (FIFO)** → roasted coffee is packed into barcoded lots → every pack can be
  **traced back** to its batch, green lot and supplier. Each role only sees its
  own part of that flow.

## Accounts

Sign in with the **username** (or the email) in the single "Email or Username"
field. Passwords are entered in the TestSprite portal, never in this repo.

| Username | Name | Role |
|---|---|---|
| `admin` | Admin Demo | Admin |
| `leader` | Hendra Leader | Production Leader |
| `roaster` | Gavin Roaster | Roaster |
| `packing` | Putri Packing | Packing Team |
| `sales` | Rina Sales | Sales Agent |

## Rules for every test (shared live data)

Every pull request runs the suite against the **same** staging database, so:

1. **Assert differences, not absolute stock.** Read the value before the action,
   act, read it again, compare. Absolute values are only used for data no test
   changes (codes, suppliers, dates in the reference table below).
2. **Use small quantities** — 500 g of green coffee, never more than 1 kg.
3. **Clean up what you create.** A roast batch made by a test is deleted by the
   same test (TC-04); deleting a batch returns its green coffee to the lots.
4. **Never finalize a stock take.** TC-08 opens one and must **always cancel it**,
   even when an assertion fails — an open stock take freezes all stock for every
   other test.
5. If staging needs a reset, `database/seed_demo.sql` rebuilds the demo data
   (see `database/STAGING_SETUP.md`); the reference values below then shift by
   the number of days since 2026-10-14.

## Reference data (seeded 2026-10-14)

| Green coffee | Lots (arrival date → supplier) |
|---|---|
| Aceh Gayo Arabica (code 11) | `11-GL-260726-01` 2026-07-26 (older) · `11-GL-260919-01` 2026-09-19 (newer) → Gayo Highland Cooperative |
| Toraja Sapan Arabica (12) | `12-GL-260731-01` (empty) · `12-GL-260929-01` → Sapan Valley Estate |
| Flores Bajawa Arabica (15) | `15-GL-260706-01`, 5 kg — below the 10 kg low-stock threshold |

| Pack barcode (strip code) | Product | Should trace to |
|---|---|---|
| `10014` | Aceh Gayo Arabica 250 g | roasted 2026-09-26 on Probat P5 (Machine #1), packed 2026-09-27, green lot received 2026-07-26 from **Gayo Highland Cooperative**, process Wet Hulled |
| `30015` | Toraja Sapan Arabica 1000 g | packed 2026-10-08, **Sapan Valley Estate**, process Natural |

Machines: `Probat P5 (Machine #1)`, `Giesen W6 (Machine #2)`, `Sample Roaster 1kg`.

---

## Scenarios

Priority **P1** = must pass on every PR. **P2** = run on every PR once P1 is stable.

### TC-01 Sign in with username or email (P1)
1. Sign in as `admin` using the username → the dashboard opens and shows "Production Dashboard".
2. Sign out (sidebar "Log Out"); sign in with the admin **email** → dashboard opens.
3. Username `admin` with a wrong password → an alert containing "Invalid login credentials"; still on the login screen.
4. Unknown username `no-such-user` → the **same** "Invalid login credentials" message (the form must not reveal which usernames exist).
5. Username typed as ` Admin ` (capital, surrounding spaces) → signs in like `admin`.

### TC-02 Each role sees only its menus (P1)
Sign in as each role and check the sidebar (expand **Inventory** where shown).

| Role | Must show | Must NOT show |
|---|---|---|
| `admin` | Dashboard, Inventory (Greenbean, Bulk Roasted, Packed Coffee, Other Items), Production, Packing, CRM, Goods Handover, Purchasing, Reports, Tracking, Setting | — |
| `roaster` | Dashboard, Inventory (Greenbean, Bulk Roasted, Packed Coffee), Production, Purchasing, Setting | Packing, CRM, Goods Handover, Reports, Tracking, Other Items |
| `packing` | Dashboard, Inventory (Other Items only), Packing, Goods Handover, Purchasing, Tracking, Setting | Production, CRM, Reports, Greenbean |
| `sales` | Dashboard, Inventory (Other Items only), CRM, Goods Handover, Purchasing, Reports, Tracking, Setting | Production, Packing, Greenbean |

Also for `sales`: CRM shows the **Customer** tab and does **not** show the **Performance** tab.
For `admin`: Setting shows **User Management** listing the five test users with `@username` under each email.

### TC-03 Roasting draws from the oldest green lot first — FIFO (P1)
Signed in as `roaster`.
1. Inventory → Greenbean. Note **Stock Weight** of *Aceh Gayo Arabica* (= S).
2. Click the Aceh Gayo row → **Stock History**. Note which Gayo lot has the **oldest arrival date and stock left** (= L_old; `11-GL-260726-01` while it has stock).
3. Production → **Batch Logs** → **Log Roast Batch**: Roaster Machine `Probat P5 (Machine #1)`, Coffee `Aceh Gayo Arabica`, Greenbean Weight `500`, Roasted Weight `420` → **ROASTED!!**.
4. Assert: the batch appears at the top of Batch Logs with Batch (g) 500 and Yield (g) 420; note its batch code (= B).
5. Assert: Greenbean → Aceh Gayo Stock Weight is now **S − 0.5 kg**.
6. Assert: Stock History's newest **Roasted** row is **−0.5** on lot **L_old**, and no row was added for the newer lot.

### TC-04 Deleting a batch returns its green coffee exactly (P1)
Continues TC-03, signed in as `admin`.
1. Production → Batch Logs → delete batch **B** → the "Delete batch?" dialog lists what will be reversed → **Yes, delete**.
2. Assert: B is gone from Batch Logs.
3. Assert: Aceh Gayo Stock Weight is back to **S** (to 0.01 kg).
4. Assert: lot L_old's balance in Stock History is back to its value before TC-03.

### TC-05 Stock cannot go negative — insufficient green coffee (P1)
Signed in as `admin`.
1. Note Flores Bajawa Arabica Stock Weight (= F, 5 kg when seeded).
2. Log Roast Batch with Coffee `Flores Bajawa Arabica`, Greenbean Weight `(F + 1) × 1000` grams, Roasted Weight 1000.
3. Assert: an inline warning "Insufficient Greenbean Stock" appears under the form.
4. Press **ROASTED!!** → a confirmation "Insufficient Greenbean Stock! Proceed anyway?" appears → choose **Cancel**.
5. Assert: no new batch in Batch Logs; Flores Bajawa Stock Weight is still **F**; no lot balance in its Stock History is below 0.

### TC-06 Roasted weight can't exceed green weight (P1)
Signed in as `roaster`. Log Roast Batch, Coffee `Aceh Gayo Arabica`, Greenbean 500, Roasted **600**.
Assert: the message "Roasted weight can't exceed greenbean weight." appears, the form stays open, nothing is saved, Aceh Gayo stock unchanged.

### TC-07 A pack barcode traces back to its supplier (P1)
Signed in as `packing` (Tracking is part of their job).
1. Tracking → enter `10014` → **Search**.
2. Assert the result shows: product Aceh Gayo Arabica; Supplier **Gayo Highland Cooperative**; Process **Wet Hulled**; Machine **Probat P5 (Machine #1)**; Roasting Date **2026-09-26**; Packing Date **2026-09-27**; Greenbean Received **2026-07-26**.
3. Search `30015` → Supplier **Sapan Valley Estate**, Process **Natural**.
4. Search `99999` → "No lot found for that barcode. Double-check the code and try again." and no result card.

### TC-08 An open stock take freezes stock (P1)
Signed in as `admin`. **Always run the cleanup step.**
1. Reports → **Stock Opname** → **New Stock Take** → choose the Greenbean category.
2. Assert: a red banner "Stock opname in progress … stock changes are locked" is visible.
3. Note Aceh Gayo Stock Weight (= S). Try Log Roast Batch: `Aceh Gayo Arabica`, 500 g / 420 g.
4. Assert: a dialog titled **Stock opname in progress** says "A stock count (stock opname) is in progress. Stock cannot change until it is finished or cancelled — nothing was saved."; no new batch; Aceh Gayo still **S**.
5. **Cleanup:** Reports → Stock Opname → **Cancel** the stock take → the banner disappears; the take shows status **Cancelled** in history.

### TC-09 Dashboard totals agree with the inventory pages (P2)
Signed in as `admin`.
1. Dashboard → note **Greenbean Stock** (kg) and **Packed Retail Stock** (bags).
2. Assert Greenbean Stock equals the sum of the Stock Weight column on Inventory → Greenbean.
3. Assert Packed Retail Stock equals the sum of the bag quantities listed on Inventory → Packed Coffee.
4. Assert **Pending Sales Requests** equals the number of requests waiting for approval in Goods Handover.

### TC-10 Order to dispatch, across roles (P2)
1. As `sales`: Goods Handover → create a sales request for customer **Kedai Senja** — 1 × Aceh Gayo Arabica 250 g (Probat P5) → it appears with status **Pending Approval**.
2. As `leader`: approve that request → status changes from Pending Approval.
3. As `packing`: check it out from packed stock → the Aceh Gayo 250 g packed quantity drops by exactly 1 and the request becomes **Dispatched**.
4. As `sales`: the request shows **Dispatched**.

### TC-11 Language switch keeps the app usable (P2)
Signed in as `sales`: switch the header language to **العربية (AR)** → the layout turns right-to-left and the sidebar labels are Arabic; switch back to **English (EN)** → English labels return.

---

## Not in this suite on purpose

Known-bug checks are added by the pull request that fixes the bug, so the PR
shows the test failing first and passing after the fix — keeping them out of
`main` keeps `main` green.
