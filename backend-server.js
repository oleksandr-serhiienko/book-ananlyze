#!/usr/bin/env node
import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Global state for tracking processing
let processingState = {
    isRunning: false,
    logs: [],
    totalLines: 0,
    processedLines: 0,
    successfulLines: 0,
    failedLines: 0,
    currentProcess: null,
    jobName: null,
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

function resetProcessingState() {
    processingState = {
        isRunning: false,
        logs: [],
        totalLines: 0,
        processedLines: 0,
        successfulLines: 0,
        failedLines: 0,
        currentProcess: null,
        jobName: null,
        status: 'idle'
    };
}

// API Routes

// Start sentence-by-sentence processing
app.post('/api/process/start', async (req, res) => {
    try {
        const { filePath, batchSize } = req.body;

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

        addLog(`Starting sentence processing: ${filePath}`);
        addLog(`Batch size: ${batchSize || 10}`);

        // Read and count lines with detailed error handling
        let content;
        let lines;
        try {
            content = fs.readFileSync(filePath, 'utf8');
            lines = content.split(/\r?\n/).filter(line => line.trim());
            processingState.totalLines = lines.length;
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
            filePath: filePath,
            batchSize: batchSize || 10
        });

        // Start processing in background
        processSentences(lines, batchSize || 10, filePath);

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
        processedLines: processingState.processedLines,
        successfulLines: processingState.successfulLines,
        failedLines: processingState.failedLines,
        jobName: processingState.jobName
    });
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
    const sqlContent = generateSQL();
    
    res.setHeader('Content-Type', 'text/sql');
    res.setHeader('Content-Disposition', 'attachment; filename="book_sentences_inserts.sql"');
    res.send(sqlContent);
});

// Helper functions

async function processSentences(lines, batchSize, filePath) {
    const functionName = 'processSentences';
    addLog(`Starting ${functionName} with ${lines.length} lines, batch size ${batchSize}`);
    
    try {
        for (let i = 0; i < lines.length && processingState.isRunning; i += batchSize) {
            try {
                const batch = lines.slice(i, Math.min(i + batchSize, lines.length));
                const batchNumber = Math.floor(i / batchSize) + 1;
                const batchStart = i + 1;
                const batchEnd = Math.min(i + batchSize, lines.length);
                
                addLog(`Processing batch ${batchNumber} (lines ${batchStart}-${batchEnd}, ${batch.length} lines)`);
                
                // Add sample of lines being processed for debugging
                addLog(`Sample lines in batch: ${batch.slice(0, 2).map((line, idx) => `Line ${batchStart + idx}: "${line.substring(0, 50)}..."`).join(', ')}`);
                
                // Simulate processing time (replace with actual AI processing)
                await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
                
                // Simulate results (replace with actual results)
                const successes = Math.floor(batch.length * (0.8 + Math.random() * 0.2));
                const failures = batch.length - successes;
                
                processingState.successfulLines += successes;
                processingState.failedLines += failures;
                processingState.processedLines += batch.length;
                
                if (successes > 0) {
                    addLog(`✓ Successfully processed ${successes} lines (batch ${batchNumber})`, 'success');
                }
                if (failures > 0) {
                    addLog(`✗ Failed to process ${failures} lines (batch ${batchNumber})`, 'error');
                    // Add details about which lines failed (simulated)
                    const failedLineNumbers = Array.from({length: failures}, (_, idx) => batchStart + successes + idx);
                    addLog(`  Failed line numbers: ${failedLineNumbers.join(', ')}`);
                }
                
            } catch (batchError) {
                const batchNumber = Math.floor(i / batchSize) + 1;
                addLog(`Error processing batch ${batchNumber}`, 'error', batchError);
                processingState.failedLines += Math.min(batchSize, lines.length - i);
                processingState.processedLines += Math.min(batchSize, lines.length - i);
            }
        }
        
        if (processingState.isRunning) {
            processingState.status = 'completed';
            addLog('Sentence processing completed successfully!');
            addLog(`Final results - Total: ${processingState.totalLines}, Success: ${processingState.successfulLines}, Failed: ${processingState.failedLines}`);
            addLog(`File processed: ${filePath}`);
        } else {
            processingState.status = 'stopped';
            addLog('Sentence processing stopped by user');
        }
        
        processingState.isRunning = false;
        
    } catch (error) {
        addLog(`Fatal error in ${functionName}`, 'error', error);
        processingState.isRunning = false;
        processingState.status = 'error';
        addLog(`Processing failed for file: ${filePath}`);
    }
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
        
        await runCommand('node', ['batchProcessor.js'], (data) => {
            const output = data.toString().trim();
            addLog(output);
            
            // Extract job name if present
            const jobMatch = output.match(/Job name: (.+)/);
            if (jobMatch) {
                processingState.jobName = jobMatch[1];
            }
        });
        
        processingState.status = 'batch_running';
        addLog('Batch job submitted successfully. Monitoring progress...');
        
        // Simulate batch completion (in real implementation, you'd poll Vertex AI)
        setTimeout(() => {
            if (processingState.isRunning) {
                processingState.status = 'completed';
                processingState.totalLines = 50; // Would get from actual results
                processingState.processedLines = processingState.totalLines;
                processingState.successfulLines = Math.floor(processingState.totalLines * 0.9);
                processingState.failedLines = processingState.totalLines - processingState.successfulLines;
                processingState.isRunning = false;
                
                addLog('Batch processing completed successfully!');
                addLog(`Results: ${processingState.successfulLines} successful, ${processingState.failedLines} failed`);
            }
        }, 10000); // 10 second delay for demo
        
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

// Start server
app.listen(PORT, () => {
    console.log(`Backend server running at http://localhost:${PORT}`);
    console.log('API endpoints:');
    console.log('  POST /api/process/start - Start sentence processing');
    console.log('  POST /api/batch/start - Start batch processing');
    console.log('  GET  /api/status - Get processing status');
    console.log('  POST /api/stop - Stop processing');
    console.log('  GET  /api/download/sql - Download SQL results');
});