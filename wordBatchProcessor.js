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
    }

    async initialize() {
        // Ensure directories exist
        fs.mkdirSync('logs/batchWords', { recursive: true });
        
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
                        temperature: 0.2
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
}

export default WordBatchProcessor;