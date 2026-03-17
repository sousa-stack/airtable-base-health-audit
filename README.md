# Airtable Base Health Audit

A read-only Airtable Scripting Extension that scans your entire base and produces a professional health report. No records or fields are ever modified.

## What It Does

The script runs four phases and outputs a structured audit report:

### Phase 1 — Schema Scan
- Inventories every table: record count, field count, field types
- Maps linked-record relationships across the base
- Flags isolated (orphaned) tables with no inbound links

### Phase 2 — Field-Level Analysis
- Computes fill rate for every field in every table
- Flags empty fields (0% fill), low-fill fields (<15%), and single-select fields with 20+ unique values (normalization candidates)
- Identifies linked-record fields with zero links

### Phase 3 — Duplicate Detection
- Lets you pick a table and key field to check for duplicate values
- Reports duplicates with counts and record IDs

### Phase 4 — Summary Dashboard
- Overall health rating (Healthy / Needs Attention / Issues Found)
- Totals for tables, fields, and records scanned
- Prioritized issue list ranked by severity
- Recommended actions based on findings

## How to Use

1. Open any Airtable base
2. Go to **Extensions** → **Scripting**
3. Paste the contents of `base-health-audit.js` into the script editor
4. Click **Run**

The script will scan your base and display a formatted audit report directly in the scripting extension panel.

## Requirements

- Airtable Pro, Team, or Enterprise plan (Scripting Extension access)
- No external dependencies — runs entirely within Airtable's built-in script runner

## Safety

This script is **100% read-only**. It uses `selectRecordsAsync()` to read data and `output.markdown()` to display results. It never calls `createRecordAsync`, `updateRecordAsync`, `updateRecordsAsync`, or `deleteRecordAsync`.

## License

MIT
