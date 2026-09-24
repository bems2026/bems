---
title: Governance and compliance
purpose: The regulation, safety, privacy and licensing that apply to an iBEMS installation
audience: [administrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo 2e79005
evidence: [E-035, E-166, E-188, E-191, E-193, E-206, E-207, E-208, E-209, E-210, E-211]
---

# Governance and compliance

This chapter says which Philippine laws touch an iBEMS installation, and what iBEMS does and does not do about each.
**It is not legal advice.** Confirm each point with the institution's legal, energy and records officers.

**How the law was read.** The Official Gazette, the Department of Energy's sites, the National Privacy Commission's
site and the Supreme Court E-Library could not be reached from the documentation session. Every quotation below is
from LawPhil's copy of the statute [E-207 to E-210]. Check each against an official copy before relying on it.
Anything that could not be read at all is marked `[UNVERIFIED]`.

## Energy efficiency and conservation

### What the law asks

**RA 11285**, the Energy Efficiency and Conservation Act of 2019 [E-207]:

- **Every government agency** must "ensure the efficient use of energy in their respective offices, facilities…"
  (§6).
- **Designated establishments** are those above a yearly consumption threshold: Type 1 from 500,000 to 4,000,000 kWh
  a year, Type 2 above that (§19). A designated establishment must:
  - submit an annual energy consumption and conservation report (ECCR) to the DOE by 15 April (§20(f));
  - have an energy audit every three years, by a certified auditor or an accredited energy service company (§20(g));
  - appoint a Certified Energy Conservation Officer (Type 1) or a Certified Energy Manager (Type 2) (§20(h)).

**The Government Energy Management Program (GEMP).** Administrative Order No. 15, s. 2024, directs national government
agencies and instrumentalities, GOCCs included, to accelerate the GEMP. It directs them to "establish a mechanism for
monitoring the energy consumption in their respective offices, and adhere to the reportorial requirements of the DOE"
[E-208]. The DOE's reporting guidelines, targets and portal could not be read: `[UNVERIFIED]`.

Two questions only the institution can answer (Q-20):

- **Is the institution a designated establishment?** That depends on its whole yearly consumption, not one building's.
- **Does AO 15 cover it as a state university?** The copy read does not name state universities `[UNVERIFIED]`.

### What iBEMS provides for reporting

| Need | iBEMS provides | Limits |
|---|---|---|
| Monitoring consumption in an office (AO 15 §2) | Per-minute metering of every metered circuit, and daily, weekly and monthly reports with their coverage ([04](04-data.md), [05](05-interface.md)) | Only the circuits it meters. The utility's meter remains the authority for the building's total. |
| Monthly consumption figures | *Reports → Export → Building by day (CSV)*, and the monthly report | Each figure carries its coverage. A month with gaps is stated, not filled. |
| An energy audit's baseline | `npm run baseline:report` ([90](90-replication.md)) [E-206] | A baseline needs enough weeks of clean data |
| Evidence that a measure saved energy | Query 8 in the cookbook (before and after a change), and query 10 (baseline against current) ([04](04-data.md#query-cookbook)) | Weather and occupancy also change. State them. |
| Cost and emissions | Reports, once a tariff and an emission factor are entered with their sources | The factor is the site's to choose and cite |

iBEMS does not file anything with the DOE. The institution's energy officer does, from these exports.

## Electrical safety

**RA 7920**, the New Electrical Engineering Law [E-209]:

- No electrical installation may be done unless it follows **the Philippine Electrical Code** and is under the
  responsible charge of a professional electrical engineer, a registered electrical engineer, or a registered master
  electrician (§34).
- A registered master electrician may install and wire, but work rated above 500 kVA or 600 V must be supervised by a
  professional or registered electrical engineer (§31(c)).
- Electrical plans must be signed and sealed by a professional electrical engineer (§34).

For iBEMS this means:

- **Every step inside a distribution panel, the CT meters and any hard-wired switch, is licensed work**
  ([`physical-install.md`](physical-install.md) §0). The installer's licence and the permit to work are part of the
  commissioning pack ([X3](X3-operations.md#the-commissioning-pack)).
- **Everything outside the panel is not electrical work**: the edge, the network, plug-in outlets and the infrared
  hub.
- The institution's own permit-to-work and PPE rules apply on top. They are a gap in
  [`physical-install.md`](physical-install.md) to be filled on site (Q-13).
- **The app is not a safety device.** Isolate at the breaker ([X3](X3-operations.md#incident-response)).

## Data privacy

**RA 10173**, the Data Privacy Act of 2012 [E-210], applies to **personal information**: information "from which the
identity of an individual is apparent or can be reasonably and directly ascertained" (§3(g)).

### What iBEMS holds

| Data | Personal? | Held in | Kept |
|---|---|---|---|
| Account emails and sign-in times | Yes | The database's sign-in service | While the account exists |
| Who sent each command, and when | Yes: it ties a person to an action | `commands.requested_by`, and the owner of each rule | **Never pruned** [E-193] |
| An email snapshot beside each tariff and emission factor | Yes | `energy_tariffs`, `emission_factors` [E-166] | For good |
| Request origins and a token prefix | Possibly | The proxy's journal on the edge [E-191] | Up to the journal's 90 days [E-035] |
| Energy readings | Not by themselves. **A single-occupant room's consumption can reveal when that person is present.** | `readings` and the hourly tables | 30 days per minute, then hourly for good |

### How it is protected

§20 asks for "reasonable and appropriate organizational, physical and technical measures" [E-210]:

- **Technical:** sign-in for every read, row-level security, no anonymous access, the service-role key kept off
  browsers ([X1](X1-security.md)).
- **Organisational:** accounts by invitation, one per person, reviewed quarterly, and removed when someone leaves
  ([X1](X1-security.md#how-to-operate)).
- **Physical:** the edge in a locked place. Its card holds the credentials unencrypted [E-188].

Under §11, processing follows **transparency, legitimate purpose and proportionality**. So:

- tell the building's occupants what is measured and why;
- use readings for energy management, not to watch people;
- report by circuit or room, not by person.

A qualifying breach must be reported promptly to the National Privacy Commission and the people affected (§20(f)).
The institution's data protection officer owns that. Name them in the commissioning pack.

## Licensing and citation

| Part | Licence | Evidence |
|---|---|---|
| The code | MIT, in `LICENSE` | E-211 |
| This manual | **Not yet declared** (Q-20) | E-211 |

**Citing iBEMS.** A template, to be completed by the project owner:

> 〔Authors〕 (2026). *iBEMS: an intelligent building energy management system — adoption and replication manual*.
> 〔Institution〕. 〔Repository URL〕, 〔version or commit〕.

## Acknowledgements

〔PLACEHOLDER — to be supplied by the project owner.〕 The public manual carries no funding, milestone or deadline
detail, by the project owner's decision of 2026-09-23.
