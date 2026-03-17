// ============================================================
// 🏥 Airtable Base Health Audit
// A read-only scripting extension that scans your entire base
// and produces a professional health report.
// ============================================================

// --- Helpers -------------------------------------------------

/**
 * Chunk an array into batches of a given size.
 */
function chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

/**
 * Check if a cell value is "empty" for fill-rate purposes.
 */
function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
}

/**
 * Render a progress line and re-draw the accumulated output.
 */
function renderProgress(accumulated, progressLine) {
    output.clear();
    output.markdown(accumulated + '\n\n' + progressLine);
}

/**
 * Build a markdown table from headers and rows.
 */
function mdTable(headers, rows) {
    const sep = headers.map(() => '---');
    const lines = [
        '| ' + headers.join(' | ') + ' |',
        '| ' + sep.join(' | ') + ' |',
    ];
    for (const row of rows) {
        lines.push('| ' + row.join(' | ') + ' |');
    }
    return lines.join('\n');
}

// --- Main Script ---------------------------------------------

// We accumulate all output so we can re-render with progress updates.
let report = '';

// Will be populated across phases.
const tableStats = [];      // per-table stats for phase 1
const allFlags = [];         // every flagged issue across the base
let totalRecords = 0;
let totalFields = 0;

// =============================================================
// PHASE 1 — Schema Scan
// =============================================================

report += '# 🏥 Base Health Audit\n\n';
report += '---\n\n';
report += '## 🔍 Phase 1 — Schema Scan\n\n';
renderProgress(report, '🔍 **Scanning tables... (0 of ' + base.tables.length + ' complete)**');

// Build a map of tableId -> set of table names that link TO it
const inboundLinks = {}; // tableId -> Set of source table names
for (const t of base.tables) {
    inboundLinks[t.id] = new Set();
}

// First pass: discover all linked-record relationships
for (const t of base.tables) {
    for (const f of t.fields) {
        if (f.type === 'multipleRecordLinks') {
            const linkedTableId = f.options && f.options.linkedTableId;
            if (linkedTableId && inboundLinks[linkedTableId]) {
                inboundLinks[linkedTableId].add(t.name);
            }
        }
    }
}

// Second pass: collect stats per table
for (let i = 0; i < base.tables.length; i++) {
    const t = base.tables[i];
    renderProgress(report, '🔍 **Scanning tables... (' + (i + 1) + ' of ' + base.tables.length + ' complete)**');

    const query = await t.selectRecordsAsync({ fields: [] }); // zero fields — just need count
    const recordCount = query.records.length;
    const fieldCount = t.fields.length;
    const linkedFrom = inboundLinks[t.id];
    const linkedFromStr = linkedFrom.size > 0 ? Array.from(linkedFrom).join(', ') : '—';
    const isIsolated = linkedFrom.size === 0;
    const status = isIsolated ? '⚠️ Isolated' : '✅';

    totalRecords += recordCount;
    totalFields += fieldCount;

    if (isIsolated) {
        allFlags.push({
            table: t.name,
            field: '—',
            severity: 'warning',
            issue: 'Isolated table — no other table links to it',
        });
    }

    tableStats.push({
        table: t,
        name: t.name,
        recordCount,
        fieldCount,
        linkedFromStr,
        status,
        isIsolated,
    });
}

// Render Phase 1 table
const phase1Headers = ['Table', 'Records', 'Fields', 'Linked From', 'Status'];
const phase1Rows = tableStats.map(s => [s.name, String(s.recordCount), String(s.fieldCount), s.linkedFromStr, s.status]);
report += mdTable(phase1Headers, phase1Rows) + '\n\n';

// =============================================================
// PHASE 2 — Field-Level Analysis
// =============================================================

report += '---\n\n';
report += '## 📊 Phase 2 — Field-Level Analysis\n\n';
renderProgress(report, '📊 **Analyzing fields... (0 of ' + base.tables.length + ' tables complete)**');

for (let i = 0; i < tableStats.length; i++) {
    const stat = tableStats[i];
    const t = stat.table;
    renderProgress(report, '📊 **Analyzing fields... (' + (i + 1) + ' of ' + tableStats.length + ' tables) — ' + t.name + '**');

    // Load all records with all fields
    const fieldNames = t.fields.map(f => f.name);
    let records = [];
    if (stat.recordCount > 0 && fieldNames.length > 0) {
        const query = await t.selectRecordsAsync({ fields: t.fields });
        records = query.records;
    }

    const flaggedFields = [];

    for (const field of t.fields) {
        const flags = [];
        let filledCount = 0;
        let uniqueSelectValues = null;
        let totalLinks = 0;

        for (const rec of records) {
            const val = rec.getCellValue(field);
            if (!isEmpty(val)) {
                filledCount++;
            }

            // Single select unique values
            if (field.type === 'singleSelect' && val && val.name) {
                if (!uniqueSelectValues) uniqueSelectValues = new Set();
                uniqueSelectValues.add(val.name);
            }

            // Linked record average
            if (field.type === 'multipleRecordLinks' && Array.isArray(val)) {
                totalLinks += val.length;
            }
        }

        const total = records.length;
        const fillRate = total > 0 ? Math.round((filledCount / total) * 100) : 0;

        if (total > 0 && fillRate === 0) {
            flags.push('❌ Empty field — candidate for deletion');
        } else if (total > 0 && fillRate < 15) {
            flags.push('⚠️ Low fill (' + fillRate + '%) — possibly abandoned');
        }

        if (uniqueSelectValues && uniqueSelectValues.size >= 20) {
            flags.push('🔗 Normalization candidate — ' + uniqueSelectValues.size + ' unique values; consider linked table');
        }

        if (field.type === 'multipleRecordLinks' && total > 0) {
            const avgLinks = totalLinks / total;
            if (avgLinks === 0) {
                flags.push('⚠️ Linked field with no links');
            }
        }

        if (flags.length > 0) {
            flaggedFields.push({
                name: field.name,
                type: field.type,
                fillRate: fillRate + '%',
                flags,
            });
            for (const flag of flags) {
                allFlags.push({
                    table: t.name,
                    field: field.name,
                    severity: flag.startsWith('❌') ? 'error' : 'warning',
                    issue: flag,
                });
            }
        }
    }

    // Output per-table section
    const healthEmoji = flaggedFields.length === 0 ? '✅' : '⚠️';
    report += '### ' + healthEmoji + ' ' + t.name + '\n\n';

    if (flaggedFields.length === 0) {
        report += '_No issues found — all fields healthy._\n\n';
    } else {
        const headers = ['Field', 'Type', 'Fill Rate', 'Issue(s)'];
        const rows = flaggedFields.map(f => [
            f.name,
            f.type,
            f.fillRate,
            f.flags.join('<br>'),
        ]);
        report += mdTable(headers, rows) + '\n\n';
    }
}

// =============================================================
// PHASE 3 — Duplicate Detection
// =============================================================

report += '---\n\n';
report += '## 🔍 Phase 3 — Duplicate Detection\n\n';
output.clear();
output.markdown(report);

const dupChoices = tableStats.map(s => ({ label: s.name, value: s.name }));
dupChoices.push({ label: '⏭️ Skip duplicate check', value: '__skip__' });

const dupChoice = await input.buttonsAsync(
    'Select a table to check for duplicates (or skip):',
    dupChoices
);

if (dupChoice === '__skip__') {
    report += '_Duplicate check skipped by user._\n\n';
} else {
    const dupTable = base.getTable(dupChoice);
    const keyField = await input.fieldAsync('Pick the key field for uniqueness check:', dupTable);

    renderProgress(report, '🔍 **Scanning for duplicates in ' + dupTable.name + '...**');

    const dupQuery = await dupTable.selectRecordsAsync({ fields: dupTable.fields });
    const groups = {};

    for (const rec of dupQuery.records) {
        let val = rec.getCellValueAsString(keyField);
        if (!val || val.trim() === '') continue;
        val = val.trim();
        if (!groups[val]) groups[val] = [];
        groups[val].push(rec.id);
    }

    const dupes = Object.entries(groups).filter(([_, ids]) => ids.length > 1);

    if (dupes.length === 0) {
        report += '✅ No duplicates found in **' + dupTable.name + '** on field **' + keyField.name + '**.\n\n';
    } else {
        report += '⚠️ Found **' + dupes.length + '** duplicate value(s) in **' + dupTable.name + '** on field **' + keyField.name + '**:\n\n';
        const headers = ['Value', 'Count', 'Record IDs'];
        const rows = dupes.map(([val, ids]) => [
            val.length > 40 ? val.substring(0, 37) + '...' : val,
            String(ids.length),
            ids.join(', '),
        ]);
        report += mdTable(headers, rows) + '\n\n';

        allFlags.push({
            table: dupTable.name,
            field: keyField.name,
            severity: 'warning',
            issue: '⚠️ ' + dupes.length + ' duplicate value(s) detected',
        });
    }
}

// =============================================================
// PHASE 4 — Summary Dashboard
// =============================================================

report += '---\n\n';
report += '## ✅ Base Health Summary\n\n';

// Overall health rating
const errorCount = allFlags.filter(f => f.severity === 'error').length;
const warningCount = allFlags.filter(f => f.severity === 'warning').length;
let overallHealth;
if (errorCount > 0) {
    overallHealth = '❌ **Issues Found**';
} else if (warningCount > 0) {
    overallHealth = '⚠️ **Needs Attention**';
} else {
    overallHealth = '✅ **Healthy**';
}

report += '**Overall Health:** ' + overallHealth + '\n\n';

// Stats summary
const tablesWithIssues = new Set(allFlags.map(f => f.table)).size;
const healthyTables = tableStats.length - tablesWithIssues;

const summaryHeaders = ['Metric', 'Value'];
const summaryRows = [
    ['Total Tables', String(tableStats.length)],
    ['Total Fields', String(totalFields)],
    ['Total Records Scanned', String(totalRecords)],
    ['Tables with Issues', String(tablesWithIssues)],
    ['Healthy Tables', String(healthyTables)],
    ['Total Flags', String(allFlags.length)],
];
report += mdTable(summaryHeaders, summaryRows) + '\n\n';

// Top Issues — sorted by severity (errors first, then warnings)
if (allFlags.length > 0) {
    report += '### 🚨 Top Issues\n\n';
    const sorted = [...allFlags].sort((a, b) => {
        const sev = { error: 0, warning: 1 };
        return (sev[a.severity] || 2) - (sev[b.severity] || 2);
    });

    const issueHeaders = ['#', 'Table', 'Field', 'Issue'];
    const issueRows = sorted.map((f, i) => [
        String(i + 1),
        f.table,
        f.field,
        f.issue,
    ]);
    report += mdTable(issueHeaders, issueRows) + '\n\n';
}

// Recommended Actions
report += '### 📋 Recommended Actions\n\n';

const actions = [];

const emptyFields = allFlags.filter(f => f.issue.includes('Empty field'));
if (emptyFields.length > 0) {
    actions.push('**' + emptyFields.length + ' empty field(s)** are candidates for deletion — review and remove to reduce clutter.');
}

const lowFill = allFlags.filter(f => f.issue.includes('Low fill'));
if (lowFill.length > 0) {
    actions.push('**' + lowFill.length + ' field(s)** have very low fill rates — confirm whether they are still in use or should be archived.');
}

const normCandidates = allFlags.filter(f => f.issue.includes('Normalization candidate'));
if (normCandidates.length > 0) {
    actions.push('**' + normCandidates.length + ' single-select field(s)** have 20+ unique values — consider converting to linked record tables for better data integrity.');
}

const isolatedTables = allFlags.filter(f => f.issue.includes('Isolated table'));
if (isolatedTables.length > 0) {
    actions.push('**' + isolatedTables.length + ' table(s)** are isolated with no inbound links — verify they are intentionally standalone or add relationships.');
}

const noLinks = allFlags.filter(f => f.issue.includes('Linked field with no links'));
if (noLinks.length > 0) {
    actions.push('**' + noLinks.length + ' linked record field(s)** have zero links — these relationships may need data population or the fields may be unused.');
}

const dupeFlags = allFlags.filter(f => f.issue.includes('duplicate'));
if (dupeFlags.length > 0) {
    actions.push('**Duplicate records detected** — review and merge or de-duplicate to maintain data quality.');
}

if (actions.length === 0) {
    actions.push('No critical actions needed — your base is in good shape! Consider periodic re-audits as your data grows.');
}

for (const action of actions) {
    report += '- ' + action + '\n';
}

report += '\n---\n\n';
report += '_Audit complete. This report is read-only — no records or fields were modified._\n';

// Final render
output.clear();
output.markdown(report);
