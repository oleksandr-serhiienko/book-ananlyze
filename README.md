# Book Sentence Processor

A modular book sentence processing application that uses AI to translate and analyze text, organized according to the Single Responsibility Principle.

## Architecture

The application has been refactored into separate modules, each with a single responsibility:

### Core Modules

- **`config.js`** - Configuration constants and settings
- **`textProcessor.js`** - Text file reading, chapter extraction, and response parsing
- **`sqlGenerator.js`** - SQL schema creation and INSERT statement generation
- **`modelClient.js`** - Vertex AI model interaction and API communication
- **`sentenceProcessor.js`** - Main coordinator class that orchestrates all modules

### User Interface

- **`index.html`** - Web UI for processing control and monitoring
- **`styles.css`** - Modern, responsive styling
- **`app.js`** - Frontend JavaScript for UI interaction and progress tracking

## Features

### Backend Processing
- ✅ Batch processing of text lines
- ✅ Retry logic with configurable attempts
- ✅ Progress saving and error logging
- ✅ SQL generation for database storage
- ✅ Modular architecture for easy maintenance

### Web UI
- ✅ Real-time processing status and progress
- ✅ Interactive controls (start, stop, configure)
- ✅ Live logging and error tracking
- ✅ Results summary with success/failure rates
- ✅ SQL file download capability
- ✅ Responsive design for all screen sizes

## Usage

### Command Line
```bash
# Run the processor directly
npm start

# Or run with Node.js
node sentenceProcessor.js
```

### Web Interface
```bash
# Start the web server
npm run serve

# Then open http://localhost:3000 in your browser
```

### Programmatic Usage
```javascript
const SentenceProcessor = require('./sentenceProcessor');

const processor = new SentenceProcessor();

// Process with default settings
const result = await processor.processFile();

// Process with custom settings
const result = await processor.processFile('/path/to/file.txt', 20);

// Stop processing
processor.stop();
```

## Configuration

All configuration is centralized in `config.js`:

```javascript
module.exports = {
    MAX_RETRIES_SENTENCE: 3,
    BATCH_SIZE: 10,
    TEXT_FILE_PATH: "C:\\Path\\To\\Your\\File.txt",
    // ... other settings
};
```

## Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `config.js` | Application configuration |
| `textProcessor.js` | Text parsing and response handling |
| `sqlGenerator.js` | Database schema and SQL generation |
| `modelClient.js` | AI model communication |
| `sentenceProcessor.js` | Process coordination |
| Web UI | User interaction and monitoring |

## Dependencies

- `@google-cloud/vertexai` - AI model integration
- `fs` - File system operations (built-in)
- `http` - Web server (built-in)

## File Structure

```
book-ananlyze/
├── config.js              # Configuration module
├── textProcessor.js        # Text processing logic
├── sqlGenerator.js         # SQL generation logic  
├── modelClient.js          # AI model client
├── sentenceProcessor.js    # Main coordinator
├── index.html             # Web UI
├── styles.css             # UI styling
├── app.js                 # Frontend logic
└── package.json           # Project configuration
```

This refactored architecture follows the Single Responsibility Principle, making the code more maintainable, testable, and scalable.