# CallCast
**Turning ordinary phone calls, SMS, and (where possible) USSD into an emergency data channel when the internet is down.**

Built for: Crisis Tech — dedicated to the spirit of Jogajog and the July Revolution internet shutdowns.

**Built by a student, on a zero budget.** Every choice below is made to work with free tools first, and is honest about the one or two places a real deployment eventually needs help from a telco or NGO — because pretending otherwise would make the project less trustworthy, not more impressive.

---

## 1. The Problem

When internet and SMS go dark during a crisis (protest, disaster, deliberate shutdown), most "offline-first" projects assume everyone has a smartphone with Bluetooth/Wi-Fi Direct/mesh capability. In reality:

- The people most affected often have basic feature phones, not smartphones.
- Telcos frequently keep **voice calling** (and often **SMS**) alive even when they throttle or kill mobile data — for regulatory/emergency reasons.
- Almost nobody is building for that specific gap: **voice-and-text-only, zero-app, zero-data communication.**

CallCast exploits the channels that actually survive — voice calls and SMS — instead of fighting to rebuild the internet from scratch.

---

## 2. The Idea, in One Sentence

Anyone — even with a $10 button phone — can call a number and press keys, or send a plain text SMS, to report their status, location, or a missing person. That data appears live on a shared safety dashboard. No app, no data plan, no smartphone required.

---

## 3. What It Does

### Channel 1 — Voice / IVR (build this first — it's free to build and test)
1. Person dials a local number.
2. A voice menu offers options via key press:
   - `1` — "I am safe" + area code for location
   - `2` — "I need help" + category (medical / trapped / flood / shelter)
   - `3` — "Report a missing person" (record a short voice note)
   - `4` — "Report a hazard" (flooded road, blocked bridge, fire)
3. Backend decodes DTMF key presses + call metadata into a structured record.

### Channel 2 — SMS (add second — same backend, richer free-text reports)
Person texts a keyword-based message to a number:
- `SAFE Dhanmondi`
- `HELP medical Mogbazar`
- `MISSING Rahim Uddin Mirpur, blue shirt`
- `HAZARD flood Dhanmondi Road 27`

SMS needs no internet at all — it rides the cellular signaling channel, completely separate from mobile data, which is why it often survives when data doesn't.

### Channel 3 — USSD (stretch goal, needs telco cooperation — see Section 6)
Same reports, but through a `*XXX#` style menu, free to the user by default (no carrier charge), if a telco/aggregator partnership exists.

### Shared backend, one dashboard
All three channels write into **one canonical database**, shown on **one live dashboard**: a map + list of check-ins, shelter capacity, missing-person registry, and hazard reports. Operators can mark cases verified/resolved.

---

## 4. Zero-Budget Tech Stack

Every tool below is free or has a genuinely usable free tier — nothing here requires spending money to build and test the whole system end-to-end.

| Layer | Tool | Cost |
|---|---|---|
| Backend API | **Node.js + Express** | Free |
| Database | **SQLite** for building/testing, **PostgreSQL** (free, self-hosted) once you need concurrent load | Free |
| Dashboard frontend | **React + Vite**, **Leaflet** for the map | Free |
| Real-time updates | **Socket.IO** | Free |
| Voice/IVR (development) | **Twilio free trial** — enough credit to build and demo the full call flow, or a fully free/open alternative below | Free trial, no card charge until you upgrade |
| Voice/IVR (self-hosted, zero recurring cost) | **Asterisk** or **FreeSWITCH** (both fully open-source) running on your own laptop, connected via a **secondhand USB GSM SIM gateway/dongle** (one-time cost, often available cheap secondhand — think of it as buying a "second phone" that your software controls) | One-time, low cost, no monthly fee |
| SMS (development) | **Twilio free trial**, or the **same GSM dongle** above via **Gammu** or **Kannel** (both free, open-source SMS gateway software that talks to a GSM modem over USB) | Free once you have the dongle |
| Hosting | Run everything **on your own laptop** during development; for a public-facing version later, free tiers exist on **Render**, **Railway**, or **Oracle Cloud's free tier** (genuinely free, not just trial) | Free |

**The one piece that costs real, ongoing money if you want it "free for the end user":** a reverse-billed SMS number or a real USSD short code. Both require a formal relationship with a telco or an aggregator, and telcos generally don't do this for free — it's usually funded by an NGO, university, or government partnership, not out of a student's pocket. This is not a coding problem, it's a partnerships problem — see Section 6.

---

## 5. Architecture

```
Caller's Phone (any phone, any network)
        │  (voice call w/ DTMF, or SMS)
        ▼
Telephony Gateway
   ├─ Twilio (free trial, fastest to build with)
   └─ OR: Asterisk/FreeSWITCH + Gammu/Kannel + secondhand GSM dongle (zero recurring cost)
        │  (decoded input + metadata)
        ▼
Backend API (Node.js + Express) — one canonical report schema for all channels
        │
        ├──► Socket.IO (live dashboard updates, operator chat)
        │
        ▼
Database (SQLite → Postgres as it grows)
        │
        ▼
Dashboard (React PWA — map, registry list, operator login, status workflow)
```

---

## 6. Honest Limitations (read this before demoing or pitching)

Being upfront about these makes the project *more* credible, not less — judges and mentors trust a team that knows its own edges.

1. **"Free for the sender" needs a partner, not just code.** SMS and voice both work without internet regardless of billing — but making them free to the person calling/texting (rather than charged at normal rates) requires a reverse-billed number or USSD short code, which needs a telco or aggregator agreement. As a student, the honest next step is approaching a university, telecom regulator, or NGO for this — not something solvable alone.
2. **Your own backend still needs *some* connectivity.** If Twilio/your gateway needs to reach your server over the internet to deliver call/SMS events, your server itself has a dependency the "no internet" pitch doesn't fully escape. The self-hosted Asterisk + GSM dongle path avoids this entirely — worth prioritizing for that reason, even though it's more setup work.
3. **The GSM dongle route needs a real, active SIM card** with airtime, same as any phone — the dongle itself is free-ish (secondhand, cheap), but it isn't magic; it still needs a working number to receive real calls/SMS.
4. **DTMF is reliable; a custom phone-to-phone audio "modem" (stretch idea from earlier) is not** — mobile voice codecs are speech-optimized and can mangle non-speech tones. If you ever build phone-to-phone relay, use DTMF bursts, not a custom modem.
5. **Abuse and false reports are a real risk once anything is public-facing** — rate-limit by phone number, and give operators a verify/moderate step before a report shows as confirmed on the public dashboard.

---

## 7. Build Order (no time pressure — do it properly)

1. **Backend first.** Build the canonical report schema (type, location, timestamp, source channel, raw payload, status) in SQLite. Get the dashboard reading and writing to it with fake test data before touching any telephony.
2. **Voice/IVR next**, using the Twilio free trial to move fast. Get a real call, from a real phone, landing a real record end to end.
3. **Migrate to the self-hosted Asterisk + GSM dongle path** once the flow works on Twilio — this removes your only recurring cost and the internet-dependency caveat in point 2 of Section 6.
4. **Add SMS** as a second adapter into the same backend (Gammu, or Twilio SMS during prototyping).
5. **Harden the backend**: move to Postgres, add rate-limiting, add operator authentication, add a verify/resolve status workflow.
6. **USSD last**, only if/when you've found a telco or aggregator willing to work with a student project — reach out early since this has the longest lead time and is out of your hands.
7. **Skip Bluetooth mesh entirely.** That's a different, already well-solved problem (Bridgefy, Meshtastic, Briar) — you can't out-build it, and it isn't what CallCast is for. CallCast is for when the network is up but deliberately crippled, not for when there's no network at all.

---

## 8. Why This Is Different From Bluetooth-Mesh Tools (Bridgefy, Briar, Meshtastic, FireChat)

| | Bridgefy / Briar / Meshtastic / FireChat | CallCast |
|---|---|---|
| Solves | No cellular network at all | Cellular network up, but data/SMS deliberately cut or throttled |
| Requires | A smartphone with Bluetooth/Wi-Fi Direct, or LoRa hardware | Any phone that can dial or text |
| Range | Person-to-person, limited by radio range unless relayed hop-by-hop | City-wide, wherever the carrier's voice/SMS network reaches |
| Best for | Places with zero infrastructure (protests, remote areas, disasters that destroy towers) | Deliberate shutdowns where towers work but the internet gateway is throttled — the July Revolution scenario |

Both approaches are valid and solve genuinely different problems — they're not competitors, they're complements.

---

## 9. Credits / Inspiration

Dedicated to the spirit of **Jogajog**, which kept people connected during the internet shutdowns of the July Revolution — built on the idea that resilience means designing for the channel that's actually still there, not the one we wish were there, and that a zero-budget build can still be a properly engineered one.
