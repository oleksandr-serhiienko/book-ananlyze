import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import SentenceProcessor from './sentenceProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

let currentSentenceProcessor = null;
let currentJobStatus = {
    isRunning: false,
    status: 'idle',
    progress: 0,
    logs: []
};

app.post('/api/sentence/start', async (req, res) => {
    try {
        const { filePath } = req.body;
        
        if (currentJobStatus.isRunning) {
            return res.status(400).json({ error: 'Sentence processing already running' });
        }

        currentSentenceProcessor = new SentenceProcessor();
        currentJobStatus = {
            isRunning: true,
            status: 'starting',
            progress: 0,
            logs: [`Starting sentence processing for ${filePath}`]
        };

        // Run sentence processing asynchronously
        processSentencesAsync(filePath);
        
        res.json({ message: 'Sentence processing started', status: currentJobStatus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/sentence/status', (req, res) => {
    res.json(currentJobStatus);
});

app.post('/api/sentence/stop', (req, res) => {
    if (currentSentenceProcessor) {
        currentSentenceProcessor.stop();
    }
    currentJobStatus.isRunning = false;
    currentJobStatus.status = 'stopped';
    res.json({ message: 'Sentence processing stopped' });
});

async function processSentencesAsync(filePath) {
    try {
        currentJobStatus.logs.push('Starting sentence-by-sentence processing...');
        currentJobStatus.status = 'processing';
        
        const result = await currentSentenceProcessor.processFile(filePath);
        
        if (result.success) {
            currentJobStatus.status = 'completed';
            currentJobStatus.progress = 100;
            currentJobStatus.isRunning = false;
            currentJobStatus.logs.push(`✅ Processing completed: ${result.successfulLines}/${result.totalLines} sentences successful`);
        } else {
            currentJobStatus.status = 'error';
            currentJobStatus.isRunning = false;
            currentJobStatus.logs.push(`❌ Processing failed: ${result.error}`);
        }
        
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