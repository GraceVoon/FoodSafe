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
| Activity log, demonstration tools, test log | Yes | No |
| See their own unit's orders, code and waiting time | No | Yes |
| Authorise someone else to collect, for a limited time | No | Yes |
| Collection history | No | Yes (own unit only) |

Pages are protected in three ways: unauthenticated visitors are sent to the login page, a staff account opening a resident page (or the reverse) is sent back to its own dashboard with an "Access denied" message, and every action checks the role again inside `logic.js`. Blocked visits are written to the activity log.

## How the workflow runs

1. **Staff register a delivery.** Arrival time is recorded automatically and a unique 6-digit code is created for the resident. The order reference must be unique, and the unit must belong to a configured demo resident (the form lists them). An unknown unit is rejected with a message that names it and lists the valid ones.
2. **Resident logs in** and sees the order, code, arrival time and waiting time.
3. **Staff verify the code** the person gives them. A good code shows the order and unit. Nothing is collected yet.
4. **Staff confirm the handoff.** The order becomes `COLLECTED`, the time is recorded and the code can never be used again. Typing a code alone never collects an order.
5. **Overdue:** a pending order waiting 15 minutes or more (changeable in the demo tools) is flagged *Overdue*. It stays `PENDING` until collected.
6. **Authorised collector:** a resident can name someone and give them their own code for 5 to 240 minutes. A newer authorisation cancels the older one.

Order status is only `PENDING` or `COLLECTED`. Overdue is a separate flag.

## Run it on your computer

No install needed: open `index.html` in a browser. Data is saved in that browser (localStorage). The first visit loads sample data.

**Demonstration tools** (staff dashboard only):

- **Load sample data:** replaces orders and the log with 4 sample orders (one already collected, one already overdue).
- **Skip ahead 5 / 10 min:** moves the demo clock so you can show the overdue flag.
- **Overdue after (minutes):** changes the overdue limit.
- **Reset demo data:** removes all orders and the activity log, and puts the demo clock and overdue limit back to normal. **Demo accounts and saved test results are kept.** Both Reset and Load ask for confirmation.

### Suggested demo (about two minutes)

1. Log in as `staff01`. Point out the overdue alert on FS-1001.
2. Register a delivery for `A-12-03`.
3. Log out, log in as `resident01`, and show the code and the "Someone else collecting?" form.
4. Log out, log in as `staff01`, open **Verify collection**, try a wrong code (rejected), then the right one, then **Confirm handoff**.
5. Open **Activity log** to show the record.

## Put it on GitHub

**Update your existing repository** (the one already on GitHub Pages):

1. Open the repository on GitHub and choose **Add file, Upload files**.
2. Drag in everything from this folder. Files with the same name (`index.html`, `style.css`, `app.js`, `logic.js`, `test.js`, `README.md`) are replaced, and `test-ui.js`, `package.json`, `.gitignore` and `TEST_REPORT.md` are new.
3. Write a commit message such as "Add login, roles and verified collection" and commit to `main`.
4. Wait about a minute for GitHub Pages to update, then refresh the site with **Ctrl+Shift+R** (Cmd+Shift+R on Mac) so the browser does not show the old version. If the unit list still shows only two units, the browser is still using the old files: hard-refresh again or open the site in a private window.

**Existing deliveries are kept.** Residents are not saved in the browser, so people who already used the site keep their orders, collected records, activity log and test results, and simply see the new residents after the files update. Nothing is reset or re-seeded automatically. (Use **Load sample data** or **Reset demo data** only if you want that.)

**New repository:** create a public repository, upload all files, then **Settings, Pages, Deploy from a branch, `main`, `/ (root)`, Save**. Your site will be at `https://<your-username>.github.io/<repository-name>/`.

Old data from the first version is ignored (this version saves under a new name), so nobody's browser will show broken orders.

## Tests

```
node test.js          # 47 rule checks, needs only Node.js
npm install           # once, installs jsdom (a browser simulator) for the next command
node test-ui.js       # the 26 cases T01-T26 plus checks for the 8 residents and for upgrading saved data, run against the real pages
node test-ui.js --report   # same, and writes TEST_REPORT.md
```

`TEST_REPORT.md` has PASS/FAIL for each case. Node.js 20 or newer is recommended.

## Limits (say these in your pitch)

- **The login is a demonstration, not real security.** The accounts and checks run in the browser, so anyone who can edit the page code or browser storage can get around them. Real enforcement needs a server that checks who is logged in. The demo passwords are public by design.
- It **cannot stop theft by itself.** It only helps if food is handed over by a person or locker that checks the code, not left on an open shelf.
- Data lives in one browser only. Another phone or browser sees its own copy, so test staff and resident in the same browser (two tabs work).
- The activity log is a demonstration record, not tamper-proof. It never stores passwords or typed codes.
- No real notifications, no delivery-app connection, no CCTV, no identification of people. Residents are shown their code on screen because there is no SMS.
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
- Version 1 locked an order after three wrong codes. Because staff now enter a code without choosing an order first, there is no order to lock, so three wrong codes in a row show a warning to ask for ID instead.
- A row's **Verify code** button limits the check to that order, so another order's code is rejected.
- The test log is staff-only because it is a team tool for test day.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Page shell and styles |
| `app.js` | Screens, login session, page protection |
| `logic.js` | Accounts, roles, rules, activity log (no screen code) |
| `test.js`, `test-ui.js` | Rule tests and the T01-T26 end-to-end tests |
| `TEST_REPORT.md` | Latest test results |
| `package.json`, `.gitignore` | Only needed to run `test-ui.js` |
