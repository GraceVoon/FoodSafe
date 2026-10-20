# FoodSafe

Secure food handoff for shared waiting areas in residential townships.
Built for the Sime Darby Property University Hackathon (Theme: People, Safety & Security).

> **This is a prototype with simulated data.** No real orders, delivery riders, delivery apps or CCTV are connected.

## The problem

Delivered food is often left in a shared waiting area or guard house. It can be taken by the wrong person, mixed up, or left until it is cold. Afterwards residents are left to check CCTV and chase people themselves.

The idea came from a widely shared video of a food theft in a Singapore condominium. That is one example, not evidence of how common the problem is in any township. **Add your own interview findings here before submitting.**

## What the prototype does

| Who | What |
|---|---|
| Staff / guard | Logs each delivery that arrives (unit, delivery app, order ref). The resident gets a one-time 4-digit code. |
| Staff / guard | Hands food over only after the code is verified. The handoff is recorded. |
| Staff / guard | After 3 wrong codes the order locks until staff check the person's ID or unit. |
| Resident | Sees the code and how long the food has been waiting. |
| Resident | Can authorise someone else (neighbour, family) with a separate code that expires after a set time. |
| Everyone | Food waiting longer than 15 minutes triggers an alert. |
| Test day | A test log records correct handoffs and time, with and without the app, and exports CSV. |

## Run it

No install needed. Open `index.html` in a browser.

Data is stored in your browser only (localStorage). Use the **Demo tools** bar at the bottom:

- **Load demo data**: three sample orders.
- **Skip ahead 5 / 10 min**: simulates time passing so you can show the waiting-too-long alert.
- **Reset everything**: clears all data.

### Suggested demo (about one minute)

1. Click **Load demo data**. Notice the alert for the order waiting 18 minutes.
2. Open **Resident**, pick a unit, and show the code and the "authorise someone else" form.
3. Back in **Staff**, enter a wrong code (it is rejected), then the right code (food handed over, recorded).
4. Authorise a neighbour, then verify with the neighbour's code.

## Publish on GitHub Pages (so judges can open a link)

1. Create a new public repository on GitHub and upload all files in this folder.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then Save.
4. After a minute your site is at `https://<your-username>.github.io/<repository-name>/`.

## Tests

```
node test.js
```

Runs 18 checks on the handoff rules (code generation, verification, lockout, delegation expiry, alerts, test summary, CSV export). Needs Node.js.

## Limits (be honest in the pitch)

- It cannot stop theft by itself. It only helps if food is handed over by a person or locker that checks the code, **not** left on an open shelf.
- Not connected to Grab, foodpanda or any rider, so staff enter arrivals by hand.
- Data stays in one browser. Codes are not secure enough for production.
- No CCTV and no identification of people.
- Test results from a few people show what happened in your test, not what would happen across a township.

## What a real pilot would need

- Agreement with the property manager or guard house for one township.
- A staffed counter or lockable shelf so the code check is actually enforced.
- A real backend, resident accounts and phone notifications.
- Privacy and data-protection review.
- Reuse across other townships by changing the unit list.

## Files

- `index.html`, `style.css`, `app.js`: the screens.
- `logic.js`: the handoff rules (no UI), also used by the tests.
- `test.js`: automated checks.
