# FoodSafe 🏠

**Secure Food Delivery Collection for Residential Communities**

FoodSafe is a prototype designed to make food delivery collection more organised and accountable in shared residential waiting areas. It provides a structured handover workflow for residents and building staff, helping them track incoming deliveries, verify collection codes, and follow up on overdue orders.

**Hackathon:** Sime Darby Property University Hackathon  
**Theme:** People — Safety & Security

## Submission Links

- **Live Prototype:** [Open FoodSafe](https://gracevoon.github.io/FoodSafe/)
- **Demo Video:** [Open Demo Video](https://youtu.be/Tovll75ZjBA)

> **Demo notice:** FoodSafe uses simulated data and browser-based demonstration accounts. It does not connect to real delivery services, riders, SMS notifications, CCTV, or a live backend. The login demonstrates role-specific workflows but does not provide production-grade security.

## The Problem

In residential communities, food deliveries may be left in shared waiting areas or at guard houses while residents are away. This can create several practical challenges:

- **Collection confusion:** Orders may be mixed up or collected by the wrong person.
- **Uncollected deliveries:** Staff may have difficulty tracking orders that remain unattended.
- **Limited accountability:** Residents and staff may lack a consistent record of delivery arrivals, collection, and follow-up actions.

FoodSafe explores how a structured digital handover process could help address these challenges.

The concept was inspired by a publicly shared incident involving food delivery theft at a Singapore condominium. This incident illustrates a possible problem scenario; it does not establish how frequently such incidents occur in residential townships.

## Our Solution

FoodSafe brings delivery registration, collection verification, and overdue follow-up into one prototype.

### Key Features

- **Delivery registration:** Staff record an incoming delivery against a registered residential unit.
- **Collection verification:** A unique six-digit code is used to verify a delivery before staff confirm the handover.
- **Resident delivery tracking:** Residents can view their own unit's delivery status, collection code, and waiting time.
- **Overdue follow-up:** Staff can record reminders, resident contact, and movement to a holding area.
- **Activity log:** Delivery and follow-up events are recorded to provide a history of actions.
- **Authorised collection:** Residents can designate another person to collect an order for a limited period.
- **Simulated notifications:** Residents can view collection reminders and overdue notices within the prototype.

FoodSafe does not claim that collection codes or designated delivery areas are new. Its focus is on bringing these functions together in a clear workflow for shared residential delivery collection.

## Demo Accounts

Use these public accounts to explore the prototype. The accounts and passwords are for demonstration only.

| Role | Username | Password | Unit |
|---|---|---|---|
| Staff / guard | `staff01` | `Staff123!` | — |
| Resident | `resident01` | `Resident123!` | A-12-03 |
| Resident | `resident02` | `Resident456!` | A-12-05 |
| Resident | `resident03` | `Resident003!` | A-12-07 |
| Resident | `resident04` | `Resident004!` | A-13-02 |
| Resident | `resident05` | `Resident005!` | A-13-05 |
| Resident | `resident06` | `Resident006!` | B-05-03 |
| Resident | `resident07` | `Resident007!` | B-05-06 |
| Resident | `resident08` | `Resident008!` | B-06-01 |

Each account has a fixed demonstration role. Log out before switching roles, or use a separate browser tab to test the staff and resident views. Data is stored locally in the browser, so separate browsers or devices do not share the same orders.

The usability Test Log is a team-testing tool at the staff-only `#/staff/tests` route and is intentionally hidden from the normal navigation.

## What Each Role Can Do

| Feature | Staff | Resident |
|---|---|---|
| Register deliveries | Yes | No |
| View and filter the delivery queue | Yes | No |
| Verify collection codes and confirm handover | Yes | No |
| Manage overdue follow-up | Yes | No |
| View the activity log | Yes | No |
| View delivery status, code, and waiting time | No | Own unit only |
| Authorise another person to collect | No | Own orders only |
| View collection history | No | Own unit only |
| View simulated notifications | No | Own unit only |

The interface restricts pages and actions according to the logged-in demonstration role. These are browser-side checks for the prototype, not secure server-side authorisation.

## How It Works

1. **Staff register a delivery.** Staff enter the residential unit, order reference, and optional note. The arrival time is recorded and a unique six-digit collection code is generated.
2. **The resident checks the delivery.** The resident logs in to view their unit's delivery, collection code, arrival time, and waiting time.
3. **Staff verify the collection code.** A valid code identifies the delivery and unit. Verification alone does not mark the order as collected.
4. **Staff confirm the handover.** Once the handover is confirmed, the order is marked as collected and the code can no longer be reused.
5. **Staff follow up overdue deliveries.** The prototype can display simulated reminders and overdue notices and record follow-up actions.
6. **A resident may authorise another collector.** The resident can designate another person for a limited period, from 5 to 240 minutes. A newer authorisation replaces the previous one.

## Overdue Deliveries and Follow-up

### Delivery statuses

| Status | Meaning |
|---|---|
| Pending Collection | The delivery has been registered and its collection deadline has not passed. |
| Overdue | The collection deadline has passed, and the delivery has not been collected or disposed of. |
| Collected | Staff confirmed the handover after code verification. This status remains unchanged. |
| Disposed | Staff recorded disposal after confirming the action. This status remains unchanged. |

The overdue deadline is based on the arrival time plus the configured overdue limit (15 minutes by default in the demonstration). The prototype calculates the overdue status from the current demonstration time rather than storing it as a separate order status.

### Simulated notifications

No messages are sent to a phone. Notifications are displayed within the resident's page and can include:

- A collection reminder before the deadline.
- An overdue notice after the deadline.
- A reminder recorded by staff.
- A disposal notice if staff record disposal.

Residents only see notifications for their own unit. Reminder and overdue notices stop appearing once a delivery is collected or disposed of. The prototype avoids generating duplicate notifications for the same event when pages are refreshed or the demonstration clock is advanced.

### Staff follow-up actions

For overdue deliveries, staff can:

- Open the normal code-verification flow to process a collection.
- Send a simulated reminder.
- Record that the resident was contacted.
- Record that the delivery was moved to a holding area.
- Record disposal, subject to confirmation.

These actions are recorded in the activity log. A reminder or contact record cannot be repeated within five minutes of demonstration time.

**Disposal is manual and optional.** The prototype never disposes of food automatically. Staff must confirm the action, and any real deployment would need to follow the applicable building procedure and property manager's policy.

## Try the Prototype

**Live demo:** [https://gracevoon.github.io/FoodSafe/](https://gracevoon.github.io/FoodSafe/)

Suggested exploration:

1. Log in as `staff01` and review the staff dashboard.
2. Register a delivery for `A-12-03`.
3. Log out and log in as `resident01` to view the delivery and collection code.
4. Return to the staff account, verify the code, and confirm the handover.
5. Review the activity log.
6. Use the demonstration controls to explore overdue notices and follow-up actions.

### Demonstration tools

The staff dashboard includes controls for demonstrating the workflow:

- **Load sample data:** Loads four sample orders for demonstration.
- **Skip ahead 5 / 10 min:** Advances the demonstration clock to show reminders and overdue status.
- **Overdue after (minutes):** Changes the demonstration's overdue limit.
- **Reset demo data:** Clears orders, notifications, and the activity log, and restores the demonstration clock and overdue limit. Demo accounts and saved test results are retained.

Reset and Load actions ask for confirmation. Use these controls carefully if you want to preserve the data in your current browser.

## Run Locally

The prototype is a static web application and does not require a backend to run.

1. Download or clone this repository.
2. Open `index.html` in a browser.

The prototype stores its demonstration data in the browser's `localStorage`. The first visit loads sample data. Because data is browser-local, the staff and resident views must be tested in the same browser; separate tabs can be used to switch between accounts.

## Tests

The project includes logic tests and browser-page tests.

```bash
npm install
npm test
npm run test:ui
```

- `npm test` runs the logic and rule tests in `test.js`.
- `npm run test:ui` runs the browser-page tests in `test-ui.js` using `jsdom`.
- `npm run test:ui -- --report` can be used to generate `TEST_REPORT.md` if supported by the current `package.json` script.

Node.js 20 or newer is recommended. The static prototype itself does not need Node.js to run on GitHub Pages.

Check the actual test output and the latest `TEST_REPORT.md` before making claims about test results.

## Limitations and Future Development

### Current limitations

- **Demonstration login:** Accounts and role checks run in the browser. Anyone who can edit the page code or browser storage may bypass them. Demo passwords are public by design.
- **Browser-local data:** Orders, notifications, and activity logs are stored in one browser and are not synchronised across devices.
- **Simulated notifications:** Reminders and overdue notices appear inside the prototype. No SMS, push notification, email, or messaging service is connected.
- **No external integrations:** The prototype does not connect to food delivery platforms, riders, CCTV, identity verification, or physical lockers.
- **Demonstration activity log:** The log is not tamper-proof. It does not store passwords or typed collection codes.
- **No background service:** Notifications are generated when the prototype is opened or its demonstration clock changes, rather than by a continuously running server.
- **No established disposal policy:** The prototype records a staff decision but does not define a real building's food-disposal policy.
- **Limited evaluation:** Demonstration tests show how the prototype behaved in those tests; they do not establish effectiveness across a residential township.
- **Browser compatibility:** Test the current version on target phones and browsers before any real-world pilot.

### Future development

A real pilot would require:

- Agreement and workflow design with a property manager or guard house.
- A staffed counter or secure collection point where the code can be checked.
- A backend, database, and server-side authentication and authorisation.
- Real notification delivery and appropriate privacy safeguards.
- User testing with residents, building staff, and property managers.
- Clear operational procedures for overdue and uncollected food.

## Technical Notes

- Demo residents are defined in the `ACCOUNTS` list near the top of `logic.js`.
- The unit list used by delivery registration is built from the configured resident accounts.
- Each demo account has a fixed role and unit. The role is not selected through a login-page button.
- Only `PENDING`, `COLLECTED`, and `DISPOSED` are stored as order statuses. `Overdue` is calculated from arrival time, the configured overdue limit, and the demonstration clock.
- Staff cannot view a resident's collection code in the delivery queue. The collector must present the code.
- The test log is intended for team testing and is not included in the normal staff navigation.

## Project Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | Visual styling |
| `app.js` | Screens, login session, and page navigation/protection |
| `logic.js` | Demo accounts, roles, rules, statuses, notifications, follow-up, and activity log |
| `test.js` | Logic and rule tests |
| `test-ui.js` | Browser-page tests |
| `TEST_REPORT.md` | Test report, when generated |
| `package.json` | Test scripts and development dependencies |
| `.gitignore` | Files excluded from version control |

---

FoodSafe is a prototype exploring a more organised and accountable approach to food delivery collection in shared residential communities. Its next step would be to evaluate the workflow with residents and property management, then develop the backend and operational arrangements needed for real-world use.
