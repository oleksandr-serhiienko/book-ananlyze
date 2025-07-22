module.exports = {
    // Processing Configuration
    MAX_RETRIES_SENTENCE: 3,
    RETRY_DELAY_SECONDS_SENTENCE: 10000, // milliseconds
    BATCH_SIZE: 10, // Number of lines to process in each batch

    // File Paths
    SQL_OUTPUT_FILE_SENTENCES: 'book_sentences_inserts.sql',
    ERROR_LOG_FILE_SENTENCES: 'sentence_processing_errors.log',
    SUCCESSFUL_RAW_MODEL_RESPONSE_LOG_SENTENCES: 'sentence_model_responses_raw.txt',
    TEXT_FILE_PATH: "C:\\Dev\\Application\\book-prepare\\third_book_all_chapters.txt",

    // Vertex AI Configuration
    PROJECT_ID: '188935312243',
    LOCATION: 'europe-southwest1',
    MODEL_ENDPOINT: 'projects/188935312243/locations/europe-southwest1/endpoints/4244915327680380928',
    MODEL_NAME: 'gemini-pro',

    // Model Configuration
    MODEL_CONFIG: {
        temperature: 1.0,
        topP: 0.95,
        maxOutputTokens: 8192,
    },

    // Safety Settings
    SAFETY_SETTINGS: [
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
    ]
};