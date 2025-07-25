export default {
    // Processing Configuration
    MAX_RETRIES_SENTENCE: 3,
    RETRY_DELAY_SECONDS_SENTENCE: 10000, // milliseconds
    
    // Concurrent Processing Configuration
    CONCURRENT_WORKERS: 5, // Number of parallel requests
    RATE_LIMIT_DELAY: 100, // Milliseconds between starting new requests
    MAX_QUEUE_SIZE: 50, // Maximum sentences in processing queue

    // File Paths (organized in folders)
    SQL_OUTPUT_FILE_SENTENCES: 'logs/sql/book_sentences_inserts.sql',
    ERROR_LOG_FILE_SENTENCES: 'logs/errors/sentence_processing_errors.log',
    SUCCESSFUL_RAW_MODEL_RESPONSE_LOG_SENTENCES: 'logs/responses/sentence_model_responses_raw.txt',
    TEXT_FILE_PATH: "C:\\Dev\\Application\\book-prepare\\third_book_all_chapters.txt",

    // Google GenAI Configuration
    PROJECT_ID: '188935312243',
    LOCATION: 'europe-southwest1',
    MODEL_ENDPOINT: 'projects/188935312243/locations/europe-southwest1/endpoints/3012068123827240960',
    
    // Generation Configuration
    GENERATION_CONFIG: {
        maxOutputTokens: 8192,
        temperature: 1,
        topP: 0.95,
        safetySettings: [
            {
                category: 'HARM_CATEGORY_HATE_SPEECH',
                threshold: 'OFF',
            },
            {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                threshold: 'OFF',
            },
            {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                threshold: 'OFF',
            },
            {
                category: 'HARM_CATEGORY_HARASSMENT',
                threshold: 'OFF',
            }
        ],
    }
};