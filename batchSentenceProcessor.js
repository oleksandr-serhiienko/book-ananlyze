import fs from 'fs';
import path from 'path';
import { getLanguageCode } from './constants.js';

class BatchSentenceProcessor {
    constructor() {
        this.isProcessing = false;
        
        // Create timestamped file paths
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.outputFile = `logs/batchSent/batch_output_${timestamp}.jsonl`;
        this.processedCount = 0;
        this.successCount = 0;
        
        // Response processing file paths
        this.sqlOutputFile = `logs/sql/response_sentences_${timestamp}.sql`;
        this.errorLogFile = `logs/errors/response_sentence_errors_${timestamp}.log`;
        this.failedSentencesFile = `logs/batchSent/failed_sentences_retry_${timestamp}.jsonl`;
        this.sqlInsertStatements = [];
        this.failedSentenceEntries = [];
    }

    readUserSettings() {
        try {
            const settingsContent = fs.readFileSync('userSettings.json', 'utf8');
            const settings = JSON.parse(settingsContent);
            return settings.batchProcessing || settings.sentenceProcessing || settings.wordProcessing || {};
        } catch (error) {
            console.warn('Could not read user settings, using defaults');
            return { sourceLanguage: 'German', targetLanguage: 'English' };
        }
    }

    saveLanguageSettings(sourceLanguage, targetLanguage, bookAddress = null) {
        try {
            let settings;
            try {
                const settingsContent = fs.readFileSync('userSettings.json', 'utf8');
                settings = JSON.parse(settingsContent);
            } catch (error) {
                // If file doesn't exist or is invalid, create new structure
                settings = {
                    sentenceProcessing: {},
                    wordProcessing: {},
                    epubProcessing: {},
                    batchProcessing: {}
                };
            }

            // Ensure batchProcessing section exists
            if (!settings.batchProcessing) {
                settings.batchProcessing = {};
            }

            // Update batch processing language settings
            settings.batchProcessing.sourceLanguage = sourceLanguage;
            settings.batchProcessing.targetLanguage = targetLanguage;
            if (bookAddress) {
                settings.batchProcessing.bookAddress = bookAddress;
            }

            // Save updated settings
            fs.writeFileSync('userSettings.json', JSON.stringify(settings, null, 2), 'utf8');
            console.log(`Saved batch language settings: ${sourceLanguage} -> ${targetLanguage}`);
        } catch (error) {
            console.warn('Could not save language settings:', error.message);
        }
    }

    async initialize() {
        // Ensure directories exist
        fs.mkdirSync('logs/batchSent', { recursive: true });
        fs.mkdirSync('logs/sql', { recursive: true });
        fs.mkdirSync('logs/errors', { recursive: true });
        
        // Initialize output file
        fs.writeFileSync(this.outputFile, '', 'utf8');
    }

    stop() {
        this.isProcessing = false;
    }

    async processBatchFile(filePath, sourceLanguage = null, targetLanguage = null) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        await this.initialize();
        
        // Use provided languages or fall back to user settings
        let finalSourceLanguage = sourceLanguage;
        let finalTargetLanguage = targetLanguage;
        
        if (!finalSourceLanguage || !finalTargetLanguage) {
            const userSettings = this.readUserSettings();
            finalSourceLanguage = finalSourceLanguage || userSettings.sourceLanguage || 'German';
            finalTargetLanguage = finalTargetLanguage || userSettings.targetLanguage || 'English';
        }

        // Save the language settings for future use
        this.saveLanguageSettings(finalSourceLanguage, finalTargetLanguage, filePath);
        const sourceCode = getLanguageCode(finalSourceLanguage);
        const targetCode = getLanguageCode(finalTargetLanguage);
        const languagePair = `${sourceCode}-${targetCode}`;
        
        console.log(`Starting batch conversion for: ${filePath}`);
        console.log(`Using language pair: ${languagePair} (${finalSourceLanguage} -> ${finalTargetLanguage})`);
        
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
        
        console.log(`Found ${lines.length} lines to convert`);
        
        this.isProcessing = true;
        this.processedCount = 0;
        this.successCount = 0;

        for (let i = 0; i < lines.length && this.isProcessing; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            
            // Create JSONL entry matching test.jsonl format
            const jsonlEntry = {
                request: {
                    contents: [{
                        role: "user",
                        parts: [{
                            text: `${languagePair} |${line}|`
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.2
                    }
                }
            };
            
            fs.appendFileSync(this.outputFile, JSON.stringify(jsonlEntry) + '\n', 'utf8');
            this.successCount++;
            this.processedCount++;
        }

        const finalStats = {
            total_lines: lines.length,
            processed: this.processedCount,
            successful: this.successCount,
            failed: 0,
            success_rate: '100.00%',
            output_file: this.outputFile
        };

        console.log('\nBatch Conversion Complete:');
        console.log(`Total lines: ${finalStats.total_lines}`);
        console.log(`Processed: ${finalStats.processed}`);
        console.log(`Output file: ${finalStats.output_file}`);

        return finalStats;
    }


    getStats() {
        return {
            processed: this.processedCount,
            successful: this.successCount,
            failed: this.errorCount,
            isProcessing: this.isProcessing
        };
    }

    // Response processing methods
    generateSchemaSQL() {
        const schemaSqls = [
            "PRAGMA foreign_keys = ON;",
            `
        CREATE TABLE IF NOT EXISTS sentences (
            id INTEGER PRIMARY KEY,
            chapter_id INTEGER NOT NULL,
            line_number INTEGER NOT NULL,
            original_text TEXT NOT NULL,
            german_annotated TEXT,
            english_annotated TEXT,
            parse_errors TEXT,
            UNIQUE(chapter_id, line_number)
        );
        `,
            "CREATE INDEX IF NOT EXISTS idx_sentences_chapter ON sentences(chapter_id);",
            "CREATE INDEX IF NOT EXISTS idx_sentences_line ON sentences(chapter_id, line_number);"
        ];
        return schemaSqls.join("\n") + "\n\n";
    }

    escapeSQLString(value) {
        if (value === null || value === undefined) {
            return "NULL";
        }
        return "'" + String(value).replace(/'/g, "''") + "'";
    }

    logError(sentence, reason, rawOutputData = "") {
        let errorMessage = `Sentence: ${sentence}\nReason: ${reason}\n`;
        
        if (typeof rawOutputData === 'object') {
            errorMessage += `Parsed Data (or part of it):\n${JSON.stringify(rawOutputData, null, 2)}\n`;
        } else if (rawOutputData) {
            errorMessage += `Raw Output:\n${rawOutputData}\n`;
        }
        
        errorMessage += "-".repeat(30) + "\n";
        
        fs.appendFileSync(this.errorLogFile, errorMessage, 'utf8');
        console.log(`Logged error for sentence to ${this.errorLogFile}`);
    }

    extractOriginalSentenceFromRequest(requestText) {
        // Extract sentence from request text like "en-rus |sentence|"
        const match = requestText.match(/\|([^|]+)\|/);
        return match ? match[1] : null;
    }

    addFailedSentenceForRetry(originalSentence, originalRequestText) {
        // Create a new JSONL entry for the failed sentence that can be sent for re-batching
        // Extract language pair from original request (e.g., "en-rus |sentence|")
        const languagePairMatch = originalRequestText.match(/^([^|]+)\s*\|/);
        const languagePair = languagePairMatch ? languagePairMatch[1].trim() : 'en-rus';
        
        const retryEntry = {
            request: {
                contents: [{
                    role: "user",
                    parts: [{
                        text: `${languagePair} |${originalSentence}|`
                    }]
                }],
                generationConfig: {
                    temperature: 0.2
                }
            }
        };
        
        this.failedSentenceEntries.push(JSON.stringify(retryEntry));
    }

    extractAndGenerateSQLForSentence(responseJson, originalSentence, rawResponse, chapterId = 1, lineNumber = 1) {
        try {
            // Validate that we have a properly parsed JSON with expected structure
            if (!responseJson || typeof responseJson !== 'object') {
                this.logError(originalSentence, `Invalid or missing JSON content`, rawResponse);
                return false;
            }

            // Check for required fields (original and translated)
            if (!responseJson.hasOwnProperty('original') || !responseJson.hasOwnProperty('translated')) {
                this.logError(originalSentence, `Missing required fields in response (original, translated)`, responseJson);
                return false;
            }

            const originalText = responseJson.original;
            const translatedText = responseJson.translated;

            if (!originalText || !translatedText) {
                this.logError(originalSentence, `Empty original or translated text`, responseJson);
                return false;
            }

            // Simple INSERT into the sentences table
            this.sqlInsertStatements.push(
                `INSERT OR IGNORE INTO sentences (chapter_id, line_number, original_text, german_annotated, english_annotated, parse_errors) VALUES ` +
                `(${chapterId}, ${lineNumber}, ${this.escapeSQLString(originalSentence)}, ${this.escapeSQLString(originalText)}, ${this.escapeSQLString(translatedText)}, NULL);`
            );
            
            return true;

        } catch (error) {
            this.logError(originalSentence, `Unexpected error during SQL generation: ${error.message}`, responseJson);
            return false;
        }
    }

    parseModelOutputForSentence(rawStreamedOutput) {
        try {
            const innerJsonData = JSON.parse(rawStreamedOutput);
            if (!innerJsonData.original || !innerJsonData.translated) {
                throw new Error("Parsed JSON missing required 'original' or 'translated' keys.");
            }
            return innerJsonData;
        } catch (jsonError) {
            console.log(`Failed to parse direct output as JSON: ${jsonError.message}`);
            console.log(`Problematic string was:\n${rawStreamedOutput}`);
            return null;
        }
    }

    async processVertexAIResponseFile(responseFilePath) {
        if (!fs.existsSync(responseFilePath)) {
            throw new Error(`Response file not found: ${responseFilePath}`);
        }

        await this.initialize();
        
        // Initialize error log
        fs.writeFileSync(this.errorLogFile, `Sentence Response Processing Error Log - Run: ${new Date().toString()}\n${"=".repeat(50)}\n`, 'utf8');
        
        // Add schema creation SQL
        this.sqlInsertStatements.push(this.generateSchemaSQL());
        
        console.log(`Processing Vertex AI sentence responses from: ${responseFilePath}`);
        
        const fileContent = fs.readFileSync(responseFilePath, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
        
        console.log(`Found ${lines.length} response entries to process`);
        
        let processedCount = 0;
        let successCount = 0;
        let failedCount = 0;
        
        for (const line of lines) {
            try {
                const responseEntry = JSON.parse(line);
                
                // Extract original sentence from request
                const requestText = responseEntry.request?.contents?.[0]?.parts?.[0]?.text;
                if (!requestText) {
                    console.log(`Skipping entry - no request text found`);
                    failedCount++;
                    continue;
                }
                
                const originalSentence = this.extractOriginalSentenceFromRequest(requestText);
                if (!originalSentence) {
                    console.log(`Skipping entry - could not extract sentence from request: ${requestText}`);
                    failedCount++;
                    continue;
                }
                
                // Extract response text
                const responseText = responseEntry.response?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!responseText) {
                    this.logError(originalSentence, "No response text found in entry", responseEntry);
                    this.addFailedSentenceForRetry(originalSentence, requestText);
                    failedCount++;
                    continue;
                }
                
                // Parse the response using the new sentence logic
                const responseJson = this.parseModelOutputForSentence(responseText);
                
                if (responseJson) {
                    // Use incremental chapter and line numbers for now
                    const chapterId = Math.floor(processedCount / 100) + 1;
                    const lineNumber = (processedCount % 100) + 1;
                    
                    if (this.extractAndGenerateSQLForSentence(responseJson, originalSentence, responseText, chapterId, lineNumber)) {
                        successCount++;
                        console.log(`\u2705 Successfully processed sentence ${processedCount + 1}`);
                    } else {
                        this.addFailedSentenceForRetry(originalSentence, requestText);
                        failedCount++;
                        console.log(`\u274c Failed validation for sentence ${processedCount + 1}`);
                    }
                } else {
                    this.logError(originalSentence, "Failed to parse response text as valid JSON", responseText);
                    this.addFailedSentenceForRetry(originalSentence, requestText);
                    failedCount++;
                    console.log(`\u274c Failed parsing for sentence ${processedCount + 1}`);
                }
                
                processedCount++;
                
            } catch (error) {
                console.log(`Error processing line: ${error.message}`);
                failedCount++;
            }
        }
        
        // Save SQL results
        fs.writeFileSync(this.sqlOutputFile, this.sqlInsertStatements.join("\n"), 'utf8');
        
        // Save failed sentences for retry if there are any
        let failedSentencesFile = null;
        if (this.failedSentenceEntries.length > 0) {
            fs.writeFileSync(this.failedSentencesFile, this.failedSentenceEntries.join('\n'), 'utf8');
            failedSentencesFile = this.failedSentencesFile;
            console.log(`\n\u26a0\ufe0f Created retry file with ${this.failedSentenceEntries.length} failed sentences: ${failedSentencesFile}`);
        }
        
        const results = {
            total_entries: lines.length,
            processed: processedCount,
            successful: successCount,
            failed: failedCount,
            success_rate: successCount > 0 ? ((successCount / processedCount) * 100).toFixed(2) + '%' : '0.00%',
            sql_output_file: this.sqlOutputFile,
            error_log_file: this.errorLogFile,
            failed_sentences_retry_file: failedSentencesFile,
            failed_sentences_count: this.failedSentenceEntries.length
        };
        
        console.log('\nVertex AI Sentence Response Processing Complete:');
        console.log(`Total entries: ${results.total_entries}`);
        console.log(`Processed: ${results.processed}`);
        console.log(`Successful: ${results.successful}`);
        console.log(`Failed: ${results.failed}`);
        console.log(`Success rate: ${results.success_rate}`);
        console.log(`SQL output: ${results.sql_output_file}`);
        console.log(`Error log: ${results.error_log_file}`);
        if (results.failed_sentences_retry_file) {
            console.log(`Failed sentences retry file: ${results.failed_sentences_retry_file} (${results.failed_sentences_count} entries)`);
        }
        
        return results;
    }
}

export default BatchSentenceProcessor;