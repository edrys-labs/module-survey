const surveyContainer = document.getElementById("surveyContainer");
const startScreen = document.getElementById("startScreen");
const resultsContainer = document.getElementById("resultsContainer");
const fieldSelectionContainer = document.getElementById("fieldSelectionContainer");
const chartsContainer = document.getElementById("chartsContainer");
const startSurveyBtn = document.getElementById("startSurveyBtn");
const loadResultsBtn = document.getElementById("loadResultsBtn");

const db = new Dexie("edrysSurveyDB");
db.version(1).stores({
    results: "id, timestamp, data, classroomId"
});

let currentSurvey = null;
let currentResults = [];
let activeCharts = [];
let availableFields = {};
let currentPage = 1;
const resultsPerPage = 10;

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
        Edrys.sendMessage("surveyCompleted", {
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
    
    results.forEach(result => {
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
        fieldSelectionContainer.innerHTML = '<button class="back-btn" onclick="showResults()">← Back to Results</button><div class="no-charts">No data available for analysis.</div>';
        showFieldSelection();
        return;
    }
    
    // Analyze available fields
    availableFields = analyzeResults(currentResults);
    const fieldKeys = Object.keys(availableFields).filter(key => availableFields[key].type !== 'unknown');
    
    if (fieldKeys.length === 0) {
        fieldSelectionContainer.innerHTML = '<button class="back-btn" onclick="showResults()">← Back to Results</button><div class="no-charts">No chartable fields found in survey results.</div>';
        showFieldSelection();
        return;
    }
    
    let html = '<button class="back-btn" onclick="showResults()">← Back to Results</button>';
    html += `
        <div class="field-selection-container">
            <h2>Select Fields for Chart Generation</h2>
            <p>Choose which survey fields you want to visualize. Charts will be automatically generated based on the data type of each field.</p>
            
            <div class="selection-actions">
                <button class="select-all-btn" onclick="selectAllFields(true)">Select All</button>
                <button class="select-none-btn" onclick="selectAllFields(false)">Select None</button>
            </div>
            
            <div class="field-list">
    `;
    
    fieldKeys.forEach(fieldKey => {
        const field = availableFields[fieldKey];
        const fieldName = fieldKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
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
                <input type="checkbox" id="field-${fieldKey}" value="${fieldKey}" checked>
                <label for="field-${fieldKey}">${fieldName}</label>
                <div class="field-info">${typeDescription} • ${responseCount} responses</div>
            </div>
        `;
    });
    
    html += `
            </div>
            <button class="generate-selected-charts-btn" onclick="generateSelectedCharts()">
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
        selectedFields.push(checkbox.value);
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
    
    let html = '<button class="back-btn" onclick="showFieldSelection()">← Back to Field Selection</button>';
    html += '<h2>Survey Results Charts</h2>';
    html += `<p style="text-align: center; color: #ecf0f1; margin-bottom: 20px;">Generated from ${currentResults.length} responses • ${selectedFields.length} fields selected</p>`;
    
    selectedFields.forEach(fieldKey => {
        const fieldName = fieldKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        html += `
            <div class="chart-container">
                <h3>${fieldName}</h3>
                <div class="chart-wrapper">
                    <div id="chart-container-${fieldKey}"></div>
                </div>
            </div>
        `;
    });
    
    chartsContainer.innerHTML = html;
    showCharts();
    
    // Create charts after DOM is updated
    setTimeout(() => {
        selectedFields.forEach(fieldKey => {
            const questionAnalysis = availableFields[fieldKey];
            if (questionAnalysis && questionAnalysis.type !== 'unknown') {
                createChart(`chart-container-${fieldKey}`, fieldKey, questionAnalysis);
            }
        });
    }, 100);
}

function displayResultsPage(page = 1) {
    const totalResults = currentResults.length;
    const totalPages = Math.ceil(totalResults / resultsPerPage);
    const startIndex = (page - 1) * resultsPerPage;
    const endIndex = Math.min(startIndex + resultsPerPage, totalResults);
    const pageResults = currentResults.slice(startIndex, endIndex);
    
    let html = '<button class="back-btn" onclick="showStartScreen()">← Back</button>';
    
    // Add Generate Charts button if there are results
    if (totalResults > 0) {
        html += '<button class="generate-charts-btn" onclick="showFieldSelectionInterface()">📊 Generate Charts</button>';
    }
    
    html += '<h2>Survey Results</h2>';
    html += `<p style="text-align: center; color: #ecf0f1; margin-bottom: 20px;">Classroom: ${Edrys.class_id}</p>`;
    
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
                    <p><strong>Timestamp:</strong> ${new Date(result.timestamp).toLocaleString()}</p>
                    <p><strong>ID:</strong> ${result.id}</p>
                    <details>
                        <summary>View Result Data</summary>
                        <pre>${JSON.stringify(result.data, null, 2)}</pre>
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
                html += `<button class="pagination-btn" onclick="goToPage(${page - 1})">‹ Previous</button>`;
            }
            
            // Page numbers
            html += '<div class="page-numbers">';
            for (let i = 1; i <= totalPages; i++) {
                if (i === page) {
                    html += `<button class="pagination-btn active">${i}</button>`;
                } else {
                    html += `<button class="pagination-btn" onclick="goToPage(${i})">${i}</button>`;
                }
            }
            html += '</div>';
            
            // Next button
            if (page < totalPages) {
                html += `<button class="pagination-btn" onclick="goToPage(${page + 1})">Next ›</button>`;
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
        resultsContainer.innerHTML = '<button class="back-btn" onclick="showStartScreen()">← Back</button><div class="no-results">Error loading results.</div>';
        showResults();
    }
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

// Make functions globally available for HTML onclick handlers
window.showStartScreen = showStartScreen;
window.showResults = showResults;
window.showFieldSelection = showFieldSelection;
window.showCharts = showCharts;
window.showFieldSelectionInterface = showFieldSelectionInterface;
window.selectAllFields = selectAllFields;
window.generateSelectedCharts = generateSelectedCharts;
window.goToPage = goToPage;


Edrys.onReady(() => {
    const debug = Edrys.importDebug();
    Edrys.enableModuleDebug();
    //Edrys.disableModuleDebug();
    debug('Survey Module Ready');

    // Show load results button only for station role
    if (Edrys.role === "station") {
        loadResultsBtn.style.display = "block";
    }

    if (Edrys.module.stationConfig.survey) {
        try {
            const surveyConfig = JSON.parse(Edrys.module.stationConfig.survey);
            renderSurvey(surveyConfig);
        } catch (error) {
            console.error("Error parsing survey configuration:", error);
            startSurveyBtn.disabled = true;
            startSurveyBtn.textContent = "Survey Configuration Error";
        }
    } else {
        startSurveyBtn.disabled = true;
        startSurveyBtn.textContent = "No Survey Configuration";
    }
});

Edrys.onMessage(async ({ from, subject, body }) => {
    // Only store survey results in a station
    if (subject === "surveyCompleted" && Edrys.role === "station") {
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
    }
});