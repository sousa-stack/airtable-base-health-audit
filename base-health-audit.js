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
 * Pad a string to a minimum width with trailing spaces.
 */
function pad(str, width) {
    if (str.length >= width) return str;
    return str + ' '.repeat(width - str.length);
}

/**
 * Build a markdown table from headers and rows with auto-padded columns.
 * Padding ensures columns have breathing room in the rendered output.
 */
function mdTable(headers, rows) {
    // Calculate max width per column (min 3 for the --- separator)
    const colWidths = headers.map((h, ci) => {
        let max = h.length;
        for (const row of rows) {
            if (row[ci] && row[ci].length > max) max = row[ci].length;
        }
        return Math.max(max, 3);
    });

    const paddedHeaders = headers.map((h, ci) => pad(h, colWidths[ci]));
    const sep = colWidths.map(w => '-'.repeat(w));
    const lines = [
        '| ' + paddedHeaders.join(' | ') + ' |',
        '| ' + sep.join(' | ') + ' |',
    ];
    for (const row of rows) {
        const paddedRow = row.map((cell, ci) => pad(cell, colWidths[ci]));
        lines.push('| ' + paddedRow.join(' | ') + ' |');
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
// SCOPE SELECTION — Pick a table or audit the full base
// =============================================================

report += '# 🏥 Base Health Audit\n\n';
output.clear();
output.markdown(report);

const scopeChoices = [{ label: '🗂️ Audit entire base', value: '__all__' }];
for (const t of base.tables) {
    scopeChoices.push({ label: t.name, value: t.id });
}

const scopeChoice = await input.buttonsAsync(
    'What would you like to audit?',
    scopeChoices
);

const auditAll = scopeChoice === '__all__';
const tablesToAudit = auditAll
    ? base.tables
    : [base.getTable(scopeChoice)];

const scopeLabel = auditAll
    ? 'Full Base (' + base.tables.length + ' tables)'
    : tablesToAudit[0].name;

report += '**Scope:** ' + scopeLabel + '\n\n';

// =============================================================
// PHASE 1 — Schema Scan
// =============================================================

report += '---\n\n';
report += '## 🔍 Phase 1 — Schema Scan\n\n';
renderProgress(report, '🔍 **Scanning tables... (0 of ' + tablesToAudit.length + ' complete)**');

// Build a map of tableId -> set of table names that link TO it
// Always scan ALL tables for relationship mapping even in single-table mode
const inboundLinks = {}; // tableId -> Set of source table names
for (const t of base.tables) {
    inboundLinks[t.id] = new Set();
}

// Discover all linked-record relationships across entire base
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

// Collect stats for tables in scope
for (let i = 0; i < tablesToAudit.length; i++) {
    const t = tablesToAudit[i];
    renderProgress(report, '🔍 **Scanning tables... (' + (i + 1) + ' of ' + tablesToAudit.length + ' complete)**');

    const query = await t.selectRecordsAsync({ fields: [] }); // zero fields — just need count
    const recordCount = query.records.length;
    const fieldCount = t.fields.length;
    const linkedFrom = inboundLinks[t.id];
    const isIsolated = linkedFrom.size === 0;
    const status = isIsolated ? '⚠️ Isolated' : '✅';
    const inboundCount = linkedFrom.size;

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
        inboundCount,
        linkedFromNames: Array.from(linkedFrom),
        status,
        isIsolated,
    });
}

// Render Phase 1 — slim overview table
const phase1Headers = ['Table', 'Records', 'Fields', 'Inbound Links', 'Status'];
const phase1Rows = tableStats.map(s => [
    s.name,
    String(s.recordCount),
    String(s.fieldCount),
    String(s.inboundCount),
    s.status,
]);
report += mdTable(phase1Headers, phase1Rows) + '\n\n';

// Relationship details — listed below the table for any table with inbound links
const tablesWithInbound = tableStats.filter(s => s.inboundCount > 0);
if (tablesWithInbound.length > 0) {
    report += '---\n\n';
    report += '### 🔗 Relationship Map\n\n';
    for (const s of tablesWithInbound) {
        report += '- **' + s.name + '** ← ' + s.linkedFromNames.join(', ') + '\n';
    }
    report += '\n';
}

// =============================================================
// PHASE 2 — Field-Level Analysis
// =============================================================

report += '---\n\n';
report += '## 📊 Phase 2 — Field-Level Analysis\n\n';
renderProgress(report, '📊 **Analyzing fields... (0 of ' + tableStats.length + ' tables complete)**');

for (let i = 0; i < tableStats.length; i++) {
    const stat = tableStats[i];
    const t = stat.table;
    const totalFieldsInTable = t.fields.length;

    renderProgress(report, '📊 **Analyzing table ' + (i + 1) + ' of ' + tableStats.length + ' — ' + t.name + '**\n\n🔍 Loading records...');

    // Load all records with all fields
    let records = [];
    if (stat.recordCount > 0 && totalFieldsInTable > 0) {
        const query = await t.selectRecordsAsync({ fields: t.fields });
        records = query.records;
    }

    renderProgress(report, '📊 **Analyzing table ' + (i + 1) + ' of ' + tableStats.length + ' — ' + t.name + '**\n\n🔍 Analyzing field 0 of ' + totalFieldsInTable + '...');

    const flaggedFields = [];

    for (let fi = 0; fi < t.fields.length; fi++) {
        const field = t.fields[fi];

        // Update progress every 10 fields or on the last field
        if (fi % 10 === 0 || fi === t.fields.length - 1) {
            renderProgress(report, '📊 **Analyzing table ' + (i + 1) + ' of ' + tableStats.length + ' — ' + t.name + '**\n\n🔍 Analyzing field ' + (fi + 1) + ' of ' + totalFieldsInTable + '... `' + field.name + '`');
        }

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
            flags.push('❌ Empty — candidate for deletion');
        } else if (total > 0 && fillRate < 15) {
            flags.push('⚠️ Low fill (' + fillRate + '%) — possibly abandoned');
        }

        if (uniqueSelectValues && uniqueSelectValues.size >= 20) {
            flags.push('🔗 Normalization candidate — ' + uniqueSelectValues.size + ' unique values');
        }

        if (field.type === 'multipleRecordLinks' && total > 0) {
            const avgLinks = totalLinks / total;
            if (avgLinks === 0) {
                flags.push('⚠️ Linked field with no links');
            }
        }

        if (flags.length > 0) {
            const fieldName = field.name && field.name.trim() !== '' ? field.name : '(unnamed field)';
            flaggedFields.push({
                name: fieldName,
                type: field.type,
                fillRate: fillRate + '%',
                flags,
            });
            for (const flag of flags) {
                allFlags.push({
                    table: t.name,
                    field: fieldName,
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
        // One row per flag — field name repeated on every row for clarity
        const headers = ['Field', 'Type', 'Fill Rate', 'Issue'];
        const rows = [];
        for (const f of flaggedFields) {
            for (const flag of f.flags) {
                rows.push([
                    f.name,
                    f.type,
                    f.fillRate,
                    flag,
                ]);
            }
        }
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

    renderProgress(report, '🔍 **Loading records from ' + dupTable.name + '...**');

    const dupQuery = await dupTable.selectRecordsAsync({ fields: dupTable.fields });
    const dupRecords = dupQuery.records;
    const groups = {};

    const totalDupRecords = dupRecords.length;
    for (let ri = 0; ri < dupRecords.length; ri++) {
        // Update progress every 500 records
        if (ri % 500 === 0) {
            renderProgress(report, '🔍 **Scanning for duplicates in ' + dupTable.name + '... (' + ri + ' of ' + totalDupRecords + ' records checked)**');
        }
        const rec = dupRecords[ri];
        let val = rec.getCellValueAsString(keyField);
        if (!val || val.trim() === '') continue;
        val = val.trim();
        if (!groups[val]) groups[val] = [];
        groups[val].push(rec.id);
    }

    renderProgress(report, '🔍 **Analyzing duplicate groups...**');

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

const emptyFields = allFlags.filter(f => f.issue.includes('Empty'));
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
