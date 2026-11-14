# Using Capflow

This guide walks through Capflow the way a business uses it: from signing up to watching money come in.

## 1. Create your workspace

1. Go to **Start free trial** and create an account with your work email. Confirm the address from the email you receive.
2. On **Tell us about your business**, enter your business name, country, base currency and time zone.
   - The **time zone** decides when an invoice counts as overdue and when reminders may be sent.
   - The **base currency** is what the dashboard shows first. Invoices can be in any supported currency; amounts in different currencies are reported separately and never converted.
3. Your workspace starts on a 14-day **Growth** trial with a ready-made reminder sequence.

You can belong to several organisations. Switch between them from the menu under your name (top right).

## 2. Add customers

**Customers → Add customer**, or **Import CSV** to bring your whole list at once.

- The **billing email** is where reminders go. Without one, Capflow cannot email that customer.
- **Payment terms** set the default due date on new invoices.
- **Consent**: open a customer and choose *Edit* to record WhatsApp/SMS opt-in or an email opt-out. Customers can also unsubscribe themselves from the link in every reminder; they then appear under **Communications → Opt-outs**.

Re-importing the same CSV is safe: customers whose name already exists are skipped. You get a row-by-row report of anything rejected.

## 3. Add invoices

**Invoices → New invoice**, or **Import CSV** for your open receivables (from Tally, Zoho, QuickBooks or a spreadsheet).

- Add line items with quantity, unit price and tax rate. Totals are calculated exactly (no rounding drift) and the database recalculates them on save.
- **Save as draft** keeps it out of recovery. **Save and mark as sent** starts the recovery sequence. Capflow tracks the invoice; it does not email the invoice document itself.
- Attach the PDF from the invoice page (*Attachment*). Files are stored privately.

An invoice moves through these states:

| State | Meaning |
| --- | --- |
| Draft | Not yet sent. Can be deleted. |
| Sent / Overdue | Open. *Overdue* is shown automatically once the due date passes. |
| Partially paid | Some verified payment recorded. |
| Paid | Fully paid by recorded payments. Locked from editing. |
| Disputed | The customer disagrees. All automation stops until you *Resolve dispute*. |
| Cancelled | No longer owed. |

Other actions on an invoice: **Pause recovery** (stop reminders without changing the status), **Archive** (hide it, keep its history), **Edit** (until paid).

Useful views on the invoice list: *Open*, *Overdue*, *Draft*, *Paid*, *Disputed*, *Archived*. Click column headers to sort by amount, dates, customer or days overdue. On the Business plan, tick invoices to act on many at once.

## 4. Record payments

When money arrives: **Payments → Record payment** (or *Record payment* on an invoice).

1. Choose the customer and enter the amount, date, method and bank reference.
2. Capflow spreads the amount across the customer's open invoices, oldest first. Adjust the split if needed. Any remainder is kept as *unallocated*.
3. If the payment looks like one already recorded (same reference, or same customer and amount within 3 days), you are asked to confirm before it is saved.

Payments can never be edited or deleted. If one is wrong, a finance manager **voids** it with a reason; the invoices go back to their previous balance and the voided entry stays in the ledger.

You can also import a bank statement export: **Payments → Import CSV** with `invoice_number, amount, payment_date, reference`. Importing the same file twice records nothing new.

## 5. Recovery: how reminders work

**Automations** holds your reminder sequence. The default is:

| When | Step | Tone |
| --- | --- | --- |
| 5 days before due | Upcoming payment reminder | Friendly |
| On the due date | Payment due today | Professional |
| 3 days overdue | First overdue reminder | Professional |
| 7 days overdue | Second overdue follow-up | Firm |
| 14 days overdue | Escalate to finance manager | — (no message; a person takes over) |

Change the days, add or remove steps, and pick the template for each. Under **Sending rules** set:

- **Approval**: *Manual* (every message waits for a finance manager in **Recovery → Needs approval**) or *Automatic*. Start with manual.
- **Working hours and days**: messages are only sent inside this window, in your time zone.
- **Maximum reminders per invoice** and **minimum hours between reminders**.
- **Personalise with AI** (Growth plan and up, once the AI integration is configured).

What Capflow guarantees:

- Each step sends **at most once** per invoice. If an invoice is added already 20 days overdue, it gets the step that fits 20 days overdue, not every earlier reminder at once.
- Just before sending, everything is checked again. If the invoice was paid, disputed, paused, has a pending promise, or the customer opted out, the message is cancelled, not sent.
- Disputed invoices are never escalated or chased automatically.
- AI never threatens, never mentions legal action, fees, credit scores or collection agencies, never claims a payment was received, and must state the real invoice number and amount. Drafts that break these rules are discarded and the template is used.

### The Recovery page

- **Needs approval**: review each drafted message. *Edit*, *Personalise with AI*, *Skip*, or *Approve* (or *Approve all*).
- **Scheduled**: approved messages waiting for their send time.
- **Needs attention**: escalated and disputed invoices, broken promises to follow up, and messages that failed to deliver (fix the cause, then *Retry*).
- **Promises** and **History**.

## 6. Payment promises

When a customer commits to a date, open the invoice and choose **Record promise** (amount and expected date). Reminders pause until then.

- The promise is marked **fulfilled** only when recorded payments cover it.
- If the date passes without that, it is marked **broken**, you are notified, and a follow-up appears in **Recovery → Needs attention**. Reminders resume.

## 7. Dashboard and analytics

**Overview** shows outstanding, overdue, due this week, recovered this month, collection rate, average days to payment, invoice ageing, cash-flow trend, customer risk, upcoming promises and recent payments — all calculated from your records.

**Analytics** adds, for a chosen period: recovery rate, DSO, collection effectiveness index, average collection period, broken promises, reminder performance by stage, and **insights** such as *"Globex has 3 invoices overdue by more than 30 days; their average delay rose from 12 to 40 days."* Every number states its formula and every insight shows the figures behind it.

**Customer risk** is a transparent rule-based score (age of the oldest overdue invoice, average lateness, broken promises, overdue share). It is a prioritisation aid, not a credit decision.

## 8. Team

**Team → Invite member**. Roles:

| Role | Can |
| --- | --- |
| Viewer | Read everything |
| Accountant | Create and edit customers, invoices, payments, promises; draft reminders |
| Finance Manager | + approve reminders, void payments, configure automation and templates |
| Admin | + manage team, integrations and organisation settings |
| Owner | + billing and deleting the organisation |

Permissions are enforced by the database, so they hold even outside the web interface.

## 9. Integrations

- **Email**: set the sender name and reply-to address, then *Send test email*. If the server has no email provider configured, the page says *Sandbox* and no customer receives anything.
- **AI personalisation**: choose OpenRouter, Anthropic, OpenAI or another OpenAI-compatible provider, the model, and paste an API key (stored encrypted, never shown again).
- **WhatsApp** (official Cloud API) and **SMS** (Twilio): enter the credentials; only customers who opted in are messaged.
- **Bank feeds / accounting software**: not available yet. Use CSV import.

## 10. Billing, settings and your data

- **Billing**: current plan, usage against limits, plan comparison and checkout (Razorpay for INR, Stripe otherwise). Limits are enforced on the server: when a limit is reached, the action explains why and links to upgrade. If a subscription lapses, all data stays readable and exportable; creating invoices, recording payments and sending reminders pause.
- **Settings**: organisation details, your profile, the audit log, and **exports** (invoices as CSV; the full organisation as JSON for data-access requests).
- **Delete organisation** (owners): access ends immediately; financial records are kept for the legal retention period and then erased.
