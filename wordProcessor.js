import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import config from './config.js';
import ModelClient from './modelClient.js';

class WordProcessor {
    constructor(customDatabasePath = null) {
        this.modelClient = new ModelClient(config);
        this.isProcessing = false;
        this.sqlInsertStatements = [];
        
        // Create timestamped file paths
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.errorLogFile = `logs/errors/word_errors_${timestamp}.log`;
        this.successLogFile = `logs/responses/word_responses_${timestamp}.jsonl`;
        this.sqlOutputFile = `logs/sql/word_results_${timestamp}.sql`;
        
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
        
        // Add schema creation SQL
        this.sqlInsertStatements.push(this.generateSchemaSQL());
        
        // Initialize log files
        fs.writeFileSync(this.errorLogFile, `Word Processing Error Log - Run: ${new Date().toString()}\n${"=".repeat(40)}\n`, 'utf8');
        fs.writeFileSync(this.successLogFile, `# Log of successfully processed model JSON responses - Run: ${new Date().toString()}\n`, 'utf8');
        fs.appendFileSync(this.successLogFile, `# Each subsequent line is a JSON object: {'queried_word': ..., 'timestamp': ..., 'response_data': ...}\n`, 'utf8');
    }

    stop() {
        this.isProcessing = false;
    }

    generateSchemaSQL() {
        const schemaSqls = [
            "PRAGMA foreign_keys = ON;",
            `
        CREATE TABLE IF NOT EXISTS words (
            word_id INTEGER PRIMARY KEY,
            queried_word TEXT NOT NULL,
            base_form_json JSON NOT NULL,
            primary_type TEXT, 
            info_json JSON,
            UNIQUE(queried_word)
        );
        `,
            `
        CREATE TABLE IF NOT EXISTS word_translations (
            translation_id INTEGER PRIMARY KEY,
            word_id INTEGER NOT NULL,
            meaning TEXT NOT NULL,
            additional_info TEXT,
            meta_type TEXT, 
            FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
        );
        `,
            `
        CREATE TABLE IF NOT EXISTS translation_examples (
            example_id INTEGER PRIMARY KEY,
            translation_id INTEGER NOT NULL,
            source_text TEXT NOT NULL,
            target_text TEXT NOT NULL,
            FOREIGN KEY (translation_id) REFERENCES word_translations(translation_id) ON DELETE CASCADE
        );
        `,
            "CREATE INDEX IF NOT EXISTS idx_words_queried_word ON words(queried_word);",
            "CREATE INDEX IF NOT EXISTS idx_word_translations_word_id ON word_translations(word_id);",
            "CREATE INDEX IF NOT EXISTS idx_translation_examples_translation_id ON translation_examples(translation_id);"
        ];
        return schemaSqls.join("\n") + "\n\n";
    }

    readAndExtractWordsFromTextFile(filePath) {
        try {
            const text = fs.readFileSync(filePath, 'utf-8').toLowerCase();
            const words = text.match(/\b[a-zäöüßA-ZÄÖÜ]+\b/g) || [];
            const uniqueWords = [...new Set(words)].sort();
            console.log(`Found ${uniqueWords.length} unique words in the text file.`);
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
                    
                    db.all("SELECT DISTINCT queried_word FROM words", (err, rows) => {
                        if (err) {
                            console.log(`Database operational error (e.g., table 'words' not found during check): ${err.message}`);
                            console.log("Proceeding to query all words from text file, as DB check failed.");
                            db.close();
                            resolve(wordsFromText);
                            return;
                        }
                        
                        const existingQueriedWords = new Set(rows.map(row => row.queried_word.toLowerCase()));
                        
                        for (const word of wordsFromText) {
                            if (!existingQueriedWords.has(word.toLowerCase())) {
                                newWordsToQuery.push(word);
                            }
                        }
                        
                        console.log(`Identified ${newWordsToQuery.length} words from text file that are potentially new to the database (based on 'queried_word' check).`);
                        
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

    extractAndGenerateSQLForWord(assistantContentJson, originalQueriedWord) {
        try {
            const wordInfoFromModel = assistantContentJson.word_info;
            const allTranslationsFromModel = assistantContentJson.translations || [];

            const dbQueriedWord = originalQueriedWord;
            const dbBaseFormJsonStr = JSON.stringify(wordInfoFromModel.base_form);
            const dbInfoJsonStr = JSON.stringify(wordInfoFromModel.additional_info);
            
            let dbPrimaryType = null;
            const baseFormContent = wordInfoFromModel.base_form;
            
            if (typeof baseFormContent === 'object' && baseFormContent !== null) {
                const typesPresent = Object.keys(baseFormContent);
                if (typesPresent.length > 0) {
                    dbPrimaryType = typesPresent.sort().join("/");
                }
            } else if (typeof baseFormContent === 'string') {
                const additionalInfoContent = wordInfoFromModel.additional_info;
                if (typeof additionalInfoContent === 'object' && additionalInfoContent !== null) {
                    if (additionalInfoContent.type) {
                        dbPrimaryType = additionalInfoContent.type;
                    } else if (additionalInfoContent.usage && !dbPrimaryType) {
                        dbPrimaryType = additionalInfoContent.usage;
                    }
                }
            }
            
            if (!dbPrimaryType) dbPrimaryType = "unknown";

            this.sqlInsertStatements.push(
                `INSERT OR IGNORE INTO words (queried_word, base_form_json, primary_type, info_json) VALUES ` +
                `(${this.escapeSQLString(dbQueriedWord)}, ${this.escapeSQLString(dbBaseFormJsonStr)}, ${this.escapeSQLString(dbPrimaryType)}, ${this.escapeSQLString(dbInfoJsonStr)});`
            );
            
            const wordIdSubquery = `(SELECT word_id FROM words WHERE queried_word = ${this.escapeSQLString(dbQueriedWord)})`;
            
            for (const transData of allTranslationsFromModel) {
                const meaning = transData.meaning;
                const additionalInfoTrans = transData.additionalInfo;
                const metaTypeTrans = transData.type;

                if (!meaning) {
                    this.logError(originalQueriedWord, `Skipping a translation due to missing meaning key or null value.`, transData);
                    continue;
                }

                this.sqlInsertStatements.push(
                    `INSERT INTO word_translations (word_id, meaning, additional_info, meta_type) VALUES ` +
                    `(${wordIdSubquery}, ${this.escapeSQLString(meaning)}, ${this.escapeSQLString(additionalInfoTrans)}, ${this.escapeSQLString(metaTypeTrans)});`
                );
                
                const translationIdSubquery = (
                    `(SELECT translation_id FROM word_translations WHERE word_id = ${wordIdSubquery} ` +
                    `AND meaning = ${this.escapeSQLString(meaning)} ` +
                    `AND COALESCE(additional_info, 'NULL_MARKER') = COALESCE(${this.escapeSQLString(additionalInfoTrans)}, 'NULL_MARKER') ` +
                    `AND COALESCE(meta_type, 'NULL_MARKER') = COALESCE(${this.escapeSQLString(metaTypeTrans)}, 'NULL_MARKER') ` +
                    `ORDER BY translation_id DESC LIMIT 1)`
                );

                for (const exData of transData.examples || []) {
                    const sourceTextRaw = exData.source;
                    const targetTextRaw = exData.target;

                    if (sourceTextRaw && targetTextRaw) {
                        const sourceTextTransformed = this.transformExampleText(sourceTextRaw);
                        const targetTextTransformed = this.transformExampleText(targetTextRaw);

                        this.sqlInsertStatements.push(
                            `INSERT INTO translation_examples (translation_id, source_text, target_text) VALUES ` +
                            `(${translationIdSubquery}, ${this.escapeSQLString(sourceTextTransformed)}, ${this.escapeSQLString(targetTextTransformed)});`
                        );
                    }
                }
            }
            
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
        const textPrompt = `de-en? ${originalWordToQuery}`;
        
        // Create a mock lineData object for compatibility with ModelClient
        const mockLineData = {
            original_text: textPrompt
        };
        
        try {
            const rawModelOutput = await this.modelClient.getSingleTranslation(mockLineData);
            return rawModelOutput;
        } catch (error) {
            throw error;
        }
    }

    async processWordWithRetries(originalWordToQuery) {
        let fullRawStreamedOutputForLogging = "";
        
        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            console.log(`Processing '${originalWordToQuery}', Attempt ${attempt}/${this.MAX_RETRIES}...`);
            
            try {
                const fullRawStreamedOutput = await this.getTranslationFromModel(originalWordToQuery);
                fullRawStreamedOutputForLogging = fullRawStreamedOutput;

                if (!fullRawStreamedOutput || !fullRawStreamedOutput.trim()) {
                    console.log(`No content received from model for '${originalWordToQuery}' on attempt ${attempt}.`);
                    if (attempt < this.MAX_RETRIES) {
                        console.log(`Retrying in ${this.RETRY_DELAY_SECONDS / 1000} seconds...`);
                        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                        continue;
                    } else {
                        this.logError(originalWordToQuery, "No content from model after max retries.", fullRawStreamedOutputForLogging);
                        return false;
                    }
                }

                const assistantContentJson = this.parseModelOutputForAssistantContent(fullRawStreamedOutput);

                if (assistantContentJson) {
                    console.log(`Successfully parsed model output for '${originalWordToQuery}' on attempt ${attempt}.`);
                    if (this.extractAndGenerateSQLForWord(assistantContentJson, originalWordToQuery)) {
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
                        console.log(`Failed to generate SQL for '${originalWordToQuery}' (logged).`);
                        return false;
                    }
                } else {
                    console.log(`Failed to parse model output for '${originalWordToQuery}' on attempt ${attempt} (parser returned None).`);
                    if (attempt < this.MAX_RETRIES) {
                        console.log(`Retrying API call and parsing in ${this.RETRY_DELAY_SECONDS / 1000} seconds...`);
                        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                    } else {
                        this.logError(originalWordToQuery, "Failed to parse model output after max retries (parser returned None).", fullRawStreamedOutputForLogging);
                        return false;
                    }
                }
            } catch (error) {
                console.log(`Unexpected error processing '${originalWordToQuery}' on attempt ${attempt}: ${error.message}`);
                if (attempt < this.MAX_RETRIES) {
                    console.log(`Retrying in ${this.RETRY_DELAY_SECONDS / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                } else {
                    this.logError(originalWordToQuery, `Unexpected error after max retries: ${error.message}`, fullRawStreamedOutputForLogging || "No raw output captured due to early exception.");
                    return false;
                }
            }
        }
        
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
        console.log(`SQL statements saved to ${this.sqlOutputFile}`);
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

        console.log(`Starting concurrent processing with ${config.CONCURRENT_WORKERS} workers for ${queue.length} words`);

        // Create worker function
        const processWorker = async (workerId) => {
            activeWorkers++;
            console.log(`Worker ${workerId} started`);

            while (queue.length > 0 && this.isProcessing) {
                const word = queue.shift();
                if (!word) break;

                try {
                    console.log(`Worker ${workerId}: Processing '${word}' (${results.processed + 1}/${wordsToProcess.length})`);
                    
                    const success = await this.processWordWithRetries(word);
                    
                    if (success) {
                        results.successfulWords++;
                        console.log(`Successfully processed and generated SQL for '${word}'.`);
                    } else {
                        results.failedWords++;
                        console.log(`Failed to process '${word}' after retries.`);
                    }
                    
                    results.processed++;

                    // Save progress periodically
                    if (results.processed % 10 === 0) {
                        this.saveProgress();
                        console.log(`Progress saved after ${results.processed} words`);
                    }

                    // Small delay to prevent overwhelming the API
                    if (queue.length > 0) {
                        await new Promise(resolve => setTimeout(resolve, config.RATE_LIMIT_DELAY));
                    }

                    // Optional: Short delay to avoid hitting rate limits
                    if ((results.processed) % 10 === 0 && wordsToProcess.length > 10) {
                        console.log(`Pausing for ${this.RETRY_DELAY_SECONDS / 1000}s to respect potential rate limits...`);
                        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_SECONDS));
                    }

                } catch (error) {
                    console.log(`Worker ${workerId}: Error processing word: ${error.message}`);
                    results.failedWords++;
                    results.processed++;
                }
            }

            activeWorkers--;
            console.log(`Worker ${workerId} finished`);
        };

        // Start workers
        for (let i = 0; i < config.CONCURRENT_WORKERS; i++) {
            workers.push(processWorker(i + 1));
            // Stagger worker starts to avoid initial rush
            await new Promise(resolve => setTimeout(resolve, config.RATE_LIMIT_DELAY));
        }

        // Wait for all workers to complete
        await Promise.all(workers);

        console.log(`Concurrent processing completed: ${results.successfulWords} successful, ${results.failedWords} failed`);
        return results;
    }

    async processFile(filePath = null) {
        const textPath = filePath || this.TEXT_FILE_PATH;
        
        this.isProcessing = true;
        await this.initialize();

        const allWordsFromText = this.readAndExtractWordsFromTextFile(textPath);

        if (allWordsFromText.length === 0) {
            console.log("No words extracted from text file. Exiting.");
            this.isProcessing = false;
            return { success: false, error: "No words extracted from text file" };
        }

        // Check against DB
        const wordsToProcessQuery = await this.getNewWordsNotInDB(allWordsFromText, this.DB_NAME);

        if (wordsToProcessQuery.length === 0) {
            console.log("No new words to process. All extracted words might already be in the database (based on 'queried_word' check).");
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

        console.log(`\nAttempting translation for ${wordsToProcessQuery.length} new/unchecked words and generating SQL inserts:`);
        
        try {
            console.log("GenAI Client initialized successfully.");
            
            // Use concurrent processing
            const results = await this.processConcurrent(wordsToProcessQuery);
            const successfulWords = results.successfulWords;
            const failedWordsCount = results.failedWords;

            console.log(`\n--- Word Processing Summary ---`);
            console.log(`Successfully processed and generated SQL for ${successfulWords} words.`);
            if (failedWordsCount > 0) {
                console.log(`Failed to process ${failedWordsCount} words. Check ${this.errorLogFile}.`);
            }
            
            this.saveProgress();
            console.log(`\nAll SQL statements (schema + inserts) saved to ${this.sqlOutputFile}`);
            
            if (wordsToProcessQuery.length > 0 && this.sqlInsertStatements.length <= 1) {
                console.log(`Note: No successful word processing. The SQL file '${this.sqlOutputFile}' might only contain the schema.`);
            }

            console.log(`Error log: ${this.errorLogFile}`);
            console.log(`Successful JSON responses log: ${this.successLogFile}`);
            console.log("Word processing script finished.");
            
            this.isProcessing = false;
            return {
                success: true,
                totalWords: allWordsFromText.length,
                newWords: wordsToProcessQuery.length,
                successfulWords,
                failedWords: failedWordsCount
            };
            
        } catch (error) {
            console.log(`\nCRITICAL SCRIPT ERROR (word processing): ${error.message}`);
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