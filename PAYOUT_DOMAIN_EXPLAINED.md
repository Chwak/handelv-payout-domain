# Payout Domain - Simple Explanation

## What Does This Domain Do?

The Payout Domain is like the **payroll department** for makers. It calculates how much money makers earn from sales, takes the platform's cut, and sends payments to makers.

---

## Real-World Example

### Scenario: Sarah the Potter sells a vase

1. **Order Completed**: Sarah sells a handmade vase for $100
2. **Earnings Calculation** (Payout Domain):
   - Gross amount: $100
   - Platform fee (15%): -$15
   - Net earnings for Sarah: $85
   
3. **Balance Update**:
   - Sarah's pending balance: $85 (held for 7 days for disputes)
   - After 7 days → Available balance: $85

4. **Payout**:
   - Sarah requests payout (or automatic weekly payout runs)
   - Payout Domain transfers $85 to Sarah's bank account
   - Sarah's available balance: $0

---

## The Three Main Tables

### 1. `maker_balances` - Bank Account Summary
Tracks each maker's money:
```
maker_user_id: sarah_123
available_balance: $250.00    ← Can withdraw now
pending_balance: $85.00        ← Money still on hold
total_earned: $2,450.00        ← Lifetime earnings
total_paid_out: $2,115.00      ← Total already paid
```

### 2. `earnings_transactions` - Transaction History
Every sale creates an earnings record:
```
transaction_id: earn_789
maker_user_id: sarah_123
order_id: order_456
gross_amount: $100.00
platform_fee: $15.00
net_amount: $85.00
status: pending → available
available_at: 2026-02-21 (7 days hold)
```

### 3. `payouts` - Payment History
Every payout (money leaving platform to maker):
```
payout_id: payout_321
maker_user_id: sarah_123
amount: $250.00
status: pending → processing → completed
payout_method: bank_transfer
account_id: sarah_bank_****1234
publisher_payout_id: stripe_py_abc123
```

---

## How Money Flows Through The System

```
1. Customer pays $100
   ↓
2. Order Domain: Order completed
   ↓
3. Payout Domain: Calculate earnings
   - Gross: $100
   - Platform fee: -$15
   - Net: $85
   ↓
4. Payout Domain: Update maker balance
   - Pending: +$85 (hold period starts)
   ↓
5. Wait 7 days (escrow period)
   ↓
6. Payout Domain: Move to available
   - Pending: -$85
   - Available: +$85
   ↓
7. Scheduled payout runs (or maker requests)
   ↓
8. Payout Domain: Create payout
   - Available: -$85
   - Send to bank via Stripe/PayPal
   ↓
9. Payout Domain: Mark completed
   - Total paid out: +$85
```

---

## Key Business Rules

### Commission/Platform Fee
- Platform takes a percentage (e.g., 15%) from each sale
- Commission is configurable (could vary by maker tier)
- Deducted BEFORE earnings go to maker balance

### Escrow/Hold Period
- Earnings are "pending" for 7 days (configurable)
- Protects against order disputes and refunds
- After hold period → becomes "available" for payout

### Payout Thresholds
- Minimum payout: $20 (prevent tiny payments)
- Makers can't withdraw less than minimum

### Payout Schedule
- Automatic weekly/bi-weekly/monthly payouts
- OR makers can request immediate payout
- Batch processing for efficiency

### Payout Failure Handling
- If bank transfer fails → retry with backoff
- Notify maker of failure
- Money stays in available balance

---

## What This Domain Does NOT Do

❌ **Does NOT handle customer payments** → Payment Domain does this
❌ **Does NOT manage orders** → Order Domain does this  
❌ **Does NOT process refunds** → Payment Domain does this
❌ **Does NOT verify makers** → Verification Trust Domain does this

✅ **ONLY handles money going FROM platform TO makers**

---

## Event Flow (How It Talks To Other Domains)

### Listens To (Consumes):
- `OrderCompleted` from Order Domain → triggers earnings calculation
- `PaymentCaptured` from Payment Domain → confirms money is received

### Publishes (Sends):
- `EarningsAccrued` → Notification Domain (tell maker they earned money)
- `PayoutScheduled` → Notification Domain (payout is coming)
- `PayoutCompleted` → Notification Domain (money sent!)
- `PayoutFailed` → Notification Domain (problem with payout)

---

## Common Maker Actions

### 1. Check Balance
Maker asks: "How much money do I have?"
```
GET /maker/balance
Response:
{
  available: $250.00,    ← Can withdraw now
  pending: $85.00,       ← Still on hold
  total_earned: $2450.00
}
```

### 2. Request Payout
Maker asks: "Send me my money"
```
POST /maker/payout
{
  amount: $250.00,
  payout_method: "bank_transfer"
}
→ Creates payout record
→ Processes transfer
→ Updates balance
```

### 3. View Earnings History
Maker asks: "What orders earned me money?"
```
GET /maker/earnings
Response:
[
  { order_id: "order_456", amount: $85, date: "2026-02-14" },
  { order_id: "order_789", amount: $120, date: "2026-02-10" },
  ...
]
```

### 4. View Payout History
Maker asks: "When did I get paid?"
```
GET /maker/payouts
Response:
[
  { payout_id: "payout_321", amount: $250, status: "completed", date: "2026-02-14" },
  { payout_id: "payout_654", amount: $400, status: "completed", date: "2026-02-07" },
  ...
]
```

---

## Why Is This A Separate Domain?

### 1. Different Lifecycle
- Orders complete quickly (days/weeks)
- Payouts happen on schedule (weekly/monthly)
- Different timing = different domain

### 2. Different Business Logic
- Commission calculation rules
- Hold periods and escrow
- Payout schedules
- Batch processing

### 3. Different Compliance
- Financial regulations (KYC/AML from Verification Domain)
- Tax reporting (1099 forms for makers)
- Audit trails for money movement

### 4. Different Integration
- Integrates with external payment publishers (Stripe Connect, PayPal)
- Different failure modes and retries

---

## Summary In One Sentence

**The Payout Domain calculates maker earnings from completed orders (after taking platform fee), manages maker balances (pending/available), and processes scheduled or on-demand payouts to makers' bank accounts.**
