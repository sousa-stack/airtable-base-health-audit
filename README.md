# 🏥 Airtable Base Health Audit

> A read-only scripting extension that scans your Airtable base and produces a structured, professional health report — field fill rates, normalization candidates, orphaned tables, broken relationships, and duplicate records. Built for Airtable consultants and power users who want real diagnostic data without leaving the platform.

---

## What It Does

Most Airtable bases accumulate technical debt silently — abandoned fields nobody uses, single-select fields that have grown into de-facto databases, linked record fields with no actual links, and tables that exist in isolation with no relationships to the rest of the base. None of this is visible from the normal grid view.

Base Health Audit surfaces all of it in a single run.

### The Four Phases

**Phase 1 — Schema Scan**
Counts records and fields per table, maps every linked-record relationship across the entire base, and flags any table that no other table links to (isolated/orphaned).

**Phase 2 — Field-Level Analysis**
Loads each user-editable field individually and calculates fill rate (percentage of records where the field has data). Flags empty fields, low-fill fields, single-select fields with 20+ unique values (normalization candidates), and linked record fields with zero links. Computed fields — formulas, rollups, lookups, auto numbers, etc. — are skipped automatically since their fill rate is meaningless.

**Phase 3 — Duplicate Detection**
Lets you pick any table and any key field, then scans every record and groups them by that field value. Reports any value that appears more than once — useful for finding duplicate contacts, companies, SKUs, or any other unique identifier that's been entered twice.

**Phase 4 — Summary Dashboard**
Produces an overall health rating (✅ Healthy / ⚠️ Needs Attention / ❌ Issues Found), a full flag count broken down by table, a prioritized Top Issues list sorted by severity, and a Recommended Actions section with plain-English next steps based on what was actually found.

---

## Why I Built This

I work as a developer at an Airtable consultancy. One of the most common things I do when onboarding a new client base is manually audit the schema — opening every table, eyeballing field counts, checking which fields are actually populated, noting where a single-select has ballooned into 40 options that probably deserve their own table.

That process was slow, repetitive, and easy to miss things in. This script automates the structural part of that audit so I can run it in 30 seconds and spend my actual time on the analysis, not the data collection.

---

## Installation

1. Open your Airtable base
2. Click **Tools** → **Extensions** → **Add an extension**
3. Search for and add the **Scripting** extension
4. Click **Edit script** and paste the contents of [`base-health-audit.js`](./base-health-audit.js)
5. Click **Run**

No API key required. No external services. Everything runs locally in your browser against your own base data.

---

## Usage

On run, you'll be asked two questions before anything happens:

1. **Scope** — Audit the entire base, or pick a single table
2. **Duplicate check** — Optionally pick a table and key field to scan for duplicates (or skip)

After that, the script runs automatically and renders the report in-place as it progresses. The whole thing is read-only — nothing is modified, created, or deleted.

---

## Output Example

```
# 🏥 Base Health Audit
Scope: Full Base (6 tables)

---

## 🔍 Phase 1 — Schema Scan

|  Table         |  Records  |  Fields  |  Inbound Links  |  Status      |
| ---            | ---       | ---      | ---             | ---          |
|  Clients       |  **312**  |  **18**  |  **3**          |  ✅          |
|  Projects      |  **89**   |  **24**  |  **2**          |  ✅          |
|  Contacts      |  **504**  |  **11**  |  **1**          |  ✅          |
|  Legacy Data   |  **1204** |  **6**   |  **0**          |  ⚠️ Isolated |

### 🔗 Relationship Map
- **Clients** ← Projects, Invoices, Contacts
- **Projects** ← Tasks, Invoices

---

## 📊 Phase 2 — Field-Level Analysis

### ⚠️ Clients

|  Field          |  Type          |  Fill Rate  |  Issue                                        |
| ---             | ---            | ---         | ---                                           |
|  Lead Source    |  Single Select |  3%         |  ⚠️ Low fill (3%) — possibly abandoned        |
|  Old Status     |  Single Select |  0%         |  ❌ Empty — candidate for deletion             |
|  Industry       |  Single Select |  78%        |  🔗 Normalization candidate — 23 unique values |

---

## ✅ Base Health Summary

Overall Health: ⚠️ Needs Attention

|  Metric                  |  Value  |
| ---                      | ---     |
|  Total Tables            |  6      |
|  Total Fields            |  97     |
|  Total Records Scanned   |  2,318  |
|  Tables with Issues      |  3      |
|  Healthy Tables          |  3      |
|  Total Flags             |  7      |

### 📋 Recommended Actions
- **1 empty field(s)** are candidates for deletion — review and remove to reduce clutter.
- **2 field(s)** have very low fill rates — confirm whether they are still in use.
- **1 single-select field(s)** have 20+ unique values — consider converting to linked tables.
- **1 table(s)** are isolated with no inbound links — verify they are intentionally standalone.
```

---

## Flags Reference

| Flag | Meaning |
|---|---|
| ❌ Empty — candidate for deletion | Field has 0% fill across all records |
| ⚠️ Low fill (N%) — possibly abandoned | Field has less than 15% fill |
| 🔗 Normalization candidate — N unique values | Single-select field has 20+ distinct values in use |
| ⚠️ Linked field with no links | A linked record field exists but contains zero links |
| ⚠️ Isolated table | No other table in the base has a linked record field pointing to this table |
| ⚠️ N duplicate value(s) detected | Duplicate check found repeated values on the chosen key field |

---

## Technical Notes

- **No external dependencies** — pure Airtable scripting API, no npm, no imports
- **Read-only** — uses only `selectRecordsAsync`, never `updateRecordAsync` or `createRecordAsync`
- **Per-field queries** — Phase 2 loads one field at a time rather than all fields at once, keeping memory usage low on large tables
- **Computed fields skipped** — formulas, rollups, lookups, auto numbers, created/modified timestamps, AI fields, and buttons are excluded from fill rate analysis since they always resolve to a value
- **Checkbox handling** — `false` (unchecked) correctly counts as unfilled; only `true` increments the fill count
- **No time limit** — the scripting extension runs client-side with no timeout, so large bases with thousands of records will complete without hitting the 30-second automation limit
- **en-space padding** — table columns use Unicode en-spaces (`\u2002`) for visual breathing room, since Airtable's markdown renderer collapses standard ASCII spaces

---

## Part of a Larger Toolkit

This is the first script in a set of Airtable consulting utilities I'm building and open-sourcing. The next two in progress:

- **Field → Linked Record Migrator** — converts a text or single-select field into proper linked records against an existing table, with full batch processing and an append-safe link update
- **Smart Batch Linker** — links records across tables by matching on any field (not just the primary field), solving the gap where Airtable's native automations only match on primary field values

---

## License

MIT — free to use, modify, and distribute. Attribution appreciated but not required.

---

*Built by [Kevin James Sousa](https://kevinjamessousa.com) · Airtable consultant & developer at [Relay](https://relay.build)*
