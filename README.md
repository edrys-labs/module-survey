# Edrys Survey Module

A survey module for edrys-lite that enables interactive data collection, storage, and visualization within classroom environments.

Import the module via:

`https://edrys-labs.github.io/module-survey/index.html`

## Features

- **Interactive Surveys**: Render dynamic surveys using [SurveyJS](https://surveyjs.io/) 
- **Data Storage**: Automatic storage of survey responses in IndexedDB (only in the station)
- **Results Management**: View and browse survey results with pagination
- **Data Visualization**: Generate interactive charts (pie charts, histograms) from survey data
- **Role-Based Access**: Only station users can view results and generate charts, all users can take surveys
- **Chart Generation**: Automatic analysis of survey fields with support for categorical, numerical, and multiple-choice data

## Usage

1. **Taking Surveys**: Click "Start Survey" to begin the configured survey
2. **Viewing Results**: Station users can click "Load Survey Results" to view responses
3. **Generating Charts**: From the results view, click "📊 Generate Charts" to visualize data
4. **Navigation**: Use pagination controls to browse through multiple result pages

## Configuration

The module expects survey configuration in `Edrys.module.stationConfig.survey` as a JSON string containing valid SurveyJS configuration.

* __Example:__

  ```` yaml
  survey: |
    {
        "title": "Student Feedback",
        "pages": [
        {
            "name": "page1",
            "elements": [
            { "type": "text", "name": "name", "title": "Your Name:" },
            { "type": "rating", "name": "experience", "title": "Rate your experience", "rateMax": 5 },
            { "type": "comment", "name": "suggestions", "title": "Any suggestions?" }
            ]
        }
        ]
    }
  ````

For more details on SurveyJS configuration, refer to the [SurveyJS documentation](https://surveyjs.io/form-library/documentation/get-started-html-css-javascript).

## Dependencies

- SurveyJS (Core and UI)
- Chart.js for data visualization
- Dexie.js for IndexedDB management
- Edrys.js for module integration

## Data Storage

Survey results are stored locally in IndexedDB and filtered by classroom ID to ensure data isolation between different classes.