import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { BatchProcessor } from './batchProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

let currentBatchProcessor = null;
let currentJobStatus = {
    isRunning: false,
    jobName: null,
    status: 'idle',
    progress: 0,
    logs: []
};

app.post('/api/batch/start', async (req, res) => {
    try {
        const { filePath, projectId, gcsInputBucket, gcsOutputBucket } = req.body;
        
        if (currentJobStatus.isRunning) {
            return res.status(400).json({ error: 'Batch job already running' });
        }

        currentBatchProcessor = new BatchProcessor(projectId);
        currentJobStatus = {
            isRunning: true,
            jobName: null,
            status: 'starting',
            progress: 0,
            logs: [`Starting batch processing for ${filePath}`]
        };

        // Run batch processing asynchronously
        processBatchAsync(filePath, gcsInputBucket, gcsOutputBucket);
        
        res.json({ message: 'Batch processing started', status: currentJobStatus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/batch/status', (req, res) => {
    res.json(currentJobStatus);
});

app.post('/api/batch/stop', (req, res) => {
    currentJobStatus.isRunning = false;
    currentJobStatus.status = 'stopped';
    res.json({ message: 'Batch processing stopped' });
});

async function processBatchAsync(filePath, gcsInputBucket, gcsOutputBucket) {
    try {
        currentJobStatus.logs.push('Creating bundles from text file...');
        
        // Create bundles
        const bundlesPath = `${gcsInputBucket}bundles.jsonl`;
        const chapterCount = await currentBatchProcessor.createBundles(filePath, 'temp_bundles.jsonl');
        
        currentJobStatus.logs.push(`✅ Created ${chapterCount} bundles`);
        currentJobStatus.status = 'submitting';
        
        // Submit job
        const job = await currentBatchProcessor.submitBatchJob(bundlesPath, gcsOutputBucket);
        currentJobStatus.jobName = job.name;
        currentJobStatus.logs.push(`✅ Job submitted: ${job.name}`);
        currentJobStatus.status = 'polling';
        
        // Poll status
        const finalJob = await currentBatchProcessor.pollJobStatus(job.name, (state, jobInfo) => {
            if (currentJobStatus.isRunning) {
                currentJobStatus.status = state.toLowerCase();
                currentJobStatus.logs.push(`Job status: ${state}`);
            }
        });
        
        currentJobStatus.status = finalJob.state.toLowerCase();
        currentJobStatus.progress = 100;
        currentJobStatus.isRunning = false;
        currentJobStatus.logs.push(`✅ Batch processing completed with status: ${finalJob.state}`);
        
    } catch (error) {
        currentJobStatus.status = 'error';
        currentJobStatus.isRunning = false;
        currentJobStatus.logs.push(`❌ Error: ${error.message}`);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});