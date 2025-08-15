import fs from 'fs';

class SQLGenerator {
    constructor() {
        this.insertStatements = [];
    }

    generateSchemaSQL() {
        const schemaSqls = [
            "PRAGMA foreign_keys = ON;",
            `
        CREATE TABLE IF NOT EXISTS book_sentences (
            id INTEGER PRIMARY KEY,
            sentence_number INTEGER,
            chapter_id INTEGER,
            original_text TEXT,
            original_parsed_text TEXT,     -- This will store the model's German annotated output
            translation_parsed_text TEXT,  -- This will store the model's English annotated output
            processing_errors TEXT,        -- Optional, for logging issues directly in the row
            updated_at DATETIME NULL
        );
        `,
            "CREATE INDEX IF NOT EXISTS idx_book_sentences_chapter_sentence ON book_sentences(chapter_id, sentence_number);"
        ];
        return schemaSqls.join("\n") + "\n\n";
    }

    escapeSQLString(value) {
        if (value === null || value === undefined) {
            return "NULL";
        }
        return "'" + String(value).replace(/'/g, "''") + "'";
    }

    addSuccessfulLineSQL(chapterId, lineNumber, originalText, germanAnnotated, englishAnnotated, errors = null) {
        const errorString = errors && errors.length > 0 ? errors.join('; ') : null;
        const currentDateTime = new Date().toISOString().replace('T', ' ').replace('Z', '');
        this.insertStatements.push(
            `INSERT INTO book_sentences (chapter_id, sentence_number, original_text, original_parsed_text, translation_parsed_text, processing_errors, updated_at) VALUES (` +
            `${chapterId}, ` +
            `${lineNumber}, ` +
            `${this.escapeSQLString(originalText)}, ` +
            `${this.escapeSQLString(germanAnnotated)}, ` +
            `${this.escapeSQLString(englishAnnotated)}, ` +
            `${this.escapeSQLString(errorString)}, ` +
            `${this.escapeSQLString(currentDateTime)}` +
            `);`
        );
    }

    addFailedLineSQL(chapterId, lineNumber, originalText, errorString, rawResponse = null) {
        const currentDateTime = new Date().toISOString().replace('T', ' ').replace('Z', '');
        this.insertStatements.push(
            `INSERT INTO book_sentences (chapter_id, sentence_number, original_text, original_parsed_text, translation_parsed_text, processing_errors, updated_at) VALUES (` +
            `${chapterId}, ` +
            `${lineNumber}, ` +
            `${this.escapeSQLString(originalText)}, ` +
            `NULL, ` +
            `NULL, ` +
            `${this.escapeSQLString(errorString + (rawResponse ? ' | RawResp: ' + rawResponse.substring(0, 100) : ''))}, ` +
            `${this.escapeSQLString(currentDateTime)}` +
            `);`
        );
    }

    initializeSchema() {
        this.insertStatements.push(this.generateSchemaSQL());
    }

    saveToFile(filePath) {
        fs.writeFileSync(filePath, this.insertStatements.join("\n"), 'utf8');
        console.log(`SQL statements saved to ${filePath}`);
    }

    getInsertCount() {
        return this.insertStatements.length - 1; // Subtract 1 for schema
    }

    clear() {
        this.insertStatements = [];
    }
}

export default SQLGenerator;