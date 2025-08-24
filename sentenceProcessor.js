import fs from 'fs';
import path from 'path';
import config from './config.js';
import TextProcessor from './textProcessor.js';
import SQLGenerator from './sqlGenerator.js';
import ModelClient from './modelClient.js';

class SentenceProcessor {
    constructor() {
        this.textProcessor = new TextProcessor();
        this.sqlGenerator = new SQLGenerator();
        this.modelClient = new ModelClient(config);
        this.isProcessing = false;
        
        // Create timestamped file paths
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.errorLogFile = `logs/errors/sentence_errors_${timestamp}.log`;
        this.successLogFile = `logs/responses/sentence_responses_${timestamp}.txt`;
        this.sqlOutputFile = `logs/sql/sentence_results_${timestamp}.sql`;
    }

    async initialize() {
        // Ensure directories exist
        fs.mkdirSync('logs/errors', { recursive: true });
        fs.mkdirSync('logs/responses', { recursive: true });
        fs.mkdirSync('logs/sql', { recursive: true });
        
        this.sqlGenerator.initializeSchema();
        
        // Initialize log files
        fs.writeFileSync(this.errorLogFile, `Line Processing Error Log - Run: ${new Date().toString()}\n${"=".repeat(40)}\n`, 'utf8');
        fs.writeFileSync(this.successLogFile, `# Raw Model Responses (Lines) - Run: ${new Date().toString()}\n`, 'utf8');
    }

    stop() {
        this.isProcessing = false;
    }

    async processSingleLine(lineData) {
        // First try main model with 5 attempts
        for (let attempt = 1; attempt <= config.MAX_RETRIES_SENTENCE; attempt++) {
            console.log(`  Processing C${lineData.chapter_id}_S${lineData.line_number} (attempt ${attempt}/${config.MAX_RETRIES_SENTENCE})`);
            
            try {
                const rawModelResponse = await this.modelClient.getSingleTranslation(lineData);
                
                if (!rawModelResponse || !rawModelResponse.trim()) {
                    console.log(`    No content from model on attempt ${attempt}.`);
                    if (attempt < config.MAX_RETRIES_SENTENCE) {
                        await this.modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                        continue;
                    } else {
                        break; // Break out of main retry loop to try rollback models
                    }
                }

                this.modelClient.logSuccessfulResponse([lineData], rawModelResponse, this.successLogFile);

                const [germanAnnotated, englishAnnotated, parseErrors] = this.textProcessor.parseTranslationResponse(rawModelResponse);
                
                if (germanAnnotated !== null && englishAnnotated !== null) {
                    this.sqlGenerator.addSuccessfulLineSQL(lineData.chapter_id, lineData.line_number, lineData.original_text, germanAnnotated, englishAnnotated, parseErrors);
                    console.log(`    Successfully processed C${lineData.chapter_id}_S${lineData.line_number}.`);
                    return true;
                } else {
                    console.log(`    Parse failed on attempt ${attempt}: ${parseErrors?.join('; ') || 'Unknown parse error'}`);
                    if (attempt < config.MAX_RETRIES_SENTENCE) {
                        await this.modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                        continue;
                    } else {
                        break; // Break out of main retry loop to try rollback models
                    }
                }
                
            } catch (error) {
                console.log(`    Unexpected error processing line on attempt ${attempt}: ${error.message}`);
                if (attempt < config.MAX_RETRIES_SENTENCE) {
                    await this.modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                } else {
                    break; // Break out of main retry loop to try rollback models
                }
            }
        }
        
        // If main model failed after 5 attempts, try rollback models
        if (this.modelClient.rollbackModels && this.modelClient.rollbackModels.length > 0) {
            console.log(`  🔄 ROLLBACK: Main model failed for C${lineData.chapter_id}_S${lineData.line_number}, trying rollback models...`);
            
            for (let rollbackIndex = 0; rollbackIndex < this.modelClient.rollbackModels.length; rollbackIndex++) {
                console.log(`  🔄 ROLLBACK: Using model ${rollbackIndex + 1}/${this.modelClient.rollbackModels.length} (${this.modelClient.rollbackModels[rollbackIndex]}) for C${lineData.chapter_id}_S${lineData.line_number}`);
                
                // Try each rollback model up to 3 times
                for (let rollbackAttempt = 1; rollbackAttempt <= 3; rollbackAttempt++) {
                    console.log(`    Rollback model ${rollbackIndex + 1} attempt ${rollbackAttempt}/3`);
                    
                    try {
                        const rawModelResponse = await this.modelClient.getSingleTranslation(lineData, true, rollbackIndex);
                        
                        if (!rawModelResponse || !rawModelResponse.trim()) {
                            console.log(`      No content from rollback model ${rollbackIndex + 1} on attempt ${rollbackAttempt}.`);
                            if (rollbackAttempt < 3) {
                                await this.modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                                continue; // Try same rollback model again
                            } else {
                                break; // Move to next rollback model
                            }
                        }

                        this.modelClient.logSuccessfulResponse([lineData], rawModelResponse, this.successLogFile);

                        const [germanAnnotated, englishAnnotated, parseErrors] = this.textProcessor.parseTranslationResponse(rawModelResponse);
                        
                        if (germanAnnotated !== null && englishAnnotated !== null) {
                            this.sqlGenerator.addSuccessfulLineSQL(lineData.chapter_id, lineData.line_number, lineData.original_text, germanAnnotated, englishAnnotated, parseErrors);
                            console.log(`    ✅ ROLLBACK SUCCESS: C${lineData.chapter_id}_S${lineData.line_number} processed with rollback model ${rollbackIndex + 1} (${this.modelClient.rollbackModels[rollbackIndex]}) on attempt ${rollbackAttempt}.`);
                            return true;
                        } else {
                            console.log(`      Parse failed with rollback model ${rollbackIndex + 1} on attempt ${rollbackAttempt}: ${parseErrors?.join('; ') || 'Unknown parse error'}`);
                            if (rollbackAttempt < 3) {
                                await this.modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                                continue; // Try same rollback model again
                            } else {
                                break; // Move to next rollback model
                            }
                        }
                        
                    } catch (error) {
                        console.log(`      Error with rollback model ${rollbackIndex + 1} on attempt ${rollbackAttempt}: ${error.message}`);
                        if (rollbackAttempt < 3) {
                            await this.modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                            continue; // Try same rollback model again
                        } else {
                            break; // Move to next rollback model
                        }
                    }
                }
            }
        }
        
        // All models failed
        this.modelClient.logError(lineData.chapter_id, lineData.line_number, lineData.original_text, "All models (main + rollback) failed after max retries", "", [], this.errorLogFile);
        this.sqlGenerator.addFailedLineSQL(lineData.chapter_id, lineData.line_number, lineData.original_text, "All models (main + rollback) failed after max retries", "");
        return false;
    }

    saveProgress() {
        this.sqlGenerator.saveToFile(this.sqlOutputFile);
    }

    async processConcurrent(allLineData) {
        const results = {
            successfulLines: 0,
            failedLines: 0,
            processed: 0
        };

        const workers = [];
        const queue = [...allLineData];
        let activeWorkers = 0;

        console.log(`Starting concurrent processing with ${config.CONCURRENT_WORKERS} workers for ${queue.length} sentences`);

        // Create worker function
        const processWorker = async (workerId) => {
            activeWorkers++;
            console.log(`Worker ${workerId} started`);

            while (queue.length > 0 && this.isProcessing) {
                const lineData = queue.shift();
                if (!lineData) break;

                try {
                    console.log(`Worker ${workerId}: Processing C${lineData.chapter_id}_L${lineData.line_number} (${results.processed + 1}/${allLineData.length})`);
                    
                    const success = await this.processSingleLine(lineData);
                    
                    if (success) {
                        results.successfulLines++;
                    } else {
                        results.failedLines++;
                    }
                    
                    results.processed++;

                    // Save progress periodically
                    if (results.processed % 20 === 0) {
                        this.saveProgress();
                        console.log(`Progress saved after ${results.processed} lines`);
                    }

                    // Small delay to prevent overwhelming the API
                    if (queue.length > 0) {
                        await this.modelClient.delay(config.RATE_LIMIT_DELAY);
                    }

                } catch (error) {
                    console.log(`Worker ${workerId}: Error processing line: ${error.message}`);
                    results.failedLines++;
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
            await this.modelClient.delay(config.RATE_LIMIT_DELAY);
        }

        // Wait for all workers to complete
        await Promise.all(workers);

        console.log(`Concurrent processing completed: ${results.successfulLines} successful, ${results.failedLines} failed`);
        return results;
    }

    async processFile(filePath = null) {
        const textPath = filePath || config.TEXT_FILE_PATH;
        
        this.isProcessing = true;
        await this.initialize();

        const allLineData = this.textProcessor.extractChaptersAndLines(textPath);

        if (allLineData.length === 0) {
            console.log("No lines extracted. Exiting.");
            this.isProcessing = false;
            return { success: false, error: "No lines extracted" };
        }

        console.log(`\nAttempting translation for ${allLineData.length} lines and generating SQL inserts for 'book_sentences':`);
        
        try {
            console.log("Vertex AI Client initialized.");
            
            // Use concurrent processing
            const results = await this.processConcurrent(allLineData);
            const successfulLines = results.successfulLines;
            const failedLinesCount = results.failedLines;

            console.log(`\n--- Line Processing Summary ---`);
            console.log(`Successfully processed and generated SQL for ${successfulLines} lines.`);
            if (failedLinesCount > 0) {
                console.log(`Failed to fully process ${failedLinesCount} lines. Check ${config.ERROR_LOG_FILE_SENTENCES} and the DB table.`);
            }
            
            this.saveProgress();
            console.log(`\nSQL for 'book_sentences' saved to ${this.sqlOutputFile}`);
            console.log(`Line error log: ${this.errorLogFile}`);
            console.log(`Successful raw line responses log: ${this.successLogFile}`);
            console.log("Line script finished.");
            
            this.isProcessing = false;
            return {
                success: true,
                totalLines: allLineData.length,
                successfulLines,
                failedLines: failedLinesCount
            };
            
        } catch (error) {
            console.log(`\nCRITICAL SCRIPT ERROR (line processing): ${error.message}`);
            this.modelClient.logError(0, 0, "CRITICAL SCRIPT ERROR", error.message, "", [], this.errorLogFile);
            this.saveProgress();
            this.isProcessing = false;
            return { success: false, error: error.message };
        }
    }
}

async function main() {
    const processor = new SentenceProcessor();
    const result = await processor.processFile();
    console.log('Processing result:', result);
}

// Export for use as module
export default SentenceProcessor;

// Run the main function if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}