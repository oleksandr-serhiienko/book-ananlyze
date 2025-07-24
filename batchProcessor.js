import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { JobServiceClient } from '@google-cloud/aiplatform';
import config from './config.js';
import ModelClient from './modelClient.js';
import TextProcessor from './textProcessor.js';
import SQLGenerator from './sqlGenerator.js';

export class BatchProcessor {
    constructor(projectId, location = 'us-central1') {
        this.projectId = projectId;
        this.location = location;
        this.client = new JobServiceClient({ 
            projectId: this.projectId,
            location: this.location 
        });
        this.parent = `projects/${this.projectId}/locations/${this.location}`;
    }

    async createBundles(inputFile, outputFile) {
        const SYSTEM_TEXT = 'You are a DE‑EN translator. Preserve /index/ tags exactly.';
        const CHAP_REGEX = /^\[CHAPTER MARKER]/i;

        const rawLines = fs.readFileSync(inputFile, 'utf8').split(/\r?\n/);

        const chapters = [];
        let cur = [];

        for (const ln of rawLines) {
            const line = ln.trim();
            if (!line) continue;

            if (CHAP_REGEX.test(line)) {
                if (cur.length) chapters.push(cur.join('\n'));
                cur = [];
            } else {
                cur.push(line.endsWith('|') ? line : line + '|');
            }
        }
        if (cur.length) chapters.push(cur.join('\n'));

        console.log(`📚 Found ${chapters.length} chapters`);

        const outStream = outputFile.endsWith('.gz')
            ? fs.createWriteStream(outputFile).pipe(createGzip())
            : fs.createWriteStream(outputFile);

        for (const text of chapters) {
            const req = {
                request: {
                    systemInstruction: {
                        role: 'system',
                        parts: [{ text: SYSTEM_TEXT }]
                    },
                    contents: [
                        { role: 'user', parts: [{ text }] }
                    ]
                }
            };
            outStream.write(JSON.stringify(req) + '\n');
        }

        await pipeline(outStream);
        console.log(`✅ Bundles written ➜ ${outputFile}`);
        return chapters.length;
    }

    async submitBatchJob(inputUri, outputUriPrefix) {
        const [job] = await this.client.createBatchPredictionJob({
            parent: this.parent,
            batchPredictionJob: {
                model: 'publishers/google/models/gemini-2.5-flash',
                inputConfig: {
                    instancesFormat: 'jsonl',
                    gcsSource: { uris: [inputUri] }
                },
                outputConfig: {
                    predictionsFormat: 'jsonl',
                    gcsDestination: { outputUriPrefix }
                }
            }
        });

        console.log('🟡 Job submitted:', job.name);
        return job;
    }

    async pollJobStatus(jobName, onStatusUpdate = null) {
        while (true) {
            const [fresh] = await this.client.getBatchPredictionJob({ name: jobName });

            if (onStatusUpdate) {
                onStatusUpdate(fresh.state, fresh);
            }

            if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIALLY_SUCCEEDED']
                .includes(fresh.state)) {
                console.log('✅ Job finished with state:', fresh.state);
                return fresh;
            }

            process.stdout.write('.');
            await new Promise(r => setTimeout(r, 30_000));
        }
    }

    async processBatch(inputFile, inputUri, outputUriPrefix) {
        console.log('Step 1: Creating bundles...');
        const chapterCount = await this.createBundles(inputFile, inputUri.replace('gs://', '').split('/').pop());
        
        console.log('Step 2: Submitting batch job...');
        const job = await this.submitBatchJob(inputUri, outputUriPrefix);
        
        console.log('Step 3: Polling job status...');
        const finalJob = await this.pollJobStatus(job.name);
        
        return {
            jobName: job.name,
            finalState: finalJob.state,
            chapterCount,
            outputUri: outputUriPrefix
        };
    }

    // Local batch processing for chapters
    async processChaptersLocally(inputFile) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const errorLogFile = `batch_errors_${timestamp}.log`;
        const successLogFile = `batch_responses_${timestamp}.txt`;
        const sqlOutputFile = `batch_results_${timestamp}.sql`;
        const batchContentLogFile = `batch_content_sent_${timestamp}.txt`;

        console.log('🚀 Starting local chapter-based batch processing...');
        
        // Output results early for testing
        const quickResults = {
            totalChapters: 0,
            successfulChapters: 0,
            failedChapters: 0,
            totalLines: 0,
            successfulLines: 0,
            failedLines: 0,
            sqlFile: sqlOutputFile,
            errorLog: errorLogFile,
            successLog: successLogFile,
            batchContentLog: batchContentLogFile
        };
        
        // Initialize components
        const modelClient = new ModelClient(config);
        const textProcessor = new TextProcessor();
        const sqlGenerator = new SQLGenerator();
        
        // Initialize logs
        fs.writeFileSync(errorLogFile, `Batch Processing Error Log - Run: ${new Date().toString()}\n${"=".repeat(40)}\n`, 'utf8');
        fs.writeFileSync(successLogFile, `# Batch Model Responses - Run: ${new Date().toString()}\n`, 'utf8');
        fs.writeFileSync(batchContentLogFile, `# Batch Content Sent to AI Model - Run: ${new Date().toString()}\n${"=".repeat(80)}\n`, 'utf8');
        sqlGenerator.initializeSchema();

        // Extract chapters
        const rawLines = fs.readFileSync(inputFile, 'utf8').split(/\r?\n/);
        const chapters = [];
        let currentChapter = [];
        let chapterNumber = 0;
        let foundFirstChapterMarker = false;

        for (const ln of rawLines) {
            const line = ln.trim();
            if (!line) continue;

            if (/^\[CHAPTER MARKER]/i.test(line)) {
                foundFirstChapterMarker = true;
                if (currentChapter.length) {
                    chapters.push({
                        number: ++chapterNumber,
                        content: currentChapter.join('\n'),
                        lines: currentChapter.length
                    });
                }
                currentChapter = [];
            } else if (foundFirstChapterMarker) {
                // Only collect content after we've found the first chapter marker
                currentChapter.push(line.endsWith('|') ? line : line + '|');
            }
            // Skip content before the first chapter marker
        }
        
        // Add the last chapter if it has content
        if (currentChapter.length && foundFirstChapterMarker) {
            chapters.push({
                number: ++chapterNumber,
                content: currentChapter.join('\n'),
                lines: currentChapter.length
            });
        }

        const totalLines = chapters.reduce((sum, ch) => sum + ch.lines, 0);
        console.log(`📚 Found ${chapters.length} chapters with ${totalLines} total lines`);

        // Update quick results with real chapter data
        quickResults.totalChapters = chapters.length;
        quickResults.totalLines = totalLines;
        
        // Output preliminary results immediately
        console.log('BATCH_RESULTS:', JSON.stringify(quickResults));

        let successfulChapters = 0;
        let failedChapters = 0;
        let successfulLines = 0;
        let failedLines = 0;

        // Process each chapter
        for (const chapter of chapters) {
            console.log(`\n📖 Processing Chapter ${chapter.number} (${chapter.lines} lines)...`);
            
            try {
                // Create a prompt for the entire chapter
                const prompt = `Translate the following German text to English. Preserve /index/ tags exactly. Return the translation maintaining the same line structure:\n\n${chapter.content}`;
                
                const chapterLineData = { 
                    chapter_id: chapter.number, 
                    original_text: chapter.content 
                };

                for (let attempt = 1; attempt <= config.MAX_RETRIES_SENTENCE; attempt++) {
                    try {
                        console.log(`  📤 Attempt ${attempt}/${config.MAX_RETRIES_SENTENCE} - Sending chapter to AI...`);
                        
                        // Log the batch content being sent
                        if (attempt === 1) { // Only log on first attempt to avoid duplicates
                            const batchLogEntry = `
## CHAPTER ${chapter.number} - Attempt ${attempt} - ${new Date().toISOString()}
### Original Content (${chapter.lines} lines):
${chapter.content}

### Full Prompt Being Sent:
${prompt}

${"=".repeat(80)}
`;
                            fs.appendFileSync(batchContentLogFile, batchLogEntry, 'utf8');
                            console.log(`  📝 Logged batch content to ${batchContentLogFile}`);
                        }
                        
                        const rawResponse = await modelClient.getSingleTranslation(chapterLineData);
                        
                        if (!rawResponse || !rawResponse.trim()) {
                            console.log(`  ❌ No response on attempt ${attempt}`);
                            if (attempt < config.MAX_RETRIES_SENTENCE) {
                                await modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                                continue;
                            } else {
                                throw new Error("No content from model after max retries");
                            }
                        }

                        // Log successful response
                        const logEntry = {
                            chapter: chapter.number,
                            timestamp: new Date().toISOString(),
                            raw_response: rawResponse
                        };
                        fs.appendFileSync(successLogFile, JSON.stringify(logEntry) + '\n', 'utf8');

                        // Process the chapter response
                        const translatedLines = rawResponse.split('\n').filter(line => line.trim());
                        const originalLines = chapter.content.split('\n').filter(line => line.trim());
                        
                        console.log(`  📝 Processing ${originalLines.length} lines from chapter response...`);
                        
                        // Create SQL entries for each line in the chapter
                        for (let i = 0; i < originalLines.length; i++) {
                            const originalLine = originalLines[i];
                            const translatedLine = translatedLines[i] || originalLine; // Fallback to original if translation missing
                            
                            // Use textProcessor to parse if needed, or just store directly
                            try {
                                const [germanAnnotated, englishAnnotated, parseErrors] = textProcessor.parseTranslationResponse(`{"original": "${originalLine}", "translated": "${translatedLine}"}`);
                                
                                if (germanAnnotated !== null && englishAnnotated !== null) {
                                    sqlGenerator.addSuccessfulLineSQL(chapter.number, i + 1, originalLine, germanAnnotated, englishAnnotated, parseErrors);
                                    successfulLines++;
                                } else {
                                    sqlGenerator.addFailedLineSQL(chapter.number, i + 1, originalLine, "Failed to parse translation", translatedLine);
                                    failedLines++;
                                }
                            } catch (parseError) {
                                // If parsing fails, store as simple translation
                                sqlGenerator.addSuccessfulLineSQL(chapter.number, i + 1, originalLine, originalLine, translatedLine, []);
                                successfulLines++;
                            }
                        }
                        
                        successfulChapters++;
                        console.log(`  ✅ Chapter ${chapter.number} completed successfully`);
                        break;
                        
                    } catch (error) {
                        console.log(`  ❌ Error on attempt ${attempt}: ${error.message}`);
                        if (attempt < config.MAX_RETRIES_SENTENCE) {
                            await modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE);
                        } else {
                            throw error;
                        }
                    }
                }
                
            } catch (error) {
                console.log(`  💥 Chapter ${chapter.number} failed: ${error.message}`);
                failedChapters++;
                failedLines += chapter.lines;
                
                // Log error
                const errorMessage = `Chapter: ${chapter.number}, Lines: ${chapter.lines}\nError: ${error.message}\n${"-".repeat(30)}\n`;
                fs.appendFileSync(errorLogFile, errorMessage, 'utf8');
                
                // Add failed SQL entries for all lines in the chapter
                const originalLines = chapter.content.split('\n').filter(line => line.trim());
                for (let i = 0; i < originalLines.length; i++) {
                    sqlGenerator.addFailedLineSQL(chapter.number, i + 1, originalLines[i], `Chapter processing failed: ${error.message}`, "");
                }
            }
            
            // Small delay between chapters
            if (chapter.number < chapters.length) {
                console.log(`  ⏸️  Pausing for ${config.RETRY_DELAY_SECONDS_SENTENCE / 2}ms...`);
                await modelClient.delay(config.RETRY_DELAY_SECONDS_SENTENCE / 2);
            }
        }

        // Save results
        sqlGenerator.saveToFile(sqlOutputFile);
        
        const results = {
            totalChapters: chapters.length,
            successfulChapters,
            failedChapters,
            totalLines,
            successfulLines,
            failedLines,
            sqlFile: sqlOutputFile,
            errorLog: errorLogFile,
            successLog: successLogFile,
            batchContentLog: batchContentLogFile
        };

        console.log('\n🎉 Batch processing completed!');
        console.log(`📊 Results:`);
        console.log(`   Chapters: ${successfulChapters}/${chapters.length} successful`);
        console.log(`   Lines: ${successfulLines}/${totalLines} successful`);
        console.log(`📁 Files created:`);
        console.log(`   SQL: ${sqlOutputFile}`);
        console.log(`   Errors: ${errorLogFile}`);
        console.log(`   Responses: ${successLogFile}`);
        console.log(`   Batch Content: ${batchContentLogFile}`);

        return results;
    }
}

// Main execution when run directly
async function main() {
    const inputFile = process.argv[2] || config.TEXT_FILE_PATH;
    
    if (!inputFile) {
        console.log('Usage: node batchProcessor.js [input-file]');
        console.log('If no input file specified, uses config.TEXT_FILE_PATH');
        process.exit(1);
    }
    const processor = new BatchProcessor(config.PROJECT_ID, config.LOCATION);
    
    try {
        const results = await processor.processChaptersLocally(inputFile);
        
        // Output results in a format the backend can parse
        console.log('BATCH_RESULTS:', JSON.stringify(results));
        
    } catch (error) {
        console.error('❌ Batch processing failed:', error.message);
        process.exit(1);
    }
}

// Run main function
main().catch(console.error);