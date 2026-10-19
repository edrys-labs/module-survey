const surveyContainer = document.getElementById("surveyContainer");
const startScreen = document.getElementById("startScreen");
const resultsContainer = document.getElementById("resultsContainer");
const fieldSelectionContainer = document.getElementById("fieldSelectionContainer");
const chartsContainer = document.getElementById("chartsContainer");
const startSurveyBtn = document.getElementById("startSurveyBtn");
const loadResultsBtn = document.getElementById("loadResultsBtn");

// Message other peers send when they complete the survey: { data: <SurveyJS result> }
const SUBJECT_COMPLETED = "surveyCompleted";
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

function fieldTitle(fieldKey) {
    return fieldKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
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
        Edrys.sendMessage(SUBJECT_COMPLETED, {
            data: result.data
        });

        // Show completion message and return to start screen
        setTimeout(() => {
            showStartScreen();
        }, 3000);
    });
}

function analyzeResults(results) {
    if (!results || results.length === 0) return {};

    const analysis = {};

    results.filter(result => isAnswers(result.data)).forEach(result => {
        const data = result.data;

        Object.keys(data).forEach(questionKey => {
            if (!analysis[questionKey]) {
                analysis[questionKey] = {
                    type: 'unknown',
                    values: [],
                    counts: {}
                };
            }

            const value = data[questionKey];
            analysis[questionKey].values.push(value);

            // Determine question type and count responses
            if (typeof value === 'string' || typeof value === 'boolean') {
                analysis[questionKey].type = 'categorical';
                const key = String(value);
                analysis[questionKey].counts[key] = (analysis[questionKey].counts[key] || 0) + 1;
            } else if (typeof value === 'number') {
                analysis[questionKey].type = 'numerical';
            } else if (Array.isArray(value)) {
                analysis[questionKey].type = 'multiple';
                value.forEach(item => {
                    const key = String(item);
                    analysis[questionKey].counts[key] = (analysis[questionKey].counts[key] || 0) + 1;
                });
            }
        });
    });

    return analysis;
}

function createChart(containerId, questionKey, analysis) {
    const canvas = document.createElement('canvas');
    canvas.id = `chart-${questionKey}`;
    document.getElementById(containerId).appendChild(canvas);

    const ctx = canvas.getContext('2d');

    if (analysis.type === 'categorical' || analysis.type === 'multiple') {
        // Create pie chart for categorical data
        const labels = Object.keys(analysis.counts);
        const data = Object.values(analysis.counts);
        const colors = [
            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
            '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF'
        ];

        const chart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.slice(0, labels.length),
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

    } else if (analysis.type === 'numerical') {
        // Create histogram for numerical data
        const values = analysis.values;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min;
        const binCount = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(values.length))));
        const binSize = range / binCount;

        const bins = [];
        const binLabels = [];

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

        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: binLabels,
                datasets: [{
                    label: 'Frequency',
                    data: bins,
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

        activeCharts.push(chart);
    }
}

function showFieldSelectionInterface() {
    if (!currentResults || currentResults.length === 0) {
        fieldSelectionContainer.innerHTML = '<button class="back-btn" data-action="show-results">← Back to Results</button><div class="no-charts">No data available for analysis.</div>';
        showFieldSelection();
        return;
    }

    // Analyze available fields
    availableFields = analyzeResults(currentResults);
    selectableFields = Object.keys(availableFields).filter(key => availableFields[key].type !== 'unknown');

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
        alert('Please select at least one field to generate charts.');
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
            if (questionAnalysis && questionAnalysis.type !== 'unknown') {
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

// Event listeners
startSurveyBtn.addEventListener('click', () => {
    if (currentSurvey) {
        showSurvey();
    } else {
        alert('No survey configuration found. Please check the module configuration.');
    }
});

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

    try {
        const surveyConfig = readSurveyConfig();
        if (surveyConfig) {
            renderSurvey(surveyConfig);
        } else {
            startSurveyBtn.disabled = true;
            startSurveyBtn.textContent = "No Survey Configuration";
        }
    } catch (error) {
        console.error("Error parsing survey configuration:", error);
        startSurveyBtn.disabled = true;
        startSurveyBtn.textContent = "Survey Configuration Error";
    }
});

Edrys.onMessage(async ({ from, subject, body }) => {
    // Only store survey results in a station
    if (subject !== SUBJECT_COMPLETED || Edrys.role !== "station") return;

    // Any peer can send this subject: keep only well-formed results
    if (!isAnswers(body?.data)) {
        console.warn("Ignoring malformed survey result from", from, body);
        return;
    }

    const username = from.split('_')[0];
    const stationName = Edrys.liveUser.room;
    const classroomId = Edrys.class_id;

    try {
        await db.results.add({
            id: `${username}-${stationName}-${Date.now()}`,
            timestamp: new Date(),
            data: body.data,
            classroomId: classroomId
        });
    } catch (error) {
        console.error("Error saving survey result:", error);
    }
});
