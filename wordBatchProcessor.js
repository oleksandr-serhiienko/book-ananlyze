import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { getLanguageCode } from './constants.js';

class WordBatchProcessor {
    constructor() {
        this.isProcessing = false;
        
        // Create timestamped file paths
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.outputFile = `logs/batchWords/batch_words_${timestamp}.jsonl`;
        this.processedCount = 0;
        this.successCount = 0;
        this.skippedCount = 0;
        
        // Response processing file paths
        this.sqlOutputFile = `logs/sql/response_words_${timestamp}.sql`;
        this.errorLogFile = `logs/errors/response_word_errors_${timestamp}.log`;
        this.failedWordsFile = `logs/batchWords/failed_words_retry_${timestamp}.jsonl`;
        this.sqlInsertStatements = [];
        this.failedWordEntries = [];
    }

    async initialize() {
        // Ensure directories exist
        fs.mkdirSync('logs/batchWords', { recursive: true });
        fs.mkdirSync('logs/sql', { recursive: true });
        fs.mkdirSync('logs/errors', { recursive: true });
        
        // Initialize output file
        fs.writeFileSync(this.outputFile, '', 'utf8');
    }

    readUserSettings() {
        try {
            const settingsContent = fs.readFileSync('userSettings.json', 'utf8');
            const settings = JSON.parse(settingsContent);
            return settings.wordBatchProcessing || settings.wordProcessing || {};
        } catch (error) {
            console.warn('Could not read user settings, using defaults');
            return { sourceLanguage: 'German', targetLanguage: 'English', databasePath: '' };
        }
    }

    saveSettings(sourceLanguage, targetLanguage, databasePath, bookAddress = null) {
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
                    batchProcessing: {},
                    wordBatchProcessing: {}
                };
            }

            // Ensure wordBatchProcessing section exists
            if (!settings.wordBatchProcessing) {
                settings.wordBatchProcessing = {};
            }

            // Update word batch processing settings
            settings.wordBatchProcessing.sourceLanguage = sourceLanguage;
            settings.wordBatchProcessing.targetLanguage = targetLanguage;
            settings.wordBatchProcessing.databasePath = databasePath;
            if (bookAddress) {
                settings.wordBatchProcessing.bookAddress = bookAddress;
            }

            // Save updated settings
            fs.writeFileSync('userSettings.json', JSON.stringify(settings, null, 2), 'utf8');
            console.log(`Saved word batch settings: ${sourceLanguage} -> ${targetLanguage}, DB: ${databasePath}`);
        } catch (error) {
            console.warn('Could not save word batch settings:', error.message);
        }
    }

    extractUniqueWordsFromText(filePath) {
        try {
            const text = fs.readFileSync(filePath, 'utf-8').toLowerCase();
            const words = text.match(/\b[a-zäöüßA-ZÄÖÜ]+\b/g) || [];
            const uniqueWords = [...new Set(words)].sort();
            console.log(`Found ${uniqueWords.length} unique words in the text file.`);
            return uniqueWords;
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`Text file not found: ${filePath}`);
            } else {
                throw new Error(`Error reading text file: ${error.message}`);
            }
        }
    }

    async getNewWordsNotInDB(wordsFromText, dbPath) {
        if (!wordsFromText || wordsFromText.length === 0) {
            return [];
        }
        
        // Skip database check if no database path provided
        if (!dbPath || dbPath.trim() === '') {
            console.log('No database path provided - processing all words without database check');
            return wordsFromText;
        }
        
        console.log(`Checking words against database: ${dbPath}`);
        
        return new Promise((resolve, reject) => {
            const newWordsToQuery = [];
            
            try {
                const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
                    if (err) {
                        console.log(`Database connection error for ${dbPath}: ${err.message}`);
                        console.log("Proceeding to query all words from text file, as DB check failed.");
                        resolve(wordsFromText);
                        return;
                    }
                    
                    console.log(`Successfully connected to database: ${dbPath}`);
                    
                    db.all("SELECT DISTINCT word FROM words", (err, rows) => {
                        if (err) {
                            console.log(`Database operational error (e.g., table 'words' not found during check): ${err.message}`);
                            console.log("Proceeding to query all words from text file, as DB check failed.");
                            db.close();
                            resolve(wordsFromText);
                            return;
                        }
                        
                        const existingQueriedWords = new Set(rows.map(row => row.word.toLowerCase()));
                        
                        for (const word of wordsFromText) {
                            if (!existingQueriedWords.has(word.toLowerCase())) {
                                newWordsToQuery.push(word);
                            }
                        }
                        
                        console.log(`Identified ${newWordsToQuery.length} words from text file that are potentially new to the database (based on 'word' check).`);
                        console.log(`Skipped ${wordsFromText.length - newWordsToQuery.length} words already in database.`);
                        
                        db.close((err) => {
                            if (err) {
                                console.log(`Error closing database: ${err.message}`);
                            }
                            resolve(newWordsToQuery);
                        });
                    });
                });
            } catch (error) {
                console.log(`SQLite error when checking words in DB: ${error.message}`);
                resolve(wordsFromText);
            }
        });
    }

    stop() {
        this.isProcessing = false;
    }

    async processBatchFile(filePath, sourceLanguage = null, targetLanguage = null, databasePath = null) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        await this.initialize();
        
        // Use provided settings or fall back to user settings
        let finalSourceLanguage = sourceLanguage;
        let finalTargetLanguage = targetLanguage;
        let finalDatabasePath = databasePath;
        
        if (!finalSourceLanguage || !finalTargetLanguage) {
            const userSettings = this.readUserSettings();
            finalSourceLanguage = finalSourceLanguage || userSettings.sourceLanguage || 'German';
            finalTargetLanguage = finalTargetLanguage || userSettings.targetLanguage || 'English';
            finalDatabasePath = finalDatabasePath || userSettings.databasePath || '';
        }

        // Save the settings for future use
        this.saveSettings(finalSourceLanguage, finalTargetLanguage, finalDatabasePath, filePath);
        
        const sourceCode = getLanguageCode(finalSourceLanguage);
        const targetCode = getLanguageCode(finalTargetLanguage);
        const languagePair = `${sourceCode}-${targetCode}`;
        
        console.log(`Starting word batch conversion for: ${filePath}`);
        console.log(`Using language pair: ${languagePair} (${finalSourceLanguage} -> ${finalTargetLanguage})`);
        if (finalDatabasePath) {
            console.log(`Database path: ${finalDatabasePath}`);
        }
        
        // Extract unique words from text file
        const allWords = this.extractUniqueWordsFromText(filePath);
        
        if (allWords.length === 0) {
            throw new Error('No words found in the text file');
        }
        
        // Check against database and get only new words
        const newWords = await this.getNewWordsNotInDB(allWords, finalDatabasePath);
        
        if (newWords.length === 0) {
            console.log('No new words to process. All words are already in the database.');
            return {
                total_words: allWords.length,
                new_words: 0,
                processed: 0,
                successful: 0,
                skipped: allWords.length,
                success_rate: 'N/A - no new words',
                output_file: this.outputFile
            };
        }
        
        console.log(`Found ${newWords.length} new words to convert to JSONL`);
        
        this.isProcessing = true;
        this.processedCount = 0;
        this.successCount = 0;
        this.skippedCount = allWords.length - newWords.length;

        for (let i = 0; i < newWords.length && this.isProcessing; i++) {
            const word = newWords[i].trim();
            if (!word) continue;

            // Create JSONL entry matching word processing format
            const jsonlEntry = {
                request: {
                    contents: [{
                        role: "user",
                        parts: [{
                            text: `${languagePair} |${word}|`
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.1
                    }
                }
            };
            
            fs.appendFileSync(this.outputFile, JSON.stringify(jsonlEntry) + '\n', 'utf8');
            this.successCount++;
            this.processedCount++;
        }

        const finalStats = {
            total_words: allWords.length,
            new_words: newWords.length,
            processed: this.processedCount,
            successful: this.successCount,
            skipped: this.skippedCount,
            success_rate: this.successCount > 0 ? ((this.successCount / newWords.length) * 100).toFixed(2) + '%' : '0.00%',
            output_file: this.outputFile
        };

        console.log('\nWord Batch Conversion Complete:');
        console.log(`Total words found: ${finalStats.total_words}`);
        console.log(`New words (not in DB): ${finalStats.new_words}`);
        console.log(`Processed: ${finalStats.processed}`);
        console.log(`Skipped (already in DB): ${finalStats.skipped}`);
        console.log(`Output file: ${finalStats.output_file}`);

        return finalStats;
    }

    getStats() {
        return {
            processed: this.processedCount,
            successful: this.successCount,
            skipped: this.skippedCount,
            isProcessing: this.isProcessing
        };
    }

    // Response processing methods
    generateSchemaSQL() {
        const schemaSqls = [
            "PRAGMA foreign_keys = ON;",
            `
        CREATE TABLE IF NOT EXISTS words (
            id INTEGER PRIMARY KEY,
            word TEXT NOT NULL,
            base_form TEXT,
            wordInfo TEXT,
            UNIQUE(word)
        );
        `,
            "CREATE INDEX IF NOT EXISTS idx_words_word ON words(word);"
        ];
        return schemaSqls.join("\n") + "\n\n";
    }

    escapeSQLString(value) {
        if (value === null || value === undefined) {
            return "NULL";
        }
        return "'" + String(value).replace(/'/g, "''") + "'";
    }

    transformExampleText(text) {
        if (!text) return null;
        return text.replace(/\|([^|]+)\|/g, '<em>$1</em>');
    }

    logError(wordQuery, reason, rawOutputData = "") {
        let errorMessage = `Word: ${wordQuery}\nReason: ${reason}\n`;
        
        if (typeof rawOutputData === 'object') {
            errorMessage += `Parsed Data (or part of it):\n${JSON.stringify(rawOutputData, null, 2)}\n`;
        } else if (rawOutputData) {
            errorMessage += `Raw Output:\n${rawOutputData}\n`;
        }
        
        errorMessage += "-".repeat(30) + "\n";
        
        fs.appendFileSync(this.errorLogFile, errorMessage, 'utf8');
        console.log(`Logged error for '${wordQuery}' to ${this.errorLogFile}`);
    }

    extractOriginalWordFromRequest(requestText) {
        // Extract word from request text like "en-rus |mauritius|"
        const match = requestText.match(/\|([^|]+)\|/);
        return match ? match[1] : null;
    }

    addFailedWordForRetry(originalWord, originalRequestText) {
        // Create a new JSONL entry for the failed word that can be sent for re-batching
        // Extract language pair from original request (e.g., "en-rus |word|")
        const languagePairMatch = originalRequestText.match(/^([^|]+)\s*\|/);
        const languagePair = languagePairMatch ? languagePairMatch[1].trim() : 'en-rus';
        
        const retryEntry = {
            request: {
                contents: [{
                    role: "user",
                    parts: [{
                        text: `${languagePair} |${originalWord}|`
                    }]
                }],
                generationConfig: {
                    temperature: 0.1
                }
            }
        };
        
        this.failedWordEntries.push(JSON.stringify(retryEntry));
    }

    extractAndGenerateSQLForWord(assistantContentJson, originalQueriedWord, rawResponse) {
        try {
            // Validate that we have a properly parsed JSON with expected structure
            if (!assistantContentJson || typeof assistantContentJson !== 'object') {
                this.logError(originalQueriedWord, `Invalid or missing JSON content`, rawResponse);
                return false;
            }

            // Validate expected JSON structure
            const wordInfoFromModel = assistantContentJson.word_info;
            if (!wordInfoFromModel || typeof wordInfoFromModel !== 'object') {
                this.logError(originalQueriedWord, `Missing or invalid word_info in JSON response`, assistantContentJson);
                return false;
            }

            // Check for required fields in word_info
            if (!wordInfoFromModel.hasOwnProperty('base_form') || 
                !wordInfoFromModel.hasOwnProperty('definition') || 
                !wordInfoFromModel.hasOwnProperty('additional_info')) {
                this.logError(originalQueriedWord, `Missing required fields in word_info (base_form, definition, additional_info)`, assistantContentJson);
                return false;
            }

            // Validate translations array
            if (!assistantContentJson.translations || !Array.isArray(assistantContentJson.translations)) {
                this.logError(originalQueriedWord, `Missing or invalid translations array in JSON response`, assistantContentJson);
                return false;
            }
            
            // Extract base_form - handle both string and object formats
            let baseForm = null;
            if (wordInfoFromModel.base_form) {
                if (typeof wordInfoFromModel.base_form === 'string') {
                    baseForm = wordInfoFromModel.base_form;
                } else if (typeof wordInfoFromModel.base_form === 'object') {
                    // If it's an object, try to extract a meaningful string value
                    const baseFormObj = wordInfoFromModel.base_form;
                    // Try common keys first, then fall back to first value
                    baseForm = baseFormObj.nominative || baseFormObj.infinitive || 
                              baseFormObj.form || Object.values(baseFormObj)[0] || 
                              JSON.stringify(baseFormObj);
                }
            }

            // Parse and process the raw response to add <em> tags to examples
            let processedResponse;
            try {
                const responseData = JSON.parse(rawResponse);
                
                // Process examples in translations to add <em> tags
                if (responseData.translations && Array.isArray(responseData.translations)) {
                    responseData.translations.forEach(translation => {
                        if (translation.examples && Array.isArray(translation.examples)) {
                            translation.examples.forEach(example => {
                                // Validate that source and target contain pipe markers |word|
                                if (example.source) {
                                    if (!example.source.includes('|')) {
                                        this.logError(originalQueriedWord, `Source text missing pipe markers: ${example.source}`, responseData);
                                        throw new Error('Source text missing required pipe markers');
                                    }
                                    example.source = this.transformExampleText(example.source);
                                }
                                if (example.target) {
                                    if (!example.target.includes('|')) {
                                        this.logError(originalQueriedWord, `Target text missing pipe markers: ${example.target}`, responseData);
                                        throw new Error('Target text missing required pipe markers');
                                    }
                                    example.target = this.transformExampleText(example.target);
                                }
                            });
                        }
                    });
                }
                
                processedResponse = JSON.stringify(responseData);
            } catch (jsonError) {
                if (jsonError.message.includes('pipe markers')) {
                    this.logError(originalQueriedWord, `Response validation failed: ${jsonError.message}`, rawResponse);
                } else {
                    this.logError(originalQueriedWord, `Raw response is not valid JSON: ${jsonError.message}`, rawResponse);
                }
                return false;
            }

            // Simple INSERT into the single words table
            this.sqlInsertStatements.push(
                `INSERT OR IGNORE INTO words (word, base_form, wordInfo) VALUES ` +
                `(${this.escapeSQLString(originalQueriedWord)}, ${this.escapeSQLString(baseForm)}, ${this.escapeSQLString(processedResponse)});`
            );
            
            return true;

        } catch (error) {
            this.logError(originalQueriedWord, `Unexpected error during SQL generation: ${error.message}`, assistantContentJson);
            return false;
        }
    }

    parseModelOutputForAssistantContent(rawStreamedOutput) {
        try {
            const innerJsonData = JSON.parse(rawStreamedOutput);
            if (!innerJsonData.word_info) {
                throw new Error("Parsed JSON missing required 'word_info' key.");
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
        fs.writeFileSync(this.errorLogFile, `Response Processing Error Log - Run: ${new Date().toString()}\n${"+".repeat(50)}\n`, 'utf8');
        
        // Add schema creation SQL
        this.sqlInsertStatements.push(this.generateSchemaSQL());
        
        console.log(`Processing Vertex AI responses from: ${responseFilePath}`);
        
        const fileContent = fs.readFileSync(responseFilePath, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
        
        console.log(`Found ${lines.length} response entries to process`);
        
        let processedCount = 0;
        let successCount = 0;
        let failedCount = 0;
        
        for (const line of lines) {
            try {
                const responseEntry = JSON.parse(line);
                
                // Extract original word from request
                const requestText = responseEntry.request?.contents?.[0]?.parts?.[0]?.text;
                if (!requestText) {
                    console.log(`Skipping entry - no request text found`);
                    failedCount++;
                    continue;
                }
                
                const originalWord = this.extractOriginalWordFromRequest(requestText);
                if (!originalWord) {
                    console.log(`Skipping entry - could not extract word from request: ${requestText}`);
                    failedCount++;
                    continue;
                }
                
                // Extract response text
                const responseText = responseEntry.response?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!responseText) {
                    this.logError(originalWord, "No response text found in entry", responseEntry);
                    this.addFailedWordForRetry(originalWord, requestText);
                    failedCount++;
                    continue;
                }
                
                // Parse the response using the same logic as wordProcessor
                const assistantContentJson = this.parseModelOutputForAssistantContent(responseText);
                
                if (assistantContentJson) {
                    if (this.extractAndGenerateSQLForWord(assistantContentJson, originalWord, responseText)) {
                        successCount++;
                        //console.log(`✅ Successfully processed: ${originalWord}`);
                    } else {
                        this.addFailedWordForRetry(originalWord, requestText);
                        failedCount++;
                        //console.log(`❌ Failed validation for: ${originalWord}`);
                    }
                } else {
                    this.logError(originalWord, "Failed to parse response text as valid JSON", responseText);
                    this.addFailedWordForRetry(originalWord, requestText);
                    failedCount++;
                    //console.log(`❌ Failed parsing for: ${originalWord}`);
                }
                
                processedCount++;
                
            } catch (error) {
                console.log(`Error processing line: ${error.message}`);
                failedCount++;
            }
        }
        
        // Save SQL results
        fs.writeFileSync(this.sqlOutputFile, this.sqlInsertStatements.join("\n"), 'utf8');
        
        // Save failed words for retry if there are any
        let failedWordsFile = null;
        if (this.failedWordEntries.length > 0) {
            fs.writeFileSync(this.failedWordsFile, this.failedWordEntries.join('\n'), 'utf8');
            failedWordsFile = this.failedWordsFile;
            console.log(`\n⚠️ Created retry file with ${this.failedWordEntries.length} failed words: ${failedWordsFile}`);
        }
        
        const results = {
            total_entries: lines.length,
            processed: processedCount,
            successful: successCount,
            failed: failedCount,
            success_rate: successCount > 0 ? ((successCount / processedCount) * 100).toFixed(2) + '%' : '0.00%',
            sql_output_file: this.sqlOutputFile,
            error_log_file: this.errorLogFile,
            failed_words_retry_file: failedWordsFile,
            failed_words_count: this.failedWordEntries.length
        };
        
        console.log('\nVertex AI Response Processing Complete:');
        console.log(`Total entries: ${results.total_entries}`);
        console.log(`Processed: ${results.processed}`);
        console.log(`Successful: ${results.successful}`);
        console.log(`Failed: ${results.failed}`);
        console.log(`Success rate: ${results.success_rate}`);
        console.log(`SQL output: ${results.sql_output_file}`);
        console.log(`Error log: ${results.error_log_file}`);
        if (results.failed_words_retry_file) {
            console.log(`Failed words retry file: ${results.failed_words_retry_file} (${results.failed_words_count} entries)`);
        }
        
        return results;
    }
}

export default WordBatchProcessor;