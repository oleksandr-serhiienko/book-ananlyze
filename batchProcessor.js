import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { JobServiceClient } from '@google-cloud/aiplatform';

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
}