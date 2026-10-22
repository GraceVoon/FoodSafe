# FoodSafe

Secure food handoff for shared waiting areas in residential townships.
Built for the Sime Darby Property University Hackathon (People theme, Safety & Security).

> **A prototype with simulated data.** No real orders, delivery apps, riders, SMS or CCTV are connected, and the login is a demonstration, not real security (see Limits).

## The problem

Delivered food is often left in a shared waiting area or guard house. It can be taken by the wrong person, mixed up, or left until it is cold. Afterwards residents have to check CCTV and chase people themselves.

The idea was inspired by a widely shared video of a food theft in a Singapore condominium. That is one example, not evidence of how common the problem is in any township. **Add your own interview findings here before you submit.** One-time collection codes and designated delivery areas also exist in commercial products, so do not claim they are new. What this prototype tests is the specific workflow below.

## Demo accounts (public, demo only)

| Role | Username | Password | Unit |
|---|---|---|---|
| Staff / guard | `staff01` | `Staff123!` | none |
| Resident | `resident01` | `Resident123!` | A-12-03 |
| Resident | `resident02` | `Resident456!` | A-12-05 |
| Resident | `resident03` | `Resident003!` | A-12-07 |
| Resident | `resident04` | `Resident004!` | A-13-02 |
| Resident | `resident05` | `Resident005!` | A-13-05 |
| Resident | `resident06` | `Resident006!` | B-05-03 |
| Resident | `resident07` | `Resident007!` | B-05-06 |
| Resident | `resident08` | `Resident008!` | B-06-01 |

The residents are fictional. They are defined in one place, the `ACCOUNTS` list at the top of `logic.js`, and shown on the login page. The unit list that staff can register deliveries for is built from the same list, so a unit works for deliveries exactly when a resident account has it. There is one account per unit. Each account has one fixed role. The role comes from the account, never from a button, the address bar or browser storage. To try the other role, log out and log in with the other account, or open a second tab (each tab has its own login, and they share the same orders).

### Adding another demo resident

Copy one resident line in `ACCOUNTS` (`logic.js`) and change the `userId`, `username`, `password`, `unitNumber` (form `A-12-03`) and `displayName`. Nothing else needs editing: the registration list, hint and validation pick it up. Run `node test.js`, which checks for duplicate usernames, ids and units. Residents live in the code, not in browser storage, so adding one never touches saved deliveries.

## What each role can do

| | Staff | Resident |
|---|---|---|
| Register a delivery (unit, order reference, optional note) | Yes | No |
| See every order, search and filter the queue | Yes | No |
| Verify a collection code, then confirm the handoff | Yes | No |
| Follow up overdue deliveries: send a reminder, record contact, record a move to the holding area, mark as disposed | Yes | No |
| Activity log, demonstration tools, test log | Yes | No |
| See their own unit's orders, code and waiting time | No | Yes |
| Authorise someone else to collect, for a limited time | No | Yes |
| Collection history (collected and disposed) | No | Yes (own unit only) |
| See reminders and overdue notices (simulated) | No | Yes (own unit only) |

Pages are protected in three ways: unauthenticated visitors are sent to the login page, a staff account opening a resident page (or the reverse) is sent back to its own dashboard with an "Access denied" message, and every action checks the role again inside `logic.js`. Blocked visits are written to the activity log.

## How the workflow runs

1. **Staff register a delivery.** Arrival time is recorded automatically and a unique 6-digit code is created for the resident. The order reference must be unique, and the unit must belong to a configured demo resident (the form lists them). An unknown unit is rejected with a message that names it and lists the valid ones.
2. **Resident logs in** and sees the order, code, arrival time and waiting time.
3. **Staff verify the code** the person gives them. A good code shows the order and unit. Nothing is collected yet.
4. **Staff confirm the handoff.** The order becomes `COLLECTED`, the time is recorded and the code can never be used again. Typing a code alone never collects an order.
5. **Reminder, then overdue:** see "Overdue food" below.
6. **Authorised collector:** a resident can name someone and give them their own code for 5 to 240 minutes. A newer authorisation cancels the older one.

## Overdue food

**Statuses** (shown the same way on every screen):

| Status | Meaning |
|---|---|
| Pending Collection | Registered, and the collection deadline has not passed |
| Overdue | The deadline has passed and it has not been collected or disposed of |
| Collected | Handed over after a verified code. Stays Collected for ever, whatever the deadline was |
| Disposed | A staff member recorded disposal. Stays Disposed for ever |

The collection deadline is arrival time plus the **overdue limit** (15 minutes by default, changeable in the demo tools). Only `PENDING`, `COLLECTED` and `DISPOSED` are stored on an order. **Overdue is never stored:** `deliveryStatus()` in `logic.js` works it out from the arrival time, the limit and the current (demo) time, so no screen can disagree with another and there are no timers to clash.

**Notifications (simulated, nothing is sent).** Each is a message on the resident's own page that names the delivery and the unit:

- **Collection reminder** at two thirds of the limit (minute 10 of 15, minute 20 of 30).
- **Overdue notice** when the deadline passes.
- **Reminder from staff** when staff send another one.
- **Disposal notice** if staff dispose of the delivery.

A resident only sees the notifications for the unit on their own account. Reminders and overdue notices disappear from the resident's page once the delivery is collected or disposed of, and no new ones are made for it.

**No duplicates.** `syncNotifications()` creates what is due and skips anything that already exists (each reminder and overdue notice has a unique key such as `7:overdue`). It runs whenever a page is drawn, and when the demo clock or overdue limit changes, so refreshing, reopening dashboards or skipping ahead never repeats a notification or its activity entry. Skipping 20 minutes in one go gives the same result as two steps of 10.

**Staff follow-up.** The staff dashboard shows an *Overdue deliveries to follow up* card. Each overdue delivery shows what has already been done (reminders sent, contacts, holding area) and offers:

- **Collect (verify code):** opens the normal code check for that delivery. Collection still needs a verified code and a confirmed handoff, so the overdue flow cannot bypass the code.
- **Send reminder:** a new simulated reminder to the resident.
- **Record contact:** notes that staff contacted the resident.
- **Moved to holding area:** notes that the food was moved (once only).
- **Mark as Disposed:** see below.

These only work on an overdue delivery. A reminder or a contact record cannot be repeated within 5 minutes (demo time), so a double click does not create two. Every action is written to the existing activity log (events: *Collection reminder generated*, *Delivery marked overdue*, *Follow-up: reminder sent / resident contacted / moved to holding area*, *Delivery disposed*, plus the existing registered and collected events). The log lists events by when they happened.

**Disposal is implemented, but optional and manual.** Nothing is ever disposed of by a timer. *Mark as Disposed* is staff only, available only for an overdue delivery, and asks for confirmation first: the dialog says to use it only when the applicable building procedure allows it, that it cannot be undone, and lets the staff member cancel. After confirming, the delivery is Disposed with the time and the staff account recorded, its codes stop working, the resident is told, and no more reminders are made. This prototype does not claim any real building's disposal policy: that is for the property manager to decide before any pilot.

## Run it on your computer

No install needed: open `index.html` in a browser. Data is saved in that browser (localStorage). The first visit loads sample data.

**Demonstration tools** (staff dashboard only):

- **Load sample data:** replaces orders, notifications and the log with 4 sample orders (one already collected, one already overdue, one with its reminder already due).
- **Skip ahead 5 / 10 min:** moves the demo clock so you can show the reminder and the overdue status.
- **Overdue after (minutes):** changes the overdue limit.
- **Reset demo data:** removes all orders, notifications and the activity log, and puts the demo clock and overdue limit back to normal. **Demo accounts and saved test results are kept.** Both Reset and Load ask for confirmation.

### Suggested demo (about three minutes)

1. Log in as `staff01`. Point out the overdue card for FS-1001.
2. Register a delivery for `A-12-03`.
3. Press **Skip ahead 10 min**, log out, log in as `resident01`: show the reminder, the code and the "Someone else collecting?" form.
4. Log in as `staff01`, press **Skip ahead 10 min** again, then log in as `resident01` to show the overdue notice. Log in as `resident02` to show they see none of it.
5. As `staff01`, use **Send reminder** and **Record contact** on the overdue card.
6. Open **Verify collection**, try a wrong code (rejected), then the right one, then **Confirm handoff**.
7. Open **Activity log** to show the whole record.

## Put it on GitHub

**Update your existing repository** (the one already on GitHub Pages):

1. Open the repository on GitHub and choose **Add file, Upload files**.
2. Drag in the changed files: `index.html`, `style.css`, `app.js`, `logic.js`, `test.js`, `test-ui.js`, `README.md` and `TEST_REPORT.md`. Files with the same name are replaced. `package.json` and `.gitignore` did not change.
3. Write a commit message such as "Add overdue follow-up, simulated notifications and optional disposal" and commit to `main`.
4. Wait about a minute for GitHub Pages to update, then refresh the site with **Ctrl+Shift+R** (Cmd+Shift+R on Mac) so the browser does not show the old version. The page now loads its files as `?v=4`, which helps browsers pick up the new files. If you still see no overdue card, hard-refresh again or open the site in a private window.

**Existing deliveries are kept.** Residents are not saved in the browser, so people who already used the site keep their orders, collected records, activity log and test results. Saved deliveries are not edited, reset or re-seeded when the new version loads. Because notifications are new, the first time the new version opens it creates the reminder and overdue notices that are already due for saved deliveries (once each, dated to when they became due) and adds matching activity entries. Refreshing never repeats them. (Use **Load sample data** or **Reset demo data** only if you want to start over.)

**New repository:** create a public repository, upload all files, then **Settings, Pages, Deploy from a branch, `main`, `/ (root)`, Save**. Your site will be at `https://<your-username>.github.io/<repository-name>/`.

Old data from the first version is ignored (this version saves under a new name), so nobody's browser will show broken orders.

## Tests

```
node test.js          # 68 rule checks, needs only Node.js
npm install           # once, installs jsdom (a browser simulator) for the next command
node test-ui.js       # the 26 cases T01-T26, the 8 residents, upgrading saved data, and the overdue workflow (OVD01-OVD11), run against the real pages
node test-ui.js --report   # same, and writes TEST_REPORT.md
```

`TEST_REPORT.md` has PASS/FAIL for each case. Node.js 20 or newer is recommended.

## Limits (say these in your pitch)

- **The login is a demonstration, not real security.** The accounts and checks run in the browser, so anyone who can edit the page code or browser storage can get around them. Real enforcement needs a server that checks who is logged in. The demo passwords are public by design.
- It **cannot stop theft by itself.** It only helps if food is handed over by a person or locker that checks the code, not left on an open shelf.
- Data lives in one browser only. Another phone or browser sees its own copy, so test staff and resident in the same browser (two tabs work).
- The activity log is a demonstration record, not tamper-proof. It never stores passwords or typed codes.
- No real notifications, no delivery-app connection, no CCTV, no identification of people. Reminders and overdue notices are simulated messages on the resident's page, shown only while they are logged in and looking; nothing reaches a phone. Residents are shown their code on screen because there is no SMS.
- Notifications are created when a page is open or the demo clock moves, because there is no server running in the background. In a real system a server would create them on time even if nobody is looking.
- *Mark as Disposed* only records a decision. No building's real disposal policy has been established, so the dialog tells staff to follow the applicable building procedure.
- Test results from a few people show what happened in your test, not what would happen across a township.
- Tested in a browser simulator and loaded without errors in desktop Chromium. Not yet tried on real phones, Safari or Firefox.

## What a real pilot would need

- Agreement with the property manager or guard house for one township.
- A staffed counter or lockable shelf so the code check is actually enforced.
- A real backend with proper accounts, phone notifications and privacy review.
- Reuse in other townships by changing the unit list.

## Design choices to know about

- Staff do not see the resident's code, so only the person collecting can present it.
- The delivery-app field from version 1 was removed to match the specification (unit, order reference, optional note).
- The reminder time (two thirds of the limit), the 5-minute gap between repeated staff reminders or contact records, and the overdue limit are fixed choices for the demo. Staff can only change the overdue limit.
- Changing the overdue limit changes which deliveries count as overdue. Notices already created are kept and are not created again.
- Version 1 locked an order after three wrong codes. Because staff now enter a code without choosing an order first, there is no order to lock, so three wrong codes in a row show a warning to ask for ID instead.
- A row's **Verify code** button limits the check to that order, so another order's code is rejected.
- The test log is staff-only because it is a team tool for test day.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Page shell and styles |
| `app.js` | Screens, login session, page protection |
| `logic.js` | Accounts, roles, rules, statuses, notifications, follow-up, activity log (no screen code) |
| `test.js`, `test-ui.js` | Rule tests and the end-to-end tests (T01-T26, residents, upgrade, overdue workflow) |
| `TEST_REPORT.md` | Latest test results |
| `package.json`, `.gitignore` | Only needed to run `test-ui.js` |
