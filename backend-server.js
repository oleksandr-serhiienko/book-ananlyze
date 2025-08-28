#!/usr/bin/env node
import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// Import config as ES module
import config from './config.js';

// User settings management
const USER_SETTINGS_FILE = './userSettings.json';

function loadUserSettings() {
    try {
        if (fs.existsSync(USER_SETTINGS_FILE)) {
            const settingsData = fs.readFileSync(USER_SETTINGS_FILE, 'utf8');
            return JSON.parse(settingsData);
        }
    } catch (error) {
        console.log('Error loading user settings:', error.message);
    }
    // Return default structure if file doesn't exist or has errors
    return {
        sentenceProcessing: {
            projectId: "",
            location: "",
            modelEndpoint: "",
            rollbackModels: [],
            sourceLanguage: "",
            targetLanguage: "",
            textFilePath: "",
            databasePath: ""
        },
        wordProcessing: {
            projectId: "",
            location: "",
            modelEndpoint: "",
            rollbackModels: [],
            sourceLanguage: "",
            targetLanguage: "",
            textFilePath: "",
            databasePath: ""
        },
        epubProcessing: {
            projectId: "",
            location: "",
            modelEndpoint: "",
            rollbackModels: [],
            sourceLanguage: "",
            targetLanguage: "",
            epubFilePath: ""
        }
    };
}

function saveUserSettings(settings) {
    try {
        fs.writeFileSync(USER_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    } catch (error) {
        console.log('Error saving user settings:', error.message);
    }
}

// Dynamic imports for modules that need to be loaded
let TextProcessor, ModelClient, SQLGenerator, WordProcessor, EPUBReader;

// Load modules dynamically
try {
    const textProcessorModule = await import('./textProcessor.js');
    TextProcessor = textProcessorModule.default;
    
    const modelClientModule = await import('./modelClient.js');
    ModelClient = modelClientModule.default;
    
    const sqlGeneratorModule = await import('./sqlGenerator.js');
    SQLGenerator = sqlGeneratorModule.default;

    const wordProcessorModule = await import('./wordProcessor.js');
    WordProcessor = wordProcessorModule.default;

    const bookProcessorModule = await import('./bookProcessor.js');
    EPUBReader = bookProcessorModule.default;
} catch (error) {
    console.error('Failed to load modules:', error);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3005;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Global state for tracking processing
let processingState = {
    isRunning: false,
    logs: [],
    totalLines: 0,
    totalChapters: 0,
    processedLines: 0,
    successfulLines: 0,
    failedLines: 0,
    currentProcess: null,
    jobName: null,
    status: 'idle'
};

// Global state for word processing
let wordProcessingState = {
    isRunning: false,
    logs: [],
    totalWords: 0,
    newWords: 0,
    processedWords: 0,
    successfulWords: 0,
    failedWords: 0,
    currentWordProcessor: null,
    status: 'idle'
};

// Global state for sentence batch processing
let sentenceBatchState = {
    isRunning: false,
    logs: [],
    totalLines: 0,
    processedLines: 0,
    successfulLines: 0,
    failedLines: 0,
    currentBatchProcessor: null,
    status: 'idle'
};

// Global state for EPUB processing
let epubProcessingState = {
    isRunning: false,
    logs: [],
    extractedText: '',
    chapterCount: 0,
    status: 'idle'
};

function addLog(message, type = 'info', error = null) {
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] ${message}`;
    
    // Add detailed error information if provided
    if (error && type === 'error') {
        logEntry += `\n  Error Details: ${error.message}`;
        if (error.code) logEntry += `\n  Error Code: ${error.code}`;
        if (error.errno) logEntry += `\n  Error Number: ${error.errno}`;
        if (error.path) logEntry += `\n  File Path: ${error.path}`;
        if (error.stack) {
            const stackLines = error.stack.split('\n').slice(1, 4); // First 3 stack frames
            logEntry += `\n  Stack Trace:\n    ${stackLines.join('\n    ')}`;
        }
    }
    
    processingState.logs.push(logEntry);
    console.log(`${type.toUpperCase()}: ${logEntry}`);
}

function addEpubLog(message, type = 'info', error = null) {
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] ${message}`;
    
    // Add detailed error information if provided
    if (error && type === 'error') {
        logEntry += `\n  Error Details: ${error.message}`;
        if (error.code) logEntry += `\n  Error Code: ${error.code}`;
        if (error.errno) logEntry += `\n  Error Number: ${error.errno}`;
        if (error.path) logEntry += `\n  File Path: ${error.path}`;
        if (error.stack) {
            const stackLines = error.stack.split('\n').slice(1, 4); // First 3 stack frames
            logEntry += `\n  Stack Trace:\n    ${stackLines.join('\n    ')}`;
        }
    }
    
    epubProcessingState.logs.push(logEntry);
    console.log(`EPUB ${type.toUpperCase()}: ${logEntry}`);
}

function resetProcessingState() {
    processingState = {
        isRunning: false,
        logs: [],
        totalLines: 0,
        totalChapters: 0,
        processedLines: 0,
        successfulLines: 0,
        failedLines: 0,
        currentProcess: null,
        jobName: null,
        status: 'idle'
    };
}

function addWordLog(message, type = 'info', error = null) {
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] ${message}`;
    
    // Add detailed error information if provided
    if (error && type === 'error') {
        logEntry += `\n  Error Details: ${error.message}`;
        if (error.code) logEntry += `\n  Error Code: ${error.code}`;
        if (error.errno) logEntry += `\n  Error Number: ${error.errno}`;
        if (error.path) logEntry += `\n  File Path: ${error.path}`;
        if (error.stack) {
            const stackLines = error.stack.split('\n').slice(1, 4); // First 3 stack frames
            logEntry += `\n  Stack Trace:\n    ${stackLines.join('\n    ')}`;
        }
    }
    
    wordProcessingState.logs.push(logEntry);
    console.log(`WORD ${type.toUpperCase()}: ${logEntry}`);
}

function addBatchLog(message, type = 'info', error = null) {
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] ${message}`;
    
    // Add detailed error information if provided
    if (error && type === 'error') {
        logEntry += `\n  Error Details: ${error.message}`;
        if (error.code) logEntry += `\n  Error Code: ${error.code}`;
        if (error.errno) logEntry += `\n  Error Number: ${error.errno}`;
        if (error.path) logEntry += `\n  File Path: ${error.path}`;
        if (error.stack) {
            const stackLines = error.stack.split('\n').slice(1, 4); // First 3 stack frames
            logEntry += `\n  Stack Trace:\n    ${stackLines.join('\n    ')}`;
        }
    }
    
    sentenceBatchState.logs.push(logEntry);
    console.log(`BATCH ${type.toUpperCase()}: ${logEntry}`);
}

function resetBatchProcessingState() {
    sentenceBatchState = {
        isRunning: false,
        logs: [],
        totalLines: 0,
        processedLines: 0,
        successfulLines: 0,
        failedLines: 0,
        currentBatchProcessor: null,
        status: 'idle'
    };
}

function resetWordProcessingState() {
    wordProcessingState = {
        isRunning: false,
        logs: [],
        totalWords: 0,
        newWords: 0,
        processedWords: 0,
        successfulWords: 0,
        failedWords: 0,
        currentWordProcessor: null,
        status: 'idle'
    };
}

// Initialize AI processing components
let textProcessor;
let modelClient;
let sqlGenerator;

try {
    textProcessor = new TextProcessor();
    modelClient = new ModelClient(config);
    sqlGenerator = new SQLGenerator();
    addLog('AI processing components initialized successfully');
} catch (error) {
    addLog('Failed to initialize AI components', 'error', error);
}

// API Routes

// Start sentence-by-sentence processing
app.post('/api/process/start', async (req, res) => {
    try {
        const { filePath, aiConfig, translationConfig } = req.body;

        if (!filePath) {
            const error = new Error('File path is required');
            error.code = 'MISSING_FILE_PATH';
            addLog('Failed to start processing: File path is required', 'error', error);
            return res.status(400).json({ 
                error: 'File path is required',
                details: 'No file path provided in request body'
            });
        }

        if (!fs.existsSync(filePath)) {
            const error = new Error(`File not found: ${filePath}`);
            error.code = 'ENOENT';
            error.path = filePath;
            addLog(`Failed to start processing: File not found`, 'error', error);
            return res.status(400).json({ 
                error: 'File not found',
                details: `The file "${filePath}" does not exist`,
                path: filePath
            });
        }

        if (processingState.isRunning) {
            addLog('Processing request rejected: Already in progress', 'error');
            return res.status(409).json({ 
                error: 'Processing already in progress',
                details: `Current status: ${processingState.status}`
            });
        }

        resetProcessingState();
        processingState.isRunning = true;
        processingState.status = 'processing';

        // Save file path for future use
        const userSettings = loadUserSettings();
        userSettings.sentenceProcessing.textFilePath = filePath;
        saveUserSettings(userSettings);

        addLog(`Starting sentence processing: ${filePath}`);
        
        // Update AI configuration if provided
        if (aiConfig) {
            addLog(`Using custom AI config - Project: ${aiConfig.projectId}, Location: ${aiConfig.location}`);
            addLog(`Model endpoint: ${aiConfig.modelEndpoint}`);
            
            // Save the settings for future use
            const userSettings = loadUserSettings();
            userSettings.sentenceProcessing.projectId = aiConfig.projectId || config.PROJECT_ID;
            userSettings.sentenceProcessing.location = aiConfig.location || config.LOCATION;
            userSettings.sentenceProcessing.modelEndpoint = aiConfig.modelEndpoint || config.MODEL_ENDPOINT;
            if (aiConfig.rollbackModels && Array.isArray(aiConfig.rollbackModels)) {
                userSettings.sentenceProcessing.rollbackModels = aiConfig.rollbackModels.slice(0, 3); // Max 3 rollback models
            }
            saveUserSettings(userSettings);
            
            // Create new ModelClient with custom config
            const customConfig = {
                ...config,
                PROJECT_ID: aiConfig.projectId || config.PROJECT_ID,
                LOCATION: aiConfig.location || config.LOCATION,
                MODEL_ENDPOINT: aiConfig.modelEndpoint || config.MODEL_ENDPOINT,
                ROLLBACK_MODELS: aiConfig.rollbackModels ? aiConfig.rollbackModels.slice(0, 3) : []
            };
            
            try {
                modelClient = new ModelClient(customConfig);
                addLog('AI client updated with custom configuration');
            } catch (error) {
                addLog('Failed to update AI client with custom config, using default', 'error', error);
            }
        } else {
            addLog('Using default AI configuration from config.js');
        }

        // Update translation configuration if provided
        if (translationConfig) {
            const sourceLanguage = translationConfig.sourceLanguage || config.DEFAULT_SOURCE_LANGUAGE;
            const targetLanguage = translationConfig.targetLanguage || config.DEFAULT_TARGET_LANGUAGE;
            
            addLog(`Using translation config - From: ${sourceLanguage} To: ${targetLanguage}`);
            modelClient.setLanguagePair(sourceLanguage, targetLanguage);
            
            // Save language settings
            const userSettings = loadUserSettings();
            userSettings.sentenceProcessing.sourceLanguage = sourceLanguage;
            userSettings.sentenceProcessing.targetLanguage = targetLanguage;
            saveUserSettings(userSettings);
        } else {
            addLog(`Using default translation: ${config.DEFAULT_SOURCE_LANGUAGE} to ${config.DEFAULT_TARGET_LANGUAGE}`);
        }

        // Read file and detect chapters
        let content;
        let chapters;
        let totalLines;
        try {
            content = fs.readFileSync(filePath, 'utf8');
            const allLines = content.split(/\r?\n/).filter(line => line.trim());
            
            // Split into chapters using the same logic as makeBundles.js
            const markerRegex = /^\[(CHAPTER|BOOK) MARKER]/i;
            chapters = [];
            let currentChapter = [];
            
            for (const line of allLines) {
                const trimmed = line.trim();
                if (!trimmed) continue; // skip blanks
                
                if (markerRegex.test(trimmed)) {
                    // New chapter found
                    if (currentChapter.length) {
                        chapters.push(currentChapter.join('\n'));
                    }
                    currentChapter = [];
                } else {
                    // Add line to current chapter (ensure trailing |)
                    currentChapter.push(trimmed.endsWith('|') ? trimmed : trimmed + '|');
                }
            }
            
            // Don't forget the last chapter
            if (currentChapter.length) {
                chapters.push(currentChapter.join('\n'));
            }
            
            // Count total lines across all chapters
            totalLines = chapters.reduce((total, chapter) => total + chapter.split('\n').length, 0);
            
            processingState.totalLines = totalLines;
            processingState.totalChapters = chapters.length;
            
            addLog(`Found ${chapters.length} chapters with ${totalLines} total lines`);
            addLog(`Batch size automatically set to ${chapters.length} (one batch per chapter)`);
            
        } catch (fileError) {
            addLog(`Failed to read file: ${filePath}`, 'error', fileError);
            processingState.isRunning = false;
            processingState.status = 'error';
            return res.status(500).json({ 
                error: 'Failed to read file',
                details: fileError.message,
                path: filePath,
                code: fileError.code
            });
        }

        addLog(`Found ${processingState.totalLines} lines to process`);

        res.json({ 
            message: 'Processing started successfully',
            totalLines: processingState.totalLines,
            totalChapters: processingState.totalChapters,
            filePath: filePath,
            batchSize: chapters.length
        });

        // Start processing in background (each batch = one chapter)
        processChapters(chapters, filePath);

    } catch (error) {
        addLog('Unexpected error in /api/process/start', 'error', error);
        processingState.isRunning = false;
        processingState.status = 'error';
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n')
        });
    }
});

// Start batch processing with Vertex AI
app.post('/api/batch/start', async (req, res) => {
    try {
        const { filePath, projectId, gcsInputBucket, gcsOutputBucket } = req.body;

        // Validate required fields with detailed error messages
        const missingFields = [];
        if (!filePath) missingFields.push('filePath');
        if (!projectId) missingFields.push('projectId');
        if (!gcsInputBucket) missingFields.push('gcsInputBucket');
        if (!gcsOutputBucket) missingFields.push('gcsOutputBucket');

        if (missingFields.length > 0) {
            const error = new Error(`Missing required fields: ${missingFields.join(', ')}`);
            error.code = 'MISSING_REQUIRED_FIELDS';
            addLog('Failed to start batch processing: Missing required fields', 'error', error);
            return res.status(400).json({ 
                error: 'Missing required fields',
                details: `The following fields are required: ${missingFields.join(', ')}`,
                missingFields: missingFields
            });
        }

        if (!fs.existsSync(filePath)) {
            const error = new Error(`File not found: ${filePath}`);
            error.code = 'ENOENT';
            error.path = filePath;
            addLog(`Failed to start batch processing: File not found`, 'error', error);
            return res.status(400).json({ 
                error: 'File not found',
                details: `The file "${filePath}" does not exist`,
                path: filePath
            });
        }

        if (processingState.isRunning) {
            addLog('Batch processing request rejected: Already in progress', 'error');
            return res.status(409).json({ 
                error: 'Processing already in progress',
                details: `Current status: ${processingState.status}`
            });
        }

        resetProcessingState();
        processingState.isRunning = true;
        processingState.status = 'creating_bundles';

        addLog('Starting batch processing...');
        addLog(`Input file: ${filePath}`);
        addLog(`Project ID: ${projectId}`);
        addLog(`Input bucket: ${gcsInputBucket}`);
        addLog(`Output bucket: ${gcsOutputBucket}`);

        res.json({ 
            message: 'Batch processing started successfully',
            filePath: filePath,
            projectId: projectId,
            gcsInputBucket: gcsInputBucket,
            gcsOutputBucket: gcsOutputBucket
        });

        // Start batch processing in background
        processBatch(filePath, projectId, gcsInputBucket, gcsOutputBucket);

    } catch (error) {
        addLog('Unexpected error in /api/batch/start', 'error', error);
        processingState.isRunning = false;
        processingState.status = 'error';
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n')
        });
    }
});

// Get processing status
app.get('/api/status', (req, res) => {
    res.json({
        isRunning: processingState.isRunning,
        status: processingState.status,
        logs: processingState.logs,
        totalLines: processingState.totalLines,
        totalChapters: processingState.totalChapters,
        processedLines: processingState.processedLines,
        successfulLines: processingState.successfulLines,
        failedLines: processingState.failedLines,
        jobName: processingState.jobName
    });
});

// Get supported languages
app.get('/api/languages', (req, res) => {
    res.json({
        supportedLanguages: config.SUPPORTED_LANGUAGES,
        defaultSource: config.DEFAULT_SOURCE_LANGUAGE,
        defaultTarget: config.DEFAULT_TARGET_LANGUAGE
    });
});

// Word processing endpoints

// Start word processing
app.post('/api/words/start', async (req, res) => {
    try {
        const { filePath, databasePath, aiConfig, translationConfig } = req.body;

        if (!filePath) {
            const error = new Error('File path is required');
            error.code = 'MISSING_FILE_PATH';
            addWordLog('Failed to start word processing: File path is required', 'error', error);
            return res.status(400).json({ 
                error: 'File path is required',
                details: 'No file path provided in request body'
            });
        }

        if (!fs.existsSync(filePath)) {
            const error = new Error(`File not found: ${filePath}`);
            error.code = 'ENOENT';
            error.path = filePath;
            addWordLog(`Failed to start word processing: File not found`, 'error', error);
            return res.status(400).json({ 
                error: 'File not found',
                details: `The file "${filePath}" does not exist`,
                path: filePath
            });
        }

        if (wordProcessingState.isRunning) {
            addWordLog('Word processing request rejected: Already in progress', 'error');
            return res.status(409).json({ 
                error: 'Word processing already in progress',
                details: `Current status: ${wordProcessingState.status}`
            });
        }

        resetWordProcessingState();
        wordProcessingState.isRunning = true;
        wordProcessingState.status = 'processing';

        addWordLog(`Starting word processing: ${filePath}`);
        if (databasePath && databasePath.trim() !== '') {
            addWordLog(`Using database: ${databasePath}`);
        } else {
            addWordLog('No database specified - processing all words without checking existing entries');
        }

        // Handle AI configuration for word processing (like sentence processing)
        if (aiConfig) {
            addWordLog(`Using custom AI config - Project: ${aiConfig.projectId}, Location: ${aiConfig.location}`);
            addWordLog(`Model endpoint: ${aiConfig.modelEndpoint}`);
        } else {
            addWordLog('Using default AI configuration from config.js');
        }

        res.json({ 
            message: 'Word processing started successfully',
            filePath: filePath,
            databasePath: databasePath || null
        });

        // Start word processing in background
        processWords(filePath, databasePath, aiConfig, translationConfig);

    } catch (error) {
        addWordLog('Unexpected error in /api/words/start', 'error', error);
        wordProcessingState.isRunning = false;
        wordProcessingState.status = 'error';
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n')
        });
    }
});

// Get word processing status
app.get('/api/words/status', (req, res) => {
    res.json({
        isRunning: wordProcessingState.isRunning,
        status: wordProcessingState.status,
        logs: wordProcessingState.logs,
        totalWords: wordProcessingState.totalWords,
        newWords: wordProcessingState.newWords,
        processedWords: wordProcessingState.processedWords,
        successfulWords: wordProcessingState.successfulWords,
        failedWords: wordProcessingState.failedWords
    });
});

// Stop word processing
app.post('/api/words/stop', (req, res) => {
    if (wordProcessingState.currentWordProcessor) {
        wordProcessingState.currentWordProcessor.stop();
        wordProcessingState.currentWordProcessor = null;
    }
    
    wordProcessingState.isRunning = false;
    wordProcessingState.status = 'stopped';
    addWordLog('Word processing stopped by user request');
    
    res.json({ message: 'Word processing stop requested' });
});

// Download word processing results as SQL
app.get('/api/words/download/sql', (req, res) => {
    try {
        // Look for the most recent word SQL file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let sqlContent;
        
        // Try to find real generated SQL files
        const possibleFiles = [
            `logs/sql/word_results_${timestamp.substring(0, 10)}.sql`,
            'logs/sql/word_results_latest.sql',
            'word_translations_inserts.sql'
        ];
        
        let foundFile = null;
        for (const filename of possibleFiles) {
            try {
                if (fs.existsSync(filename)) {
                    sqlContent = fs.readFileSync(filename, 'utf8');
                    foundFile = filename;
                    addWordLog(`Using real word SQL file: ${filename}`);
                    break;
                }
            } catch (err) {
                // Continue searching
            }
        }
        
        // Fallback to placeholder if no real data exists
        if (!sqlContent) {
            addWordLog('No real word SQL data found, generating placeholder', 'error');
            sqlContent = generateWordSQL();
        }
        
        res.setHeader('Content-Type', 'text/sql');
        res.setHeader('Content-Disposition', 'attachment; filename="word_translations_inserts.sql"');
        res.send(sqlContent);
        
    } catch (error) {
        addWordLog('Error in word SQL download', 'error', error);
        res.status(500).json({ error: 'Failed to generate word SQL download' });
    }
});

// Sentence batch processing endpoints
app.post('/api/sentence-batch/start', async (req, res) => {
    try {
        const { filePath, sourceLanguage, targetLanguage } = req.body;

        if (!filePath) {
            return res.status(400).json({
                error: 'Missing required parameter: filePath'
            });
        }

        if (sentenceBatchState.isRunning) {
            return res.status(400).json({
                error: 'Sentence batch processing is already running'
            });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(400).json({
                error: `File not found: ${filePath}`
            });
        }

        // Reset state
        resetBatchProcessingState();
        sentenceBatchState.isRunning = true;
        sentenceBatchState.status = 'starting';

        addBatchLog('Starting sentence batch processing...');
        addBatchLog(`File: ${filePath}`);

        // Count lines in file
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
        sentenceBatchState.totalLines = lines.length;

        addBatchLog(`Found ${lines.length} lines to process`);

        // Import and start batch processor
        const BatchSentenceProcessor = (await import('./batchSentenceProcessor.js')).default;
        const batchProcessor = new BatchSentenceProcessor();
        sentenceBatchState.currentBatchProcessor = batchProcessor;

        // Start processing asynchronously with periodic status updates
        (async () => {
            try {
                sentenceBatchState.status = 'processing';
                
                // Start a polling interval to update state from batch processor
                const statusInterval = setInterval(() => {
                    if (batchProcessor && sentenceBatchState.isRunning) {
                        const currentStats = batchProcessor.getStats();
                        sentenceBatchState.processedLines = currentStats.processed;
                        sentenceBatchState.successfulLines = currentStats.successful;
                        sentenceBatchState.failedLines = currentStats.failed;
                    }
                }, 1000); // Update every second
                
                const stats = await batchProcessor.processBatchFile(filePath, sourceLanguage, targetLanguage);
                
                clearInterval(statusInterval);
                
                // Update final stats
                sentenceBatchState.processedLines = stats.processed;
                sentenceBatchState.successfulLines = stats.successful;
                sentenceBatchState.failedLines = stats.failed;
                sentenceBatchState.status = 'completed';
                sentenceBatchState.isRunning = false;

                addBatchLog(`Batch processing completed: ${stats.successful}/${stats.processed} successful (${stats.success_rate})`);
                
            } catch (error) {
                addBatchLog('Batch processing failed', 'error', error);
                sentenceBatchState.status = 'error';
                sentenceBatchState.isRunning = false;
            }
        })();

        res.json({
            message: 'Sentence batch processing started successfully',
            totalLines: sentenceBatchState.totalLines
        });

    } catch (error) {
        addBatchLog('Error starting sentence batch processing', 'error', error);
        sentenceBatchState.isRunning = false;
        sentenceBatchState.status = 'error';
        res.status(500).json({
            error: 'Failed to start sentence batch processing',
            details: error.message
        });
    }
});

app.get('/api/sentence-batch/status', (req, res) => {
    res.json({
        isRunning: sentenceBatchState.isRunning,
        status: sentenceBatchState.status,
        totalLines: sentenceBatchState.totalLines,
        processedLines: sentenceBatchState.processedLines,
        successfulLines: sentenceBatchState.successfulLines,
        failedLines: sentenceBatchState.failedLines,
        logs: sentenceBatchState.logs.slice(-50) // Last 50 log entries
    });
});

app.post('/api/sentence-batch/stop', (req, res) => {
    if (sentenceBatchState.currentBatchProcessor) {
        sentenceBatchState.currentBatchProcessor.stop();
        sentenceBatchState.currentBatchProcessor = null;
    }
    
    sentenceBatchState.isRunning = false;
    sentenceBatchState.status = 'stopped';
    addBatchLog('Sentence batch processing stopped by user request');
    
    res.json({ message: 'Sentence batch processing stop requested' });
});

// Download sentence batch processing results as JSONL
app.get('/api/sentence-batch/download/jsonl', (req, res) => {
    try {
        // Look for the most recent batch JSONL file
        const batchDir = 'logs/batchSent';
        if (!fs.existsSync(batchDir)) {
            return res.status(404).json({ error: 'No batch processing results found' });
        }

        const files = fs.readdirSync(batchDir).filter(file => file.endsWith('.jsonl'));
        
        if (files.length === 0) {
            return res.status(404).json({ error: 'No JSONL files found' });
        }
        
        // Get the most recent file
        const mostRecentFile = files.sort((a, b) => {
            const statA = fs.statSync(path.join(batchDir, a));
            const statB = fs.statSync(path.join(batchDir, b));
            return statB.mtime - statA.mtime;
        })[0];
        
        const filePath = path.join(batchDir, mostRecentFile);
        const jsonlContent = fs.readFileSync(filePath, 'utf8');
        
        res.setHeader('Content-Type', 'application/x-jsonlines');
        res.setHeader('Content-Disposition', 'attachment; filename="batch_sentences.jsonl"');
        res.send(jsonlContent);
        
        addBatchLog(`JSONL file downloaded: ${mostRecentFile}`);
        
    } catch (error) {
        addBatchLog('Error in batch JSONL download', 'error', error);
        res.status(500).json({ error: 'Failed to generate batch JSONL download' });
    }
});

// Stop processing
app.post('/api/stop', (req, res) => {
    if (processingState.currentProcess) {
        processingState.currentProcess.kill('SIGTERM');
        processingState.currentProcess = null;
    }
    
    processingState.isRunning = false;
    processingState.status = 'stopped';
    addLog('Processing stopped by user request');
    
    res.json({ message: 'Processing stop requested' });
});

// Download results as SQL
app.get('/api/download/sql', (req, res) => {
    try {
        // Look for the most recent SQL file generated by real processing
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let sqlContent;
        
        // Try to find real generated SQL files
        const possibleFiles = [
            `book_sentences_final_${timestamp.substring(0, 10)}.sql`, // Today's final file
            'book_sentences_progress.sql',
            'book_sentences_inserts.sql'
        ];
        
        let foundFile = null;
        for (const filename of possibleFiles) {
            try {
                if (fs.existsSync(filename)) {
                    sqlContent = fs.readFileSync(filename, 'utf8');
                    foundFile = filename;
                    addLog(`Using real SQL file: ${filename}`);
                    break;
                }
            } catch (err) {
                // Continue searching
            }
        }
        
        // If no real SQL file found, generate from actual SQLGenerator data
        if (!foundFile && sqlGenerator) {
            try {
                // Save current SQL data to a file and read it
                const tempFile = `temp_download_${Date.now()}.sql`;
                sqlGenerator.saveToFile(tempFile);
                if (fs.existsSync(tempFile)) {
                    sqlContent = fs.readFileSync(tempFile, 'utf8');
                    foundFile = tempFile;
                    addLog(`Generated SQL from current session: ${tempFile}`);
                    // Clean up temp file after reading
                    fs.unlinkSync(tempFile);
                }
            } catch (err) {
                addLog(`Error generating SQL from current session: ${err.message}`, 'error');
            }
        }
        
        // Fallback to placeholder only if absolutely no real data exists
        if (!sqlContent) {
            addLog('No real SQL data found, generating placeholder', 'error');
            sqlContent = generateSQL();
        }
        
        res.setHeader('Content-Type', 'text/sql');
        res.setHeader('Content-Disposition', 'attachment; filename="book_sentences_inserts.sql"');
        res.send(sqlContent);
        
    } catch (error) {
        addLog('Error in SQL download', 'error', error);
        res.status(500).json({ error: 'Failed to generate SQL download' });
    }
});

// Helper functions

async function processChapters(chapters, filePath) {
    const functionName = 'processChapters';
    addLog(`Starting ${functionName} with ${chapters.length} chapters using real AI processing`);
    
    try {
        // Ensure directories exist
        fs.mkdirSync('logs/errors', { recursive: true });
        fs.mkdirSync('logs/responses', { recursive: true });
        fs.mkdirSync('logs/sql', { recursive: true });
        
        // Initialize SQL generator for this session
        sqlGenerator.clear(); // Clear any previous data
        sqlGenerator.initializeSchema();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const errorLogFile = `logs/errors/sentence_processing_errors_${timestamp}.log`;
        const successLogFile = `logs/responses/sentence_model_responses_raw_${timestamp}.txt`;
        
        // Initialize log files
        fs.writeFileSync(errorLogFile, `Chapter Processing Error Log - Run: ${new Date().toString()}\n${"=".repeat(40)}\n`, 'utf8');
        fs.writeFileSync(successLogFile, `# Raw Model Responses (Chapters) - Run: ${new Date().toString()}\n`, 'utf8');
        
        addLog(`Initialized log files: ${errorLogFile}, ${successLogFile}`);
        
        for (let i = 0; i < chapters.length && processingState.isRunning; i++) {
            try {
                const chapter = chapters[i];
                const chapterNumber = i + 1;
                const chapterLines = chapter.split('\n').filter(line => line.trim());
                
                addLog(`Processing Chapter ${chapterNumber} (${chapterLines.length} lines) with Vertex AI`);
                
                // Convert chapter lines to the format expected by your AI system
                const lineDataArray = chapterLines.map((line, lineIndex) => ({
                    chapter_id: chapterNumber,
                    line_number: lineIndex + 1,
                    original_text: line.endsWith('|') ? line.slice(0, -1).trim() : line.trim()
                }));
                
                // Show sample lines
                const sampleLines = lineDataArray.slice(0, 2).map(lineData => 
                    `C${lineData.chapter_id}_L${lineData.line_number}: "${lineData.original_text.substring(0, 50)}..."`
                );
                addLog(`Sample lines: ${sampleLines.join(', ')}`);
                
                // Process the chapter using your existing batch processing logic
                addLog(`About to call processBatchLinesWithAI for ${lineDataArray.length} lines`);
                const batchResults = await processBatchLinesWithAI(lineDataArray, chapterNumber, errorLogFile, successLogFile);
                addLog(`processBatchLinesWithAI returned ${batchResults.length} results`);
                
                // Update counters
                let chapterSuccesses = 0;
                let chapterFailures = 0;
                
                for (const result of batchResults) {
                    if (result) {
                        chapterSuccesses++;
                        processingState.successfulLines++;
                    } else {
                        chapterFailures++;
                        processingState.failedLines++;
                    }
                    processingState.processedLines++;
                }
                
                if (chapterSuccesses > 0) {
                    addLog(`✓ Chapter ${chapterNumber}: Successfully processed ${chapterSuccesses}/${chapterLines.length} lines`, 'success');
                }
                if (chapterFailures > 0) {
                    addLog(`✗ Chapter ${chapterNumber}: Failed to process ${chapterFailures}/${chapterLines.length} lines`, 'error');
                }
                
                // Save progress periodically
                if (chapterNumber % 2 === 0 || chapterNumber === chapters.length) {
                    const sqlFile = `logs/sql/book_sentences_progress_${timestamp}.sql`;
                    sqlGenerator.saveToFile(sqlFile);
                    addLog(`Progress saved to ${sqlFile} after Chapter ${chapterNumber}`);
                }
                
                
            } catch (chapterError) {
                const chapterNumber = i + 1;
                addLog(`Error processing Chapter ${chapterNumber}`, 'error', chapterError);
                const chapterLines = chapters[i].split('\n').filter(line => line.trim());
                processingState.failedLines += chapterLines.length;
                processingState.processedLines += chapterLines.length;
            }
        }
        
        if (processingState.isRunning) {
            processingState.status = 'completed';
            const finalSqlFile = `book_sentences_final_${timestamp}.sql`;
            sqlGenerator.saveToFile(finalSqlFile);
            addLog('Chapter processing completed successfully!');
            addLog(`Final results - Total: ${processingState.totalLines}, Success: ${processingState.successfulLines}, Failed: ${processingState.failedLines}`);
            addLog(`Final SQL saved to: ${finalSqlFile}`);
            addLog(`Error log: ${errorLogFile}`);
            addLog(`Success log: ${successLogFile}`);
        } else {
            processingState.status = 'stopped';
            addLog('Chapter processing stopped by user');
        }
        
        processingState.isRunning = false;
        
    } catch (error) {
        addLog(`Fatal error in ${functionName}`, 'error', error);
        processingState.isRunning = false;
        processingState.status = 'error';
        addLog(`Processing failed for file: ${filePath}`);
    }
}

async function processBatchLinesWithAI(lineDataArray, chapterNumber, errorLogFile, successLogFile) {
    addLog(`Processing chapter ${chapterNumber} with ${lineDataArray.length} lines using ${config.CONCURRENT_WORKERS} concurrent workers`);
    
    const results = new Array(lineDataArray.length).fill(null);
    const workers = [];
    let queueIndex = 0;
    
    // Worker function for concurrent processing
    const processWorker = async (workerId) => {
        addLog(`Worker ${workerId} started for chapter ${chapterNumber}`);
        
        while (queueIndex < lineDataArray.length && processingState.isRunning) {
            const currentIndex = queueIndex++;
            if (currentIndex >= lineDataArray.length) break;
            
            const lineData = lineDataArray[currentIndex];
            addLog(`Worker ${workerId}: Processing line ${currentIndex + 1}/${lineDataArray.length} of chapter ${chapterNumber}`);
            
            let success = false;
            
            for (let attempt = 1; attempt <= config.MAX_RETRIES_SENTENCE; attempt++) {
                try {
                    addLog(`    Worker ${workerId} - Attempt ${attempt}/${config.MAX_RETRIES_SENTENCE} for C${lineData.chapter_id}_L${lineData.line_number}`);
                    
                    const rawModelResponse = await modelClient.getSingleTranslation(lineData);
                    
                    if (!rawModelResponse || !rawModelResponse.trim()) {
                        addLog(`    Worker ${workerId} - No content from model on attempt ${attempt}`, 'error');
                        if (attempt < config.MAX_RETRIES_SENTENCE) {
                            await modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                            continue;
                        } else {
                            modelClient.logError(lineData.chapter_id, lineData.line_number, lineData.original_text, "No content from model after max retries.", rawModelResponse, null, errorLogFile);
                            sqlGenerator.addFailedLineSQL(lineData.chapter_id, lineData.line_number, lineData.original_text, "No content from model after max retries.", rawModelResponse);
                            break;
                        }
                    }
                    
                    // Log successful response
                    modelClient.logSuccessfulResponse([lineData], rawModelResponse, successLogFile);
                    addLog(`    Worker ${workerId} - ✓ Received AI response for C${lineData.chapter_id}_L${lineData.line_number}`);
                    
                    // Parse the response
                    const [germanAnnotated, englishAnnotated, parseErrors] = textProcessor.parseTranslationResponse(rawModelResponse);
                    
                    if (germanAnnotated !== null && englishAnnotated !== null) {
                        sqlGenerator.addSuccessfulLineSQL(lineData.chapter_id, lineData.line_number, lineData.original_text, germanAnnotated, englishAnnotated, parseErrors);
                        addLog(`    Worker ${workerId} - ✓ Successfully processed C${lineData.chapter_id}_L${lineData.line_number}`);
                        success = true;
                        break; // Exit retry loop on success
                    } else {
                        addLog(`    Worker ${workerId} - ✗ Failed to parse C${lineData.chapter_id}_L${lineData.line_number}: ${parseErrors.join('; ')}`, 'error');
                        if (attempt < config.MAX_RETRIES_SENTENCE) {
                            addLog(`    Worker ${workerId} - Retrying parsing in ${config.RETRY_DELAY_SECONDS_SENTENCE}ms...`);
                            await modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                            continue; // Retry with new AI request
                        } else {
                            addLog(`    Worker ${workerId} - Failed to parse after ${config.MAX_RETRIES_SENTENCE} attempts`, 'error');
                            modelClient.logError(lineData.chapter_id, lineData.line_number, lineData.original_text, "Failed to parse line response after max retries", rawModelResponse, parseErrors, errorLogFile);
                            sqlGenerator.addFailedLineSQL(lineData.chapter_id, lineData.line_number, lineData.original_text, parseErrors.join('; '), rawModelResponse);
                            break; // Exit retry loop after max attempts
                        }
                    }
                    
                } catch (error) {
                    addLog(`    Worker ${workerId} - ✗ Error processing C${lineData.chapter_id}_L${lineData.line_number} on attempt ${attempt}`, 'error');
                    addLog(`    Worker ${workerId} - Error details: ${error.message}`);
                    
                    if (attempt < config.MAX_RETRIES_SENTENCE) {
                        addLog(`    Worker ${workerId} - Retrying in ${config.RETRY_DELAY_SECONDS_SENTENCE}ms...`);
                        await modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                    } else {
                        modelClient.logError(lineData.chapter_id, lineData.line_number, lineData.original_text, `Unexpected error after max retries: ${error.message}`, "", [], errorLogFile);
                        sqlGenerator.addFailedLineSQL(lineData.chapter_id, lineData.line_number, lineData.original_text, `Unexpected error after max retries: ${error.message}`, "");
                    }
                }
            }
            
            results[currentIndex] = success;
            
            // Rate limiting delay
            if (queueIndex < lineDataArray.length) {
                await modelClient.delay(config.RATE_LIMIT_DELAY);
            }
        }
        
        addLog(`Worker ${workerId} finished for chapter ${chapterNumber}`);
    };
    
    // Start workers
    for (let i = 0; i < config.CONCURRENT_WORKERS; i++) {
        workers.push(processWorker(i + 1));
        // Stagger worker starts
        await modelClient.delay(config.RATE_LIMIT_DELAY);
    }
    
    // Wait for all workers to complete
    await Promise.all(workers);
    
    addLog(`Chapter ${chapterNumber} concurrent processing completed`);
    return results;
}

async function processBatch(filePath, projectId, gcsInputBucket, gcsOutputBucket) {
    try {
        // Step 1: Create bundles
        processingState.status = 'creating_bundles';
        addLog('Creating batch bundles...');
        
        const bundlesPath = 'temp_bundles.jsonl';
        
        await runCommand('node', ['makeBundles.js', filePath, bundlesPath], (data) => {
            addLog(data.toString().trim());
        });
        
        // Step 2: Run batch processor
        processingState.status = 'submitting_batch';
        addLog('Submitting to Vertex AI Batch...');
        
        let batchResults = null;
        try {
            await runCommand('node', ['sentenceProcessor.js', filePath], (data) => {
                const output = data.toString().trim();
                addLog(output);
                
                // Extract sentence processing results if present
                const resultsMatch = output.match(/Processing result: (.+)/);
                if (resultsMatch) {
                    try {
                        batchResults = JSON.parse(resultsMatch[1]);
                        if (batchResults.success) {
                            addLog(`✅ Sentence processing completed: ${batchResults.successfulLines}/${batchResults.totalLines} sentences successful`);
                        } else {
                            addLog(`❌ Sentence processing failed: ${batchResults.error}`, 'error');
                        }
                    } catch (e) {
                        addLog(`❌ Failed to parse processing results: ${e.message}`, 'error');
                    }
                }
            });
        } catch (commandError) {
            addLog(`⚠️ Sentence processor command failed: ${commandError.message}`, 'error');
            addLog('This might be due to timeout or other execution issues');
        }
        
        processingState.status = 'completed';
        
        if (batchResults) {
            // Use real results from batch processing
            processingState.totalLines = batchResults.totalLines;
            processingState.processedLines = batchResults.totalLines;
            processingState.successfulLines = batchResults.successfulLines;
            processingState.failedLines = batchResults.failedLines;
            processingState.totalChapters = batchResults.totalChapters;
            processingState.successfulChapters = batchResults.successfulChapters;
            processingState.failedChapters = batchResults.failedChapters;
            
            addLog('Batch processing completed successfully!');
            addLog(`Results: ${batchResults.successfulChapters}/${batchResults.totalChapters} chapters successful`);
            addLog(`Lines: ${batchResults.successfulLines}/${batchResults.totalLines} successful`);
            addLog(`SQL output: ${batchResults.sqlFile}`);
            addLog(`Error log: ${batchResults.errorLog}`);
        } else {
            // Fallback if results parsing failed
            addLog('Batch processing completed but could not parse results', 'warn');
            processingState.totalLines = 0;
            processingState.processedLines = 0;
            processingState.successfulLines = 0;
            processingState.failedLines = 0;
        }
        
    } catch (error) {
        addLog(`Error during batch processing: ${error.message}`, 'error');
        processingState.isRunning = false;
        processingState.status = 'error';
    }
}

function runCommand(command, args, onData) {
    return new Promise((resolve, reject) => {
        const commandString = `${command} ${args.join(' ')}`;
        addLog(`Executing command: ${commandString}`);
        
        const process = spawn(command, args, { 
            cwd: __dirname,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        processingState.currentProcess = process;
        
        let stdoutData = '';
        let stderrData = '';
        
        process.stdout.on('data', (data) => {
            const output = data.toString();
            stdoutData += output;
            onData(data);
        });
        
        process.stderr.on('data', (data) => {
            const errorOutput = data.toString().trim();
            stderrData += errorOutput;
            addLog(`Command stderr: ${errorOutput}`, 'error');
        });
        
        process.on('close', (code) => {
            processingState.currentProcess = null;
            addLog(`Command "${commandString}" exited with code ${code}`);
            
            if (code === 0) {
                addLog(`Command completed successfully. Output length: ${stdoutData.length} chars`);
                resolve();
            } else {
                const error = new Error(`Command failed with exit code ${code}`);
                error.code = 'COMMAND_FAILED';
                error.exitCode = code;
                error.command = commandString;
                error.stdout = stdoutData;
                error.stderr = stderrData;
                
                addLog(`Command failed: ${commandString}`, 'error', error);
                reject(error);
            }
        });
        
        process.on('error', (error) => {
            processingState.currentProcess = null;
            error.command = commandString;
            addLog(`Command execution error: ${commandString}`, 'error', error);
            reject(error);
        });
    });
}

async function processWords(filePath, databasePath, aiConfig, translationConfig) {
    const functionName = 'processWords';
    
    // Save file paths for future use
    const userSettings = loadUserSettings();
    userSettings.wordProcessing.textFilePath = filePath;
    userSettings.wordProcessing.databasePath = databasePath || "";
    saveUserSettings(userSettings);
    
    addWordLog(`Starting ${functionName} for file: ${filePath}`);
    if (databasePath) {
        addWordLog(`Database path: ${databasePath}`);
    }
    
    try {
        if (!WordProcessor) {
            throw new Error('WordProcessor not loaded');
        }

        // Create custom config with AI settings if provided
        let customConfig = null;
        if (aiConfig) {
            customConfig = {
                ...config,
                PROJECT_ID: aiConfig.projectId || config.PROJECT_ID,
                LOCATION: aiConfig.location || config.LOCATION,
                MODEL_ENDPOINT: aiConfig.modelEndpoint || config.MODEL_ENDPOINT,
                ROLLBACK_MODELS: aiConfig.rollbackModels ? aiConfig.rollbackModels.slice(0, 3) : []
            };
            
            // Save the settings for future use
            const userSettings = loadUserSettings();
            userSettings.wordProcessing.projectId = aiConfig.projectId || config.PROJECT_ID;
            userSettings.wordProcessing.location = aiConfig.location || config.LOCATION;
            userSettings.wordProcessing.modelEndpoint = aiConfig.modelEndpoint || config.MODEL_ENDPOINT;
            if (aiConfig.rollbackModels && Array.isArray(aiConfig.rollbackModels)) {
                userSettings.wordProcessing.rollbackModels = aiConfig.rollbackModels.slice(0, 3); // Max 3 rollback models
            }
            saveUserSettings(userSettings);
            
            addWordLog(`WordProcessor will use: Project ${customConfig.PROJECT_ID}, Model ${customConfig.MODEL_ENDPOINT}`);
        }

        // Create custom logger function that sends logs to UI
        const customLogger = (message) => {
            addWordLog(message);
        };
        
        wordProcessingState.currentWordProcessor = new WordProcessor(databasePath, customConfig, customLogger);

        // Update translation configuration if provided (like sentence processing)
        if (translationConfig) {
            const sourceLanguage = translationConfig.sourceLanguage || config.DEFAULT_SOURCE_LANGUAGE;
            const targetLanguage = translationConfig.targetLanguage || config.DEFAULT_TARGET_LANGUAGE;
            
            addWordLog(`Using translation config - From: ${sourceLanguage} To: ${targetLanguage}`);
            wordProcessingState.currentWordProcessor.modelClient.setLanguagePair(sourceLanguage, targetLanguage);
            
            // Save language settings
            const userSettings = loadUserSettings();
            userSettings.wordProcessing.sourceLanguage = sourceLanguage;
            userSettings.wordProcessing.targetLanguage = targetLanguage;
            saveUserSettings(userSettings);
        } else {
            addWordLog(`Using default translation: ${config.DEFAULT_SOURCE_LANGUAGE} to ${config.DEFAULT_TARGET_LANGUAGE}`);
        }
        
        if (databasePath && databasePath.trim() !== '') {
            addWordLog(`WordProcessor configured with database: ${databasePath}`);
        } else {
            addWordLog(`WordProcessor configured with no database - will process all words`);
        }
        
        addWordLog('WordProcessor instance created');

        const result = await wordProcessingState.currentWordProcessor.processFile(filePath);
        
        if (result.success) {
            wordProcessingState.status = 'completed';
            wordProcessingState.totalWords = result.totalWords || 0;
            wordProcessingState.newWords = result.newWords || 0;
            wordProcessingState.processedWords = result.newWords || 0;
            wordProcessingState.successfulWords = result.successfulWords || 0;
            wordProcessingState.failedWords = result.failedWords || 0;
            
            addWordLog('Word processing completed successfully!');
            addWordLog(`Total words in text: ${result.totalWords}`);
            addWordLog(`New words to process: ${result.newWords}`);
            addWordLog(`Successfully processed: ${result.successfulWords}`);
            addWordLog(`Failed to process: ${result.failedWords}`);
            
        } else {
            wordProcessingState.status = 'error';
            addWordLog(`Word processing failed: ${result.error}`, 'error');
        }
        
        wordProcessingState.isRunning = false;
        wordProcessingState.currentWordProcessor = null;
        
    } catch (error) {
        addWordLog(`Fatal error in ${functionName}`, 'error', error);
        wordProcessingState.isRunning = false;
        wordProcessingState.status = 'error';
        wordProcessingState.currentWordProcessor = null;
        addWordLog(`Word processing failed for file: ${filePath}`);
    }
}

function generateSQL() {
    const timestamp = new Date().toISOString();
    
    return `-- Book Sentences SQL Export
-- Generated: ${timestamp}
-- Total processed: ${processingState.processedLines} lines
-- Successful: ${processingState.successfulLines}
-- Failed: ${processingState.failedLines}

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS book_sentences (
    id INTEGER PRIMARY KEY,
    sentence_number INTEGER,
    chapter_id INTEGER,
    original_text TEXT,
    original_parsed_text TEXT,
    translation_parsed_text TEXT,
    processing_errors TEXT
);

CREATE INDEX IF NOT EXISTS idx_book_sentences_chapter_sentence ON book_sentences(chapter_id, sentence_number);

-- Processed data would be inserted here
-- (This is a placeholder - actual implementation would include real results)
${Array.from({length: processingState.successfulLines}, (_, i) => 
    `INSERT INTO book_sentences (chapter_id, sentence_number, original_text, original_parsed_text, translation_parsed_text, processing_errors) VALUES (1, ${i+1}, 'Processed sentence ${i+1}', 'Processed/1/ German/2/ sentence/3/', 'Processed English sentence', NULL);`
).join('\n')}
`;
}

function generateWordSQL() {
    const timestamp = new Date().toISOString();
    
    return `-- Word Translations SQL Export
-- Generated: ${timestamp}
-- Total words: ${wordProcessingState.totalWords}
-- New words processed: ${wordProcessingState.processedWords}
-- Successful: ${wordProcessingState.successfulWords}
-- Failed: ${wordProcessingState.failedWords}

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS words (
    word_id INTEGER PRIMARY KEY,
    queried_word TEXT NOT NULL,
    base_form_json JSON NOT NULL,
    primary_type TEXT, 
    info_json JSON,
    UNIQUE(queried_word)
);

CREATE TABLE IF NOT EXISTS word_translations (
    translation_id INTEGER PRIMARY KEY,
    word_id INTEGER NOT NULL,
    meaning TEXT NOT NULL,
    additional_info TEXT,
    meta_type TEXT, 
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS translation_examples (
    example_id INTEGER PRIMARY KEY,
    translation_id INTEGER NOT NULL,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL,
    FOREIGN KEY (translation_id) REFERENCES word_translations(translation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_words_queried_word ON words(queried_word);
CREATE INDEX IF NOT EXISTS idx_word_translations_word_id ON word_translations(word_id);
CREATE INDEX IF NOT EXISTS idx_translation_examples_translation_id ON translation_examples(translation_id);

-- Processed word data would be inserted here
-- (This is a placeholder - actual implementation would include real results)
${Array.from({length: wordProcessingState.successfulWords}, (_, i) => 
    `INSERT OR IGNORE INTO words (queried_word, base_form_json, primary_type, info_json) VALUES ('word${i+1}', '{"word": "processed_word${i+1}"}', 'noun', '{"type": "processed"}');`
).join('\n')}
`;
}

// EPUB Processing endpoints
app.post('/api/epub/extract', async (req, res) => {
    const { filePath } = req.body;
    
    if (!filePath) {
        return res.status(400).json({ error: 'EPUB file path is required' });
    }
    
    // Check if already processing
    if (epubProcessingState.isRunning) {
        return res.status(409).json({ error: 'EPUB processing already in progress' });
    }
    
    // Reset state for new processing
    epubProcessingState = {
        isRunning: true,
        logs: [],
        extractedText: '',
        chapterCount: 0,
        status: 'processing'
    };
    
    addEpubLog(`Starting EPUB to text conversion: ${filePath}`);
    
    try {
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            throw new Error(`EPUB file not found: ${filePath}`);
        }
        
        // Start the extraction process asynchronously
        processEPUB(filePath).catch(error => {
            addEpubLog(`EPUB processing failed: ${error.message}`, 'error', error);
            epubProcessingState.status = 'error';
            epubProcessingState.isRunning = false;
        });
        
        res.json({
            message: 'EPUB conversion started',
            filePath
        });
        
    } catch (error) {
        addEpubLog(`Error starting EPUB extraction: ${error.message}`, 'error', error);
        epubProcessingState.isRunning = false;
        epubProcessingState.status = 'error';
        
        return res.status(400).json({
            error: 'Failed to start EPUB conversion',
            details: error.message,
            path: filePath,
            code: error.code || 'EPUB_ERROR'
        });
    }
});

app.get('/api/epub/status', (req, res) => {
    res.json({
        isRunning: epubProcessingState.isRunning,
        status: epubProcessingState.status,
        logs: epubProcessingState.logs,
        chapterCount: epubProcessingState.chapterCount,
        hasText: epubProcessingState.extractedText.length > 0
    });
});

app.get('/api/epub/download/text', (req, res) => {
    try {
        if (!epubProcessingState.extractedText) {
            return res.status(404).json({ error: 'No extracted text available' });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `extracted_text_${timestamp}.txt`;
        
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(epubProcessingState.extractedText);
        
        addEpubLog(`Downloaded extracted text: ${filename}`);
        
    } catch (error) {
        addEpubLog('Error downloading extracted text', 'error', error);
        res.status(500).json({ error: 'Failed to download extracted text' });
    }
});

async function processEPUB(filePath) {
    const functionName = 'processEPUB';
    
    // Save file path for future use
    const userSettings = loadUserSettings();
    userSettings.epubProcessing.epubFilePath = filePath;
    saveUserSettings(userSettings);
    
    addEpubLog(`Converting EPUB: ${path.basename(filePath)}`);
    
    try {
        if (!EPUBReader) {
            throw new Error('EPUB Reader not available');
        }
        
        addEpubLog('Reading EPUB file...');
        const reader = new EPUBReader(filePath);
        
        addEpubLog('Extracting text from chapters...');
        const extractedText = await reader.readEPUB();
        
        if (!extractedText || extractedText.trim().length === 0) {
            throw new Error('No text could be extracted from the EPUB file');
        }
        
        // Store results in state
        epubProcessingState.extractedText = extractedText;
        epubProcessingState.chapterCount = reader.chapterCounter - 1;
        epubProcessingState.status = 'completed';
        epubProcessingState.isRunning = false;
        
        addEpubLog(`✅ Successfully converted ${reader.chapterCounter - 1} chapters`);
        addEpubLog(`📄 Text length: ${extractedText.length.toLocaleString()} characters`);
        
        // Save to timestamped file in logs/txt/ folder
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputFile = `logs/txt/extracted_epub_${timestamp}.txt`;
        fs.writeFileSync(outputFile, extractedText, 'utf8');
        addEpubLog(`💾 Text saved to: ${outputFile}`);
        
    } catch (error) {
        addEpubLog(`❌ Conversion failed: ${error.message}`, 'error', error);
        epubProcessingState.isRunning = false;
        epubProcessingState.status = 'error';
    }
}

// Get last used settings by tab
app.get('/api/last-settings/:tab', (req, res) => {
    try {
        const { tab } = req.params;
        const validTabs = ['sentenceProcessing', 'batchProcessing', 'wordProcessing', 'epubProcessing'];
        
        if (!validTabs.includes(tab)) {
            return res.status(400).json({ error: 'Invalid tab. Must be one of: sentenceProcessing, wordProcessing, epubProcessing' });
        }
        
        const userSettings = loadUserSettings();
        res.json(userSettings[tab]);
    } catch (error) {
        console.error('Error getting last settings:', error);
        res.status(500).json({ error: 'Failed to load last settings' });
    }
});

// Get all settings
app.get('/api/last-settings', (req, res) => {
    try {
        const userSettings = loadUserSettings();
        res.json(userSettings);
    } catch (error) {
        console.error('Error getting last settings:', error);
        res.status(500).json({ error: 'Failed to load last settings' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Backend server running at http://localhost:${PORT}`);
    console.log('API endpoints:');
    console.log('  POST /api/process/start - Start sentence processing');
    console.log('  POST /api/batch/start - Start batch processing');
    console.log('  POST /api/words/start - Start word processing');
    console.log('  GET  /api/status - Get processing status');
    console.log('  GET  /api/words/status - Get word processing status');
    console.log('  GET  /api/languages - Get supported languages');
    console.log('  POST /api/stop - Stop processing');
    console.log('  POST /api/words/stop - Stop word processing');
    console.log('  GET  /api/download/sql - Download SQL results');
    console.log('  GET  /api/words/download/sql - Download word SQL results');
    console.log('  POST /api/epub/extract - Extract text from EPUB file');
    console.log('  GET  /api/epub/status - Get EPUB processing status');
    console.log('  GET  /api/epub/download/text - Download extracted text');
    console.log('  GET  /api/last-settings - Get all last used settings');
    console.log('  GET  /api/last-settings/:tab - Get settings for specific tab (sentenceProcessing, wordProcessing, epubProcessing)');
});