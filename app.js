const surveyContainer = document.getElementById("surveyContainer");
const startScreen = document.getElementById("startScreen");
const resultsContainer = document.getElementById("resultsContainer");
const fieldSelectionContainer = document.getElementById("fieldSelectionContainer");
const chartsContainer = document.getElementById("chartsContainer");
const startSurveyBtn = document.getElementById("startSurveyBtn");
const loadResultsBtn = document.getElementById("loadResultsBtn");
const retryBtn = document.getElementById("retryBtn");
const startMessage = document.getElementById("startMessage");

// Message peers send when they complete the survey: { id, data: <SurveyJS result> }
const SUBJECT_COMPLETED = "surveyCompleted";
// The station's reply to the sender once it stored a result: { id }
const SUBJECT_STORED = "surveyStored";
// Without a reply in this time the answer counts as not received
const ACK_TIMEOUT = 5000;
const DB_NAME = "edrysSurveyDB";
const RESULTS_PER_PAGE = 10;

const db = new Dexie(DB_NAME);
db.version(1).stores({
    results: "id, timestamp, data, classroomId"
});

let currentSurvey = null;
let currentResults = [];
let activeCharts = [];
let availableFields = {};
// Field keys listed in the field selection; checkboxes refer to them by index
let selectableFields = [];
let currentPage = 1;

// Submission state of this user, kept per survey with Edrys.setItem
let surveyKey = "";       // identifies the configured survey (hash of its JSON)
let allowRetake = false;
let pending = null;       // { id, data }: sent, not yet confirmed by the station
let submitted = false;
let sendFailed = false;
let ackTimer = null;

// Answers and their keys come from peers: escape everything put into HTML
function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[c]);
}

// A survey result is a plain object of answers
function isAnswers(data) {
    return data !== null && typeof data === "object" && !Array.isArray(data);
}

function surveyQuestion(fieldKey) {
    return currentSurvey ? currentSurvey.getQuestionByName(fieldKey) : null;
}

function fieldTitle(fieldKey) {
    const question = surveyQuestion(fieldKey);
    if (question && question.title) return question.title;
    return fieldKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
}

// How the answers to a question are charted, from its SurveyJS type:
// 'categorical' (pie), 'multiple' (bar per option), 'rating' (bar per scale value),
// 'numerical' (histogram), or null when they can't be charted (free text, matrices, ...)
function chartKind(fieldKey, value) {
    const question = surveyQuestion(fieldKey);
    if (question) {
        switch (question.getType()) {
            case "radiogroup":
            case "dropdown":
            case "boolean":
            case "imagepicker":
                return Array.isArray(value) ? "multiple" : "categorical";
            case "checkbox":
            case "tagbox":
                return "multiple";
            case "rating":
                return "rating";
            case "text":
                return ["number", "range"].includes(question.inputType) ? "numerical" : null;
            default:
                return null;
        }
    }

    // Not in the current survey (e.g. an answer to an older version): guess from the value
    if (typeof value === "number") return "numerical";
    if (Array.isArray(value)) return "multiple";
    if (typeof value === "string" || typeof value === "boolean") return "categorical";
    return null;
}

// All values of a rating question's scale, so unused values show as 0
function ratingScale(fieldKey) {
    const question = surveyQuestion(fieldKey);
    if (!question) return [];
    if (question.rateValues && question.rateValues.length > 0) {
        return question.rateValues.map(item => String(item.value));
    }
    const scale = [];
    const step = question.rateStep > 0 ? question.rateStep : 1;
    for (let value = question.rateMin; value <= question.rateMax && scale.length < 100; value += step) {
        scale.push(String(value));
    }
    return scale;
}

// One distinct colour per category
function chartColors(count) {
    return Array.from({ length: count }, (_, i) => `hsl(${Math.round(i * 360 / count)}, 65%, 55%)`);
}

function showStartScreen() {
    startScreen.style.display = "flex";
    surveyContainer.style.display = "none";
    resultsContainer.style.display = "none";
    fieldSelectionContainer.style.display = "none";
    chartsContainer.style.display = "none";
}

function showSurvey() {
    startScreen.style.display = "none";
    surveyContainer.style.display = "block";
    resultsContainer.style.display = "none";
    fieldSelectionContainer.style.display = "none";
    chartsContainer.style.display = "none";
}

function showResults() {
    startScreen.style.display = "none";
    surveyContainer.style.display = "none";
    resultsContainer.style.display = "block";
    fieldSelectionContainer.style.display = "none";
    chartsContainer.style.display = "none";
}

function showFieldSelection() {
    startScreen.style.display = "none";
    surveyContainer.style.display = "none";
    resultsContainer.style.display = "none";
    fieldSelectionContainer.style.display = "block";
    chartsContainer.style.display = "none";
}

function showCharts() {
    startScreen.style.display = "none";
    surveyContainer.style.display = "none";
    resultsContainer.style.display = "none";
    fieldSelectionContainer.style.display = "none";
    chartsContainer.style.display = "block";
}

function renderSurvey(surveyJson) {
    const survey = new Survey.Model(surveyJson);
    currentSurvey = survey;

    survey.applyTheme(SurveyTheme.SharpLight);

    if (surveyContainer) {
        survey.render(surveyContainer);
    } else {
        console.error("Survey container not found");
    }

    survey.onComplete.add((result) => {
        pending = { id: newSubmissionId(), data: result.data };
        saveSubmissionState();
        sendPending();
    });
}

// djb2: a short, stable key for the configured survey
function hashString(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
}

// crypto.randomUUID needs a secure context, which a module origin may not be
function newSubmissionId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function storageKey(name) {
    return `survey.${surveyKey}.${name}`;
}

// localStorage can be unavailable (blocked site data): then the state lasts until reload
function loadSubmissionState() {
    try {
        pending = JSON.parse(Edrys.getItem(storageKey("pending")) || "null");
        submitted = Edrys.getItem(storageKey("submitted")) === "true";
    } catch (error) {
        console.warn("Could not read the submission state:", error);
    }
}

function saveSubmissionState() {
    try {
        Edrys.setItem(storageKey("pending"), pending ? JSON.stringify(pending) : "");
        Edrys.setItem(storageKey("submitted"), submitted ? "true" : "");
    } catch (error) {
        console.warn("Could not save the submission state:", error);
    }
}

// Send the pending answer; the station confirms with SUBJECT_STORED
function sendPending() {
    if (!pending) return;
    sendFailed = false;
    Edrys.sendMessage(SUBJECT_COMPLETED, { id: pending.id, data: pending.data });

    clearTimeout(ackTimer);
    ackTimer = setTimeout(() => {
        sendFailed = true;
        updateStartScreen();
    }, ACK_TIMEOUT);
    // The start screen shows how sending goes
    updateStartScreen();
    showStartScreen();
}

function confirmStored(id) {
    if (!pending || pending.id !== id) return;
    clearTimeout(ackTimer);
    pending = null;
    submitted = true;
    sendFailed = false;
    saveSubmissionState();
    updateStartScreen();
}

function setStartMessage(text, isError = false) {
    startMessage.textContent = text;
    startMessage.classList.toggle("error", isError);
}

// Start button, retry button and message from the submission state
function updateStartScreen() {
    if (!currentSurvey) return;

    const done = submitted && !allowRetake;
    startSurveyBtn.disabled = Boolean(pending) || done;
    startSurveyBtn.textContent = done ? "Submitted ✓" : "Start Survey";
    retryBtn.style.display = pending && sendFailed ? "block" : "none";

    if (pending && sendFailed) {
        setStartMessage("The station did not receive your answer.", true);
    } else if (pending) {
        setStartMessage("Sending your answer to the station…");
    } else if (submitted && allowRetake) {
        setStartMessage("Submitted ✓");
    } else {
        setStartMessage("");
    }
}

function analyzeResults(results) {
    if (!results || results.length === 0) return {};

    const analysis = {};

    results.filter(result => isAnswers(result.data)).forEach(result => {
        const data = result.data;

        Object.keys(data).forEach(questionKey => {
            const value = data[questionKey];
            const kind = chartKind(questionKey, value);
            if (!kind) return;

            if (!analysis[questionKey]) {
                analysis[questionKey] = {
                    type: kind,
                    values: [],
                    counts: {}
                };
            }
            const field = analysis[questionKey];
            // Mixed answers (e.g. after the survey changed): keep those of the first kind
            if (field.type !== kind) return;

            if (kind === 'numerical') {
                const number = Number(value);
                if (Number.isFinite(number)) field.values.push(number);
                return;
            }

            field.values.push(value);
            const items = Array.isArray(value) ? value : [value];
            items.forEach(item => {
                const key = String(item);
                field.counts[key] = (field.counts[key] || 0) + 1;
            });
        });
    });

    return analysis;
}

function createChart(containerId, questionKey, analysis) {
    const canvas = document.createElement('canvas');
    canvas.id = `chart-${questionKey}`;
    document.getElementById(containerId).appendChild(canvas);

    const ctx = canvas.getContext('2d');

    if (analysis.type === 'categorical') {
        // Create pie chart for single-choice answers
        const labels = Object.keys(analysis.counts);
        const data = Object.values(analysis.counts);

        const chart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: chartColors(labels.length),
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((context.parsed / total) * 100).toFixed(1);
                                return `${context.label}: ${context.parsed} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });

        activeCharts.push(chart);

    } else if (analysis.type === 'multiple') {
        // Bar per option, most chosen first (answers can pick several, so no pie)
        const options = Object.keys(analysis.counts).sort((a, b) => analysis.counts[b] - analysis.counts[a]);
        activeCharts.push(createBarChart(ctx, options, options.map(option => analysis.counts[option])));

    } else if (analysis.type === 'rating') {
        // Bar per value of the scale, unused values included
        const scale = ratingScale(questionKey);
        const extra = Object.keys(analysis.counts).filter(value => !scale.includes(value)).sort((a, b) => a - b);
        const labels = [...scale, ...extra];
        activeCharts.push(createBarChart(ctx, labels, labels.map(value => analysis.counts[value] || 0)));

    } else if (analysis.type === 'numerical') {
        // Create histogram for numerical data
        const values = analysis.values;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min;

        let bins = [];
        let binLabels = [];

        if (range === 0) {
            // All answers are equal: one bar
            bins = [values.length];
            binLabels = [String(min)];
        } else {
            const binCount = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(values.length))));
            const binSize = range / binCount;

            for (let i = 0; i < binCount; i++) {
                const binStart = min + i * binSize;
                const binEnd = min + (i + 1) * binSize;
                bins[i] = 0;
                binLabels[i] = `${binStart.toFixed(1)}-${binEnd.toFixed(1)}`;
            }

            values.forEach(value => {
                const binIndex = Math.min(Math.floor((value - min) / binSize), binCount - 1);
                bins[binIndex]++;
            });
        }

        activeCharts.push(createBarChart(ctx, binLabels, bins));
    }
}

function createBarChart(ctx, labels, data) {
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Responses',
                data: data,
                backgroundColor: '#36A2EB',
                borderColor: '#1E88E5',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}

function showFieldSelectionInterface() {
    if (!currentResults || currentResults.length === 0) {
        fieldSelectionContainer.innerHTML = '<button class="back-btn" data-action="show-results">← Back to Results</button><div class="no-charts">No data available for analysis.</div>';
        showFieldSelection();
        return;
    }

    // Analyze available fields
    availableFields = analyzeResults(currentResults);
    selectableFields = Object.keys(availableFields).filter(key => availableFields[key].values.length > 0);

    if (selectableFields.length === 0) {
        fieldSelectionContainer.innerHTML = '<button class="back-btn" data-action="show-results">← Back to Results</button><div class="no-charts">No chartable fields found in survey results.</div>';
        showFieldSelection();
        return;
    }

    let html = '<button class="back-btn" data-action="show-results">← Back to Results</button>';
    html += `
        <div class="field-selection-container">
            <h2>Select Fields for Chart Generation</h2>
            <p>Choose which survey fields you want to visualize. Charts will be automatically generated based on the data type of each field.</p>

            <div class="selection-actions">
                <button class="select-all-btn" data-action="select-all">Select All</button>
                <button class="select-none-btn" data-action="select-none">Select None</button>
            </div>

            <div class="field-list">
    `;

    selectableFields.forEach((fieldKey, index) => {
        const field = availableFields[fieldKey];
        const responseCount = field.values.length;
        let typeDescription = '';

        switch(field.type) {
            case 'categorical':
                const uniqueValues = Object.keys(field.counts).length;
                typeDescription = `Categorical (${uniqueValues} unique values)`;
                break;
            case 'numerical':
                const min = Math.min(...field.values);
                const max = Math.max(...field.values);
                typeDescription = `Numerical (${min} - ${max})`;
                break;
            case 'multiple':
                const totalOptions = Object.keys(field.counts).length;
                typeDescription = `Multiple Choice (${totalOptions} options)`;
                break;
            case 'rating':
                const scale = ratingScale(fieldKey);
                typeDescription = scale.length > 0 ? `Rating (${scale[0]} - ${scale[scale.length - 1]})` : 'Rating';
                break;
        }

        html += `
            <div class="field-item">
                <input type="checkbox" id="field-${index}" value="${index}" checked>
                <label for="field-${index}">${escapeHtml(fieldTitle(fieldKey))}</label>
                <div class="field-info">${escapeHtml(typeDescription)} • ${responseCount} responses</div>
            </div>
        `;
    });

    html += `
            </div>
            <p class="selection-error" role="alert"></p>
            <button class="generate-selected-charts-btn" data-action="generate-selected">
                Generate Charts for Selected Fields
            </button>
        </div>
    `;

    fieldSelectionContainer.innerHTML = html;
    showFieldSelection();
}

function selectAllFields(selectAll) {
    const checkboxes = fieldSelectionContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAll;
    });
}

function generateSelectedCharts() {
    const selectedFields = [];
    const checkboxes = fieldSelectionContainer.querySelectorAll('input[type="checkbox"]:checked');

    checkboxes.forEach(checkbox => {
        selectedFields.push(selectableFields[Number(checkbox.value)]);
    });

    if (selectedFields.length === 0) {
        fieldSelectionContainer.querySelector(".selection-error").textContent = "Select at least one field to generate charts.";
        return;
    }

    generateChartsForFields(selectedFields);
}

function generateChartsForFields(selectedFields) {
    // Destroy existing charts
    activeCharts.forEach(chart => chart.destroy());
    activeCharts = [];

    let html = '<button class="back-btn" data-action="show-field-selection">← Back to Field Selection</button>';
    html += '<h2>Survey Results Charts</h2>';
    html += `<p style="text-align: center; color: #ecf0f1; margin-bottom: 20px;">Generated from ${currentResults.length} responses • ${selectedFields.length} fields selected</p>`;

    selectedFields.forEach((fieldKey, index) => {
        html += `
            <div class="chart-container">
                <h3>${escapeHtml(fieldTitle(fieldKey))}</h3>
                <div class="chart-wrapper">
                    <div id="chart-container-${index}"></div>
                </div>
            </div>
        `;
    });

    chartsContainer.innerHTML = html;
    showCharts();

    // Create charts after DOM is updated
    setTimeout(() => {
        selectedFields.forEach((fieldKey, index) => {
            const questionAnalysis = availableFields[fieldKey];
            if (questionAnalysis) {
                createChart(`chart-container-${index}`, fieldKey, questionAnalysis);
            }
        });
    }, 100);
}

function displayResultsPage(page = 1) {
    const totalResults = currentResults.length;
    const totalPages = Math.ceil(totalResults / RESULTS_PER_PAGE);
    const startIndex = (page - 1) * RESULTS_PER_PAGE;
    const endIndex = Math.min(startIndex + RESULTS_PER_PAGE, totalResults);
    const pageResults = currentResults.slice(startIndex, endIndex);

    let html = '<button class="back-btn" data-action="show-start">← Back</button>';

    // Add Generate Charts button if there are results
    if (totalResults > 0) {
        html += '<button class="generate-charts-btn" data-action="field-selection">📊 Generate Charts</button>';
    }

    html += '<h2>Survey Results</h2>';
    html += `<p style="text-align: center; color: #ecf0f1; margin-bottom: 20px;">Classroom: ${escapeHtml(Edrys.class_id)}</p>`;

    if (totalResults === 0) {
        html += '<div class="no-results">No survey results found for this classroom.</div>';
    } else {
        // Pagination info
        html += `<div class="pagination-info">Showing ${startIndex + 1}-${endIndex} of ${totalResults} results (Page ${page} of ${totalPages})</div>`;

        // Results list
        html += '<div class="results-list">';
        pageResults.forEach((result, index) => {
            const globalIndex = startIndex + index + 1;
            html += `
                <div class="result-item">
                    <h3>Response ${globalIndex}</h3>
                    <p><strong>Timestamp:</strong> ${escapeHtml(new Date(result.timestamp).toLocaleString())}</p>
                    <p><strong>ID:</strong> ${escapeHtml(result.id)}</p>
                    <details>
                        <summary>View Result Data</summary>
                        <pre>${escapeHtml(JSON.stringify(result.data, null, 2))}</pre>
                    </details>
                </div>
            `;
        });
        html += '</div>';

        // Pagination controls
        if (totalPages > 1) {
            html += '<div class="pagination-controls">';

            // Previous button
            if (page > 1) {
                html += `<button class="pagination-btn" data-action="page" data-page="${page - 1}">‹ Previous</button>`;
            }

            // Page numbers
            html += '<div class="page-numbers">';
            for (let i = 1; i <= totalPages; i++) {
                if (i === page) {
                    html += `<button class="pagination-btn active">${i}</button>`;
                } else {
                    html += `<button class="pagination-btn" data-action="page" data-page="${i}">${i}</button>`;
                }
            }
            html += '</div>';

            // Next button
            if (page < totalPages) {
                html += `<button class="pagination-btn" data-action="page" data-page="${page + 1}">Next ›</button>`;
            }

            html += '</div>';
        }
    }

    resultsContainer.innerHTML = html;
    showResults();
}

function goToPage(page) {
    currentPage = page;
    displayResultsPage(page);
}

async function loadAndDisplayResults() {
    try {
        const currentClassroomId = Edrys.class_id;
        const results = await db.results
            .where('classroomId')
            .equals(currentClassroomId)
            .toArray();

        currentResults = results;

        // Sort by timestamp in descending order (newest first)
        results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Reset to first page and display
        currentPage = 1;
        displayResultsPage(1);

    } catch (error) {
        console.error("Error loading results:", error);
        resultsContainer.innerHTML = '<button class="back-btn" data-action="show-start">← Back</button><div class="no-results">Error loading results.</div>';
        showResults();
    }
}

// The survey JSON from the station settings: a JSON string (settings form) or
// an already parsed object (YAML in the config editor). null if not set.
function readSurveyConfig() {
    const survey = (Edrys.module.stationConfig || {}).survey;
    if (!survey) return null;
    return typeof survey === "string" ? JSON.parse(survey) : survey;
}

// Event listeners (the start button is only enabled once a survey is rendered)
startSurveyBtn.addEventListener('click', () => {
    // With allowRetake, start a fresh copy of the completed survey
    if (currentSurvey.state === "completed") {
        currentSurvey.clear(true, true);
    }
    showSurvey();
});

retryBtn.addEventListener('click', sendPending);

loadResultsBtn.addEventListener('click', loadAndDisplayResults);

// Buttons rendered into the result, field selection and chart views
const actions = {
    "show-start": showStartScreen,
    "show-results": showResults,
    "show-field-selection": showFieldSelection,
    "field-selection": showFieldSelectionInterface,
    "select-all": () => selectAllFields(true),
    "select-none": () => selectAllFields(false),
    "generate-selected": generateSelectedCharts,
    "page": (button) => goToPage(Number(button.dataset.page))
};

document.body.addEventListener('click', (event) => {
    const button = event.target.closest("[data-action]");
    if (button && actions[button.dataset.action]) {
        actions[button.dataset.action](button);
    }
});


Edrys.onReady(() => {
    /*const dbg = Edrys.importDebug();
    Edrys.debug = false;
    dbg('Survey Module Ready');*/
    console.log("Survey module is ready");

    // Show load results button only for station role
    if (Edrys.role === "station") {
        loadResultsBtn.style.display = "block";
    }

    const stationConfig = Edrys.module.stationConfig || {};
    allowRetake = stationConfig.allowRetake === true;

    let surveyConfig;
    try {
        surveyConfig = readSurveyConfig();
    } catch (error) {
        console.error("Error parsing survey configuration:", error);
        startSurveyBtn.textContent = "Survey Configuration Error";
        setStartMessage(`The "survey" station setting is not valid JSON: ${error.message}`, true);
        return;
    }

    if (!surveyConfig) {
        startSurveyBtn.textContent = "No Survey Configuration";
        setStartMessage('Add a SurveyJS JSON as "survey" in the module\'s station settings.', true);
        return;
    }

    try {
        surveyKey = hashString(JSON.stringify(surveyConfig));
        renderSurvey(surveyConfig);
    } catch (error) {
        console.error("Error rendering survey:", error);
        startSurveyBtn.textContent = "Survey Configuration Error";
        setStartMessage(`The survey could not be shown: ${error.message}`, true);
        return;
    }

    loadSubmissionState();
    updateStartScreen();
    // An answer that was never confirmed (e.g. the page was closed): send it again
    if (pending) sendPending();
});

Edrys.onMessage(({ from, subject, body }) => {
    if (subject === SUBJECT_STORED) {
        if (body && typeof body.id === "string") confirmStored(body.id);
    } else if (subject === SUBJECT_COMPLETED && Edrys.role === "station") {
        // Only store survey results in a station
        storeResult(from, body);
    }
});

async function storeResult(from, body) {
    // Any peer can send this subject: keep only well-formed results
    if (!isAnswers(body?.data)) {
        console.warn("Ignoring malformed survey result from", from, body);
        return;
    }

    const username = from.split('_')[0];
    const stationName = Edrys.liveUser.room;
    const classroomId = Edrys.class_id;
    // A retry resends the same id, so put() keeps one copy. Senders without an id
    // (older module versions) get a new entry per message.
    const hasId = typeof body.id === "string";
    const id = hasId ? `${username}-${body.id}` : `${username}-${stationName}-${Date.now()}`;

    try {
        await db.results.put({
            id: id,
            timestamp: new Date(),
            data: body.data,
            classroomId: classroomId
        });
        if (hasId) Edrys.sendMessage(SUBJECT_STORED, { id: body.id }, from);
    } catch (error) {
        console.error("Error saving survey result:", error);
    }
}
