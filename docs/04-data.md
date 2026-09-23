---
title: Data and storage
purpose: Understand, size and query the relational store, its ingestion and retention (L4)
audience: [integrator, administrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo afa5aaf
evidence: []
---

# Data and storage

*Not written yet. This page is a scaffold (Phase S2). Its checklist is in the page source.*

## What it is

<!-- Brief (prompt §9). Cover:
     - Schema table by table, column by column, units, constraints, why each table exists (23 tables, E-064) — link storage-contract.md
     - Honesty rules: a gap is a gap; a silent device is excluded; record before dispatch; every automatic action has an owner — and where each is enforced (F-013)
     - Keys and access: service role only on the edge; browser anon key under RLS; roles; anonymous view
     - Ingestion: interval, batching, idempotency, duplicates, late arrivals, outage buffering, ingestion_health
     - Sizing and retention: rows/day = devices × 86 400 ÷ interval_s; bytes/day from MEASURED bytes/row (Q-01); plan cap and pause rules (E-089); raw resolution, rollup, queries across both
     - Secondary archive (C11 confirmed): a spreadsheet is a report mirror, not a system of record
     - Query cookbook (the ten queries in the brief)
     - Reporting exports for government energy reporting (93)
-->

## What you need

## How to install

## How to configure

## How to verify

## How to operate

## How it fails

| Symptom | Likely cause | Check that tells the causes apart | Fix | How to confirm it held |
|---|---|---|---|---|

<!-- At minimum: writes failing silently; duplicates; wrong time zone; counter rollover producing a negative day; totals not reconciling with the meter; storage outrunning the plan; project paused by the host; UI empty but rows exist (RLS). -->

## Field issue log

## What to keep on the shelf
