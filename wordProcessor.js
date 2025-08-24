import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import config from './config.js';
import ModelClient from './modelClient.js';

class WordProcessor {
    constructor(customDatabasePath = null, customConfig = null, customLogger = null) {
        // Use custom config if provided, otherwise use default config
        const finalConfig = customConfig || config;
        this.modelClient = new ModelClient(finalConfig);
        
        // Set up custom logger if provided
        this.customLogger = customLogger;
        
        // Log the configuration being used
        this.logProgress(`WordProcessor initialized with:`);
        this.logProgress(`  Project ID: ${finalConfig.PROJECT_ID}`);
        this.logProgress(`  Location: ${finalConfig.LOCATION}`);
        this.logProgress(`  Model Endpoint: ${finalConfig.MODEL_ENDPOINT}`);
        this.logProgress(`  Source Language: ${finalConfig.DEFAULT_SOURCE_LANGUAGE}`);
        this.logProgress(`  Target Language: ${finalConfig.DEFAULT_TARGET_LANGUAGE}`);
        this.logProgress(`  Rollback Models: ${JSON.stringify(finalConfig.ROLLBACK_MODELS || [])}`);
        this.logProgress(`  ModelClient rollback models: ${JSON.stringify(this.modelClient.rollbackModels || [])}`);
        this.isProcessing = false;
        this.sqlInsertStatements = [];
        
        // Create timestamped file paths
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.errorLogFile = `logs/errors/word_errors_${timestamp}.log`;
        this.successLogFile = `logs/responses/word_responses_${timestamp}.jsonl`;
        this.sqlOutputFile = `logs/sql/word_results_${timestamp}.sql`;
        this.progressLogFile = `logs/progress/word_progress_${timestamp}.log`;
        
        // Configuration constants
        this.MAX_RETRIES = 5;
        this.RETRY_DELAY_SECONDS = 5000;
        this.DB_NAME = customDatabasePath || 'MudadibFullGemini.db';
        this.TEXT_FILE_PATH = config.TEXT_FILE_PATH;
    }

    async initialize() {
        // Ensure directories exist
        fs.mkdirSync('logs/errors', { recursive: true });
        fs.mkdirSync('logs/responses', { recursive: true });
        fs.mkdirSync('logs/sql', { recursive: true });
        fs.mkdirSync('logs/progress', { recursive: true });
        
        // Add schema creation SQL
        this.sqlInsertStatements.push(this.generateSchemaSQL());
        
        // Initialize log files
        fs.writeFileSync(this.errorLogFile, `Word Processing Error Log - Run: ${new Date().toString()}\n${"=".repeat(40)}\n`, 'utf8');
        fs.writeFileSync(this.successLogFile, `# Log of successfully processed model JSON responses - Run: ${new Date().toString()}\n`, 'utf8');
        fs.appendFileSync(this.successLogFile, `# Each subsequent line is a JSON object: {'queried_word': ..., 'timestamp': ..., 'response_data': ...}\n`, 'utf8');
        fs.writeFileSync(this.progressLogFile, `Word Processing Progress Log - Run: ${new Date().toString()}\n${"=".repeat(40)}\n`, 'utf8');
    }

    stop() {
        this.isProcessing = false;
    }

    logProgress(message) {
        // Use custom logger if provided (for backend integration), otherwise log to console
        if (this.customLogger) {
            this.customLogger(message);
        } else {
            console.log(message);
        }
        
        // Always log to progress file as well
        try {
            const timestamp = new Date().toISOString();
            fs.appendFileSync(this.progressLogFile, `[${timestamp}] ${message}\n`, 'utf8');
        } catch (error) {
            // Silent fail for logging errors to avoid recursion
        }
    }

    getLanguageCode(languageName) {
        // Convert language names to codes (same mapping as sentence processing)
        const languageMap = {
            'German': 'de',
            'English': 'en', 
            'Spanish': 'es',
            'French': 'fr',
            'Italian': 'it',
            'Portuguese': 'pt',
            'Russian': 'ru',
            'Chinese': 'zh',
            'Japanese': 'ja',
            'Korean': 'ko'
        };
        return languageMap[languageName] || languageName.toLowerCase().substring(0, 2);
    }

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

    readAndExtractWordsFromTextFile(filePath) {
        try {
            const text = fs.readFileSync(filePath, 'utf-8').toLowerCase();
            const words = text.match(/\b[a-zäöüßA-ZÄÖÜ]+\b/g) || [];
            const uniqueWords = [...new Set(words)].sort();
            this.logProgress(`Found ${uniqueWords.length} unique words in the text file.`);
            return uniqueWords;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`Error: Text file not found at ${filePath}`);
            } else {
                console.log(`Error reading or processing text file ${filePath}: ${error.message}`);
            }
            return [];
        }
    }

    async getNewWordsNotInDB(wordsFromText, dbPath) {
        if (!wordsFromText || wordsFromText.length === 0) {
            return [];
        }
        
        // Skip database check if no database path provided (No Database option)
        if (!dbPath || dbPath.trim() === '') {
            this.logProgress('No database path provided - processing all words without database check');
            return wordsFromText;
        }
        
        this.logProgress(`Checking words against database: ${dbPath}`);
        
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
                    
                    this.logProgress(`Successfully connected to database: ${dbPath}`);
                    
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
                        
                        this.logProgress(`Identified ${newWordsToQuery.length} words from text file that are potentially new to the database (based on 'word' check).`);
                        
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

    async getTranslationFromModel(originalWordToQuery) {
        // Use the same language pair format as sentence processing
        const sourceLanguageCode = this.getLanguageCode(this.modelClient.sourceLanguage);
        const targetLanguageCode = this.getLanguageCode(this.modelClient.targetLanguage);
        
        // Format: "de-en |word|" or "de-rus |word|" based on current language settings
        const textPrompt = `${sourceLanguageCode}-${targetLanguageCode} |${originalWordToQuery}|`;
        
        try {
            // Call the model directly with the correct prompt format for word processing
            const chat = this.modelClient.ai.chats.create({
                model: this.modelClient.model,
                config: this.modelClient.generationConfig
            });

            const message = { text: textPrompt };
            const response = await chat.sendMessage({ message: [message] });
            
            // Handle streaming response
            let fullResponse = '';
            if (response.text) {
                fullResponse = response.text;
            } else {
                // Handle stream if needed
                for await (const chunk of response) {
                    if (chunk.text) {
                        fullResponse += chunk.text;
                    }
                }
            }
            
            return fullResponse;
        } catch (error) {
            throw error;
        }
    }

    async processWordWithRetries(originalWordToQuery) {
        let fullRawStreamedOutputForLogging = "";
        
        // First try main model with 5 attempts
        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                const fullRawStreamedOutput = await this.getTranslationFromModel(originalWordToQuery);
                fullRawStreamedOutputForLogging = fullRawStreamedOutput;

                if (!fullRawStreamedOutput || !fullRawStreamedOutput.trim()) {
                    if (attempt < this.MAX_RETRIES) {
                        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                        continue;
                    } else {
                        break; // Break out to try rollback models
                    }
                }

                const assistantContentJson = this.parseModelOutputForAssistantContent(fullRawStreamedOutput);

                if (assistantContentJson) {
                    if (this.extractAndGenerateSQLForWord(assistantContentJson, originalWordToQuery, fullRawStreamedOutput)) {
                        try {
                            const logEntry = {
                                queried_word: originalWordToQuery,
                                timestamp: new Date().toISOString(),
                                response_data: assistantContentJson
                            };
                            fs.appendFileSync(this.successLogFile, JSON.stringify(logEntry) + '\n', 'utf8');
                        } catch (logError) {
                            console.log(`Warning: Could not write to successful JSON log: ${logError.message}`);
                        }
                        return true;
                    } else {
                        // Validation failed, continue to retry (don't return false immediately)
                        if (attempt < this.MAX_RETRIES) {
                            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                            continue;
                        } else {
                            break; // Break out to try rollback models
                        }
                    }
                } else {
                    if (attempt < this.MAX_RETRIES) {
                        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                    } else {
                        break; // Break out to try rollback models
                    }
                }
            } catch (error) {
                if (attempt < this.MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                } else {
                    break; // Break out to try rollback models
                }
            }
        }
        
        // If main model failed after 5 attempts, try rollback models
        this.logProgress(`DEBUG: Checking rollback models for word '${originalWordToQuery}': ${JSON.stringify(this.modelClient.rollbackModels || [])}`);
        if (this.modelClient.rollbackModels && this.modelClient.rollbackModels.length > 0) {
            this.logProgress(`🔄 ROLLBACK: Main model failed for word '${originalWordToQuery}', trying rollback models...`);
            
            for (let rollbackIndex = 0; rollbackIndex < this.modelClient.rollbackModels.length; rollbackIndex++) {
                this.logProgress(`🔄 ROLLBACK: Using model ${rollbackIndex + 1}/${this.modelClient.rollbackModels.length} (${this.modelClient.rollbackModels[rollbackIndex]}) for word '${originalWordToQuery}'`);
                
                // Try each rollback model up to 3 times
                for (let rollbackAttempt = 1; rollbackAttempt <= 3; rollbackAttempt++) {
                    try {
                        const fullRawStreamedOutput = await this.modelClient.getSingleTranslation({
                            original_text: originalWordToQuery
                        }, true, rollbackIndex);
                        
                        if (!fullRawStreamedOutput || !fullRawStreamedOutput.trim()) {
                            if (rollbackAttempt < 3) {
                                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                                continue;
                            } else {
                                break; // Move to next rollback model
                            }
                        }

                        const assistantContentJson = this.parseModelOutputForAssistantContent(fullRawStreamedOutput);

                        if (assistantContentJson) {
                            if (this.extractAndGenerateSQLForWord(assistantContentJson, originalWordToQuery, fullRawStreamedOutput)) {
                                try {
                                    const logEntry = {
                                        queried_word: originalWordToQuery,
                                        timestamp: new Date().toISOString(),
                                        response_data: assistantContentJson,
                                        rollback_model: this.modelClient.rollbackModels[rollbackIndex]
                                    };
                                    fs.appendFileSync(this.successLogFile, JSON.stringify(logEntry) + '\n', 'utf8');
                                } catch (logError) {
                                    console.log(`Warning: Could not write to successful JSON log: ${logError.message}`);
                                }
                                this.logProgress(`✅ ROLLBACK SUCCESS: Word '${originalWordToQuery}' processed with rollback model ${rollbackIndex + 1} (${this.modelClient.rollbackModels[rollbackIndex]}) on attempt ${rollbackAttempt}.`);
                                return true;
                            } else {
                                // Validation failed, continue to retry with this rollback model
                                if (rollbackAttempt < 3) {
                                    await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                                    continue; // Try same rollback model again
                                } else {
                                    break; // Move to next rollback model
                                }
                            }
                        } else {
                            if (rollbackAttempt < 3) {
                                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                                continue;
                            } else {
                                break; // Move to next rollback model
                            }
                        }
                    } catch (error) {
                        if (rollbackAttempt < 3) {
                            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                            continue;
                        } else {
                            break; // Move to next rollback model
                        }
                    }
                }
            }
        }
        
        // All models failed
        this.logProgress(`Failed to process word: ${originalWordToQuery} (all models failed after retries)`);
        return false;
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

    saveProgress() {
        fs.writeFileSync(this.sqlOutputFile, this.sqlInsertStatements.join("\n"), 'utf8');
        this.logProgress(`SQL statements saved to ${this.sqlOutputFile}`);
    }

    async processConcurrent(wordsToProcess) {
        const results = {
            successfulWords: 0,
            failedWords: 0,
            processed: 0
        };

        const workers = [];
        const queue = [...wordsToProcess];
        let activeWorkers = 0;

        // this.logProgress(`Starting concurrent processing with ${config.CONCURRENT_WORKERS} workers for ${queue.length} words`);

        // Create worker function
        const processWorker = async (workerId) => {
            activeWorkers++;
            this.logProgress(`Worker ${workerId} started`);

            while (queue.length > 0 && this.isProcessing) {
                const word = queue.shift();
                if (!word) break;

                try {
                    // Minimal logging - worker progress removed
                    
                    const success = await this.processWordWithRetries(word);
                    
                    if (success) {
                        results.successfulWords++;
                    } else {
                        results.failedWords++;
                    }
                    
                    results.processed++;

                    // Save progress periodically
                    if (results.processed % 10 === 0) {
                        this.saveProgress();
                        this.logProgress(`Progress saved after ${results.processed} words`);
                    }

                    // Small delay to prevent overwhelming the API
                    if (queue.length > 0) {
                        await new Promise(resolve => setTimeout(resolve, config.RATE_LIMIT_DELAY));
                    }

                    // Optional: Short delay to avoid hitting rate limits
                    if ((results.processed) % 10 === 0 && wordsToProcess.length > 10) {
                        this.logProgress(`Pausing for ${this.RETRY_DELAY_SECONDS / 1000}s to respect potential rate limits...`);
                        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                    }

                } catch (error) {
                    this.logProgress(`Worker ${workerId}: Error processing word: ${error.message}`);
                    results.failedWords++;
                    results.processed++;
                }
            }

            activeWorkers--;
            this.logProgress(`Worker ${workerId} finished`);
        };

        // Start workers
        for (let i = 0; i < config.CONCURRENT_WORKERS; i++) {
            workers.push(processWorker(i + 1));
            // Stagger worker starts to avoid initial rush
            await new Promise(resolve => setTimeout(resolve, config.RATE_LIMIT_DELAY));
        }

        // Wait for all workers to complete
        await Promise.all(workers);

        // this.logProgress(`Concurrent processing completed: ${results.successfulWords} successful, ${results.failedWords} failed`);
        return results;
    }

    async processFile(filePath = null) {
        const textPath = filePath || this.TEXT_FILE_PATH;
        
        this.isProcessing = true;
        await this.initialize();

        const allWordsFromText = this.readAndExtractWordsFromTextFile(textPath);

        if (allWordsFromText.length === 0) {
            this.logProgress("No words extracted from text file. Exiting.");
            this.isProcessing = false;
            return { success: false, error: "No words extracted from text file" };
        }

        // Check against DB
        const wordsToProcessQuery = await this.getNewWordsNotInDB(allWordsFromText, this.DB_NAME);

        if (wordsToProcessQuery.length === 0) {
            this.logProgress("No new words to process. All extracted words might already be in the database (based on 'word' check).");
            this.saveProgress();
            this.isProcessing = false;
            return { 
                success: true, 
                totalWords: allWordsFromText.length,
                successfulWords: 0,
                failedWords: 0,
                message: "No new words to process"
            };
        }

        this.logProgress(`\nAttempting translation for ${wordsToProcessQuery.length} new/unchecked words and generating SQL inserts:`);
        
        try {
            this.logProgress("GenAI Client initialized successfully.");
            
            // Use concurrent processing
            const results = await this.processConcurrent(wordsToProcessQuery);
            const successfulWords = results.successfulWords;
            const failedWordsCount = results.failedWords;

            this.logProgress(`\n--- Word Processing Summary ---`);
            this.logProgress(`Successfully processed and generated SQL for ${successfulWords} words.`);
            if (failedWordsCount > 0) {
                this.logProgress(`Failed to process ${failedWordsCount} words. Check ${this.errorLogFile}`);
            }
            
            this.saveProgress();
            this.logProgress(`\nAll SQL statements (schema + inserts) saved to ${this.sqlOutputFile}`);
            
            if (wordsToProcessQuery.length > 0 && this.sqlInsertStatements.length <= 1) {
                this.logProgress(`Note: No successful word processing. The SQL file '${this.sqlOutputFile}' might only contain the schema.`);
            }

            this.logProgress(`Error log: ${this.errorLogFile}`);
            this.logProgress(`Successful JSON responses log: ${this.successLogFile}`);
            this.logProgress(`Progress log: ${this.progressLogFile}`);
            this.logProgress("Word processing script finished.");
            
            this.isProcessing = false;
            return {
                success: true,
                totalWords: allWordsFromText.length,
                newWords: wordsToProcessQuery.length,
                successfulWords,
                failedWords: failedWordsCount
            };
            
        } catch (error) {
            this.logProgress(`\nCRITICAL SCRIPT ERROR (word processing): ${error.message}`);
            this.logError("CRITICAL SCRIPT ERROR", error.message);
            this.saveProgress();
            this.isProcessing = false;
            return { success: false, error: error.message };
        }
    }
}

async function main() {
    const processor = new WordProcessor();
    const result = await processor.processFile();
    console.log('Word processing result:', result);
}

// Export for use as module
export default WordProcessor;

// Run the main function if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}