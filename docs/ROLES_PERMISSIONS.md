# Pasalho Lite V1 — Roles & Permissions

## 1. Roles

V1 uses only three operational roles:

- OWNER_ADMIN
- CASHIER_STORE
- WAREHOUSE_STAFF

Avoid adding fine-grained role complexity until real operations require it. All authorization must be enforced server-side.

## 2. Permission matrix

| Capability | Owner/Admin | Cashier/Store | Warehouse Staff |
|---|---:|---:|---:|
| View dashboard | Yes | Limited store view | Limited warehouse view |
| Create/edit products | Yes | No | No |
| Change selling price | Yes | No | No |
| Activate/deactivate product | Yes | No | No |
| View warehouse stock | Yes | Optional read | Yes |
| View store stock | Yes | Yes | Read |
| Post purchase receipt | Yes | No | Yes |
| Create transfer | Yes | No | Yes |
| Dispatch transfer | Yes | No | Yes |
| Receive transfer at store | Yes | Yes | No |
| Stock adjustment | Yes | No by default | No by default |
| Use POS | Yes | Yes | No |
| Finalize POS sale | Yes | Yes | No |
| Create customer | Yes | Yes | No |
| View customer purchase history | Yes | Yes as needed | No |
| Create WhatsApp/COD order | Yes | Yes | No |
| Confirm COD order | Yes | Yes | No |
| Pack COD order | Yes | Yes | No |
| Dispatch COD order | Yes | Yes | No |
| Mark COD delivered | Yes | Yes | No |
| Record COD collection | Yes | Yes | No |
| Process standard return | Yes | Yes with original sale/order | No |
| Override unusual refund | Yes | No | No |
| Loyalty manual adjustment | Yes | No | No |
| View loyalty ledger | Yes | Yes for active customer | No |
| Record expense/cash payout | Yes | Yes if policy allows | No |
| Enter physical cash count | Yes | Yes | No |
| Close operating day | Yes | Yes |
| Reopen closed day | Yes | No | No |
| View audit log | Yes | No | No |
| Manage users | Yes | No | No |

## 3. Owner/Admin controls

Only Owner/Admin should be able to perform:

- stock adjustment without an upstream business transaction
- manual loyalty adjustment
- product price changes
- user/role changes
- reopening a closed business day
- high-risk refund override
- correction of posted operational records through supported reversal/correction flows

These actions require audit logs.

## 4. Cashier controls

Cashier must not be able to:

- directly overwrite stock
- change cost price
- silently alter a finalized sale
- manually grant loyalty points
- delete sales/orders/payments
- reopen prior daily close
- create arbitrary inventory movements

Returns must reference original transactions.

## 5. Warehouse controls

Warehouse staff must not be able to:

- operate POS
- change retail price
- grant loyalty points
- mark COD orders delivered
- edit daily cash close
- directly overwrite warehouse balance

Warehouse stock corrections require Owner/Admin approval or a future explicitly approved workflow.

## 6. Authentication requirements

- only active users may authenticate
- password hashes use a modern adaptive algorithm
- sessions expire
- session cookies, if used, are secure and HTTP-only in production
- permission checks occur on the server
- user deactivation invalidates future access
- authentication failures must not reveal sensitive account details

## 7. Audit expectations

Always audit:

- user created/deactivated/role changed
- product price changed
- stock adjustment
- receipt reversal
- transfer dispatch/receive correction
- refund override
- loyalty adjustment
- daily close reopen
- other admin corrections

Operational transactions such as normal POS sales and COD status changes already provide their own transactional history but may also emit summarized audit records.
