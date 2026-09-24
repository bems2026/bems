---
title: Open questions
purpose: Every gap the audit could not close, with who closes it and the next action
audience: [administrator, operator]
status: Draft
last_verified: 2026-09-24
applies_to: repo 2f4c570 · edge checkout fcb1ff6
evidence: [E-012, E-023, E-027, E-029, E-034, E-038, E-045, E-058, E-079, E-084, E-090, E-176, E-184, E-187]
---

# Open questions

Owners:
- **Operator:** the person with sudo on the edge and admin on the accounts.
- **Institution:** a decision or a fact only the facility or the university can give.
- **Site visit:** needs someone standing in the room.
- **Next session:** a read-only check that a later documentation session can do itself.

Until a question is closed, any manual statement that depends on it is marked `[UNVERIFIED]`.

| ID | Question | Why it matters | Owner | Next action | Blocks |
|---|---|---|---|---|---|
| Q-01 | What is the database's current size, bytes per row for the big tables, and plan tier? | The sizing and retention method (prompt §9 L4), and F-004's read-only risk. | Operator | In the database's SQL editor, run the two queries under this table and paste the output. Read the plan tier from the project's billing page. | `04-data.md` sizing; F-004 |
| Q-02 | Who widened the broker on 2026-09-17, and does anything on the LAN genuinely need to publish to it (the ESP32 sniffer, the inverter bridge)? | Decides F-001's fix: loopback only, or a LAN listener with a password file. It also decides how the ADR on MQTT reads. | Operator | Answer from memory or notes. The next session may also skim the edge's own Claude Code session transcripts for 2026-09-17, read-only, per prompt A1. | F-001, F-005, ADR on MQTT |
| Q-03 | ~~Does a copy of the edge's credentials exist off the SD card?~~ **Closed 2026-09-24. Yes, a complete copy exists** (E-079, stated by the operator). The remaining gap, writing the practice down and running one restore drill, is carried by F-002. | — | — | — | — |
| Q-04 | Does the edge's SSH daemon accept passwords? | F-008. | Operator | `ssh <edge-user>@<edge-host> 'sudo sshd -T \| grep -iE "^(passwordauthentication\|permitrootlogin)"'` and paste the output. | `X1-security.md` |
| Q-05 | What make and endurance class is the SD card? It reports `SC128`, dated 06/2018. | F-015. Endurance class is what the edge chapter recommends replacing it with. | Site visit | Read the label on the card, or on its packaging if kept. | `03-edge.md` storage |
| Q-06 | What enclosure, heatsink or fan does the edge have, and how does air reach it? | F-003. | Site visit | One photo of the edge in place, plus a note on ventilation. | `03-edge.md` hardware |
| Q-07 | ~~How does the kiosk browser start?~~ **Closed 2026-09-23.** It runs as a systemd **user** unit identical to `server/ibems-kiosk.service` (E-023). | — | — | — | — |
| Q-08 | Why did 19 auto-shed commands never leave `dispatching`? | F-006. The audit trail's completeness. | Next session | Read-only: `journalctl -u ibems-scheduler --since '2026-09-22' \| grep -E 'l4\|dispatch'` around each row's `requested_at`. | `X2-control-logic.md` |
| Q-09 | How many rows does each Google Sheet hold, and which account owns the mirror? | F-018. The spreadsheet's cell limit and the account-ownership rule (X1). | Operator | Open each sheet and note its row count and owner. No sheet IDs in the reply. | `04-data.md` secondary archive |
| Q-10 | Are the vendor app, database, mesh-network and code-host accounts institution-owned, and who holds each? | X1 requires institution-owned accounts with a handover procedure. The mesh network's owner label is not obviously an institutional account. | Institution | Name the role that owns each account, not a person's email. | `X1-security.md` account ownership |
| Q-11 | ~~Is the `unattended-upgrades` package installed?~~ **Closed 2026-09-23.** It is not (E-038). | — | — | — | — |
| Q-12 | When will the inverter logger join the device network (RM-026)? | It decides whether the solarman node, the Deye tab and the broker are kept (F-014, F-001). | Institution | Give the date or state the blocker. | `94-roadmap.md` |
| Q-13 | The 12 `〔FILL IN〕` gaps in `docs/physical-install.md`. | L1 electrical installation, and panel and part facts. Never filled by inference. | Site visit | Use `docs/physical-install.md` as the checklist on the visit. | `01-field-devices.md`, `99-worked-example.md` |
| Q-14 | Was the architecture revision that dropped Home Assistant and TimescaleDB made on 2026-08-18, as C1 says? No 2026-08-15..22 commit subject names it. The nearest is `0024389` (2026-08-21), which prunes "the MQTT twin" from the flow. | Dating the ADRs. | Next session | Read the ROADMAP entries and ADR-001's context for the decision date. | ADRs |
| Q-15 | Do the ten query-cookbook queries in `04-data.md` run and return what they claim? In particular: does a meter share its `branch_circuit` value with its outlets (query 5)? | The manual shows no command it has not run (DoD). The queries could not be executed from the documentation session. | Operator | Run each in the SQL editor (all read-only) and note any error or surprising result | `04-data.md` cookbook |
| Q-16 | What does the tailnet's SSH policy actually allow, and which devices should keep access? | F-025. Record the policy by rule in X1. | Operator | Read it in the tailnet admin console, then narrow it to named admin devices and the service user | `X1-security.md` |
| Q-17 | Does the database's account list hold only people you know? Sign-up has been open (F-026), so an account you did not create is possible. | F-026. Any signed-in account can arm schedules that switch real loads. | Operator | Sign-up is now off (E-176). Open *Authentication → Users* and delete any account you do not recognise. If the database refuses to delete one, that account has sent a command or saved a setting (E-184). Ban it instead, then look at what it did in `commands` and `schedules`. Report the count only, with no email addresses. The documentation session's read of this list was blocked. | `X1-security.md`; F-026 |
| Q-18 | Is break-glass configured on the edge, and has anyone used it? | F-027. Break-glass is the account-outage fallback, and X1 must say who holds it. | Operator | `ssh <edge-user>@<edge-host> 'grep -c "^BREAK_GLASS_PASSWORD_HASH=." ~/bems/server/.env; journalctl -u ibems-proxy \| grep -c "POST /api/local-login"'` and paste the two numbers. | `X1-security.md`; `05-interface.md` break-glass |
| Q-19 | Is the edge's service-role key a legacy key (a long token beginning `eyJ`) or a newer secret key (`sb_secret_…`)? | The two rotate differently: a newer key can be deleted by itself; a legacy one only by retiring the legacy keys (E-187). | Operator | Look at the first characters in the provider's API-key settings, not on the edge. Answer "legacy" or "secret key" only. | `X1-security.md` rotation |

## Q-01 queries (read-only)

```sql
-- working directory: the database's SQL editor. Read-only.
select pg_size_pretty(sum(pg_database_size(datname))) as database_size from pg_database;

select relname as table_name,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size,
       n_live_tup as live_rows,
       round(pg_total_relation_size(relid)::numeric / nullif(n_live_tup, 0)) as bytes_per_row
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 12;
```
