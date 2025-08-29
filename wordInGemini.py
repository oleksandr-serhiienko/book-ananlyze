import re
import os
import json
import sqlite3
import time
from typing import List, Callable, Optional

from google.genai import types # Assuming this is google.generativeai.types
from google import genai     # Your specific client library

# --- Configuration ---
MAX_RETRIES = 5
RETRY_DELAY_SECONDS = 5
SQL_OUTPUT_FILE = 'translations_inserts.sql'
ERROR_LOG_FILE = 'processing_errors.log'
DB_NAME = 'MudadibFullGemini.db' # Database for checking existing words and for schema
TEXT_FILE_PATH = r"C:\Dev\Application\book-prepare\third_book_all_chapters.txt" # YOUR TEXT FILE PATH
SUCCESSFUL_JSON_LOG_FILE = 'successful_model_responses.jsonl' # For logging raw successful JSONs

# --- Word Extraction and Filtering ---
def read_and_extract_words_from_text_file(file_path: str) -> List[str]:
    """Read file and extract unique German words."""
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            text = file.read()
        words = re.findall(r'\b[a-zäöüßA-ZÄÖÜ]+\b', text.lower())
        unique_words = sorted(set(words))
        print(f"Found {len(unique_words)} unique words in the text file.")
        return unique_words
    except FileNotFoundError:
        print(f"Error: Text file not found at {file_path}")
        return []
    except Exception as e:
        print(f"Error reading or processing text file {file_path}: {e}")
        return []

def get_new_words_not_in_db(words_from_text: List[str], db_path: str) -> List[str]:
    """Filter out words whose base_form is already in the database's words table."""
    if not words_from_text:
        return []
    
    new_words_to_query = []
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        try:
            existing_queried_words = set() # Check against queried_word for simplicity
            cursor.execute("SELECT DISTINCT queried_word FROM words")
            for row in cursor.fetchall():
                existing_queried_words.add(row[0].lower())
            
            for word in words_from_text:
                if word.lower() not in existing_queried_words:
                    new_words_to_query.append(word)

        except sqlite3.OperationalError as e:
            print(f"Database operational error (e.g., table 'words' not found during check): {e}")
            print("Proceeding to query all words from text file, as DB check failed.")
            return words_from_text 
        
        conn.close()
        print(f"Identified {len(new_words_to_query)} words from text file that are potentially new to the database (based on 'queried_word' check).")
    except sqlite3.Error as e:
        print(f"SQLite error when checking words in DB: {e}")
        return words_from_text 
    
    return new_words_to_query

# --- SQL Generation Functions ---
sql_insert_statements = []

def generate_schema_sql():
    """Generates SQL for table creation."""
    schema_sqls = [
        "PRAGMA foreign_keys = ON;",
        """
        CREATE TABLE IF NOT EXISTS words (
            word_id INTEGER PRIMARY KEY,
            queried_word TEXT NOT NULL,
            base_form_json JSON NOT NULL,
            primary_type TEXT, 
            info_json JSON,
            UNIQUE(queried_word)
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS word_translations (
            translation_id INTEGER PRIMARY KEY,
            word_id INTEGER NOT NULL,
            meaning TEXT NOT NULL,
            additional_info TEXT,
            meta_type TEXT, 
            FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS translation_examples (
            example_id INTEGER PRIMARY KEY,
            translation_id INTEGER NOT NULL,
            source_text TEXT NOT NULL,
            target_text TEXT NOT NULL,
            FOREIGN KEY (translation_id) REFERENCES word_translations(translation_id) ON DELETE CASCADE
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_words_queried_word ON words(queried_word);",
        "CREATE INDEX IF NOT EXISTS idx_word_translations_word_id ON word_translations(word_id);",
        "CREATE INDEX IF NOT EXISTS idx_translation_examples_translation_id ON translation_examples(translation_id);"
    ]
    return "\n".join(schema_sqls) + "\n\n"

def escape_sql_string(value):
    """Escapes single quotes for SQL strings."""
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"

def transform_example_text(text: str) -> str:
    """Replaces |word| with <em>word</em> in example texts."""
    if text is None:
        return None
    return re.sub(r'\|([^|]+)\|', r'<em>\1</em>', text)

def extract_and_generate_sql_for_word(assistant_content_json, original_queried_word):
    """
    Extracts data and generates INSERT SQL statements.
    'original_queried_word' is the word that was used in the prompt.
    Transforms example texts.
    """
    try:
        word_info_from_model = assistant_content_json['word_info']
        all_translations_from_model = assistant_content_json.get('translations', [])

        db_queried_word = original_queried_word
        db_base_form_json_str = json.dumps(word_info_from_model.get('base_form'))
        db_info_json_str = json.dumps(word_info_from_model.get('additional_info'))
        
        db_primary_type = None
        base_form_content = word_info_from_model.get('base_form')
        if isinstance(base_form_content, dict):
            types_present = list(base_form_content.keys())
            if types_present: db_primary_type = "/".join(sorted(types_present))
        elif isinstance(base_form_content, str):
            additional_info_content = word_info_from_model.get('additional_info')
            if isinstance(additional_info_content, dict):
                if 'type' in additional_info_content: db_primary_type = additional_info_content['type']
                elif 'usage' in additional_info_content and not db_primary_type: db_primary_type = additional_info_content['usage']
        if not db_primary_type: db_primary_type = "unknown"

        sql_insert_statements.append(
            f"INSERT OR IGNORE INTO words (queried_word, base_form_json, primary_type, info_json) VALUES "
            f"({escape_sql_string(db_queried_word)}, {escape_sql_string(db_base_form_json_str)}, {escape_sql_string(db_primary_type)}, {escape_sql_string(db_info_json_str)});"
        )
        
        word_id_subquery = f"(SELECT word_id FROM words WHERE queried_word = {escape_sql_string(db_queried_word)})"
        
        for trans_data in all_translations_from_model:
            meaning = trans_data.get('meaning')
            additional_info_trans = trans_data.get('additionalInfo')
            meta_type_trans = trans_data.get('type')

            if meaning is None:
                log_error(original_queried_word, f"Skipping a translation due to missing meaning key or null value.", trans_data)
                continue

            sql_insert_statements.append(
                f"INSERT INTO word_translations (word_id, meaning, additional_info, meta_type) VALUES "
                f"({word_id_subquery}, {escape_sql_string(meaning)}, {escape_sql_string(additional_info_trans)}, {escape_sql_string(meta_type_trans)});"
            )
            
            translation_id_subquery = (
                f"(SELECT translation_id FROM word_translations WHERE word_id = {word_id_subquery} "
                f"AND meaning = {escape_sql_string(meaning)} "
                f"AND COALESCE(additional_info, 'NULL_MARKER') = COALESCE({escape_sql_string(additional_info_trans)}, 'NULL_MARKER') "
                f"AND COALESCE(meta_type, 'NULL_MARKER') = COALESCE({escape_sql_string(meta_type_trans)}, 'NULL_MARKER') "
                f"ORDER BY translation_id DESC LIMIT 1)"
            )

            for ex_data in trans_data.get('examples', []):
                source_text_raw = ex_data.get('source')
                target_text_raw = ex_data.get('target')

                if source_text_raw and target_text_raw:
                    source_text_transformed = transform_example_text(source_text_raw)
                    target_text_transformed = transform_example_text(target_text_raw)

                    sql_insert_statements.append(
                        f"INSERT INTO translation_examples (translation_id, source_text, target_text) VALUES "
                        f"({translation_id_subquery}, {escape_sql_string(source_text_transformed)}, {escape_sql_string(target_text_transformed)});"
                    )
        
        # print(f"SQL generated for queried word '{db_queried_word}'.") # Now handled by process_word_with_retries
        return True

    except KeyError as e:
        log_error(original_queried_word, f"Parsing error: Missing key {e}.", assistant_content_json)
        return False
    except Exception as e:
        log_error(original_queried_word, f"Unexpected error during SQL generation: {e}", assistant_content_json)
        return False

# --- Model Interaction and Parsing ---
def parse_model_output_for_assistant_content(raw_streamed_output):
    try:
        # print("Attempting to parse the received output directly as the assistant's content JSON...")
        inner_json_data = json.loads(raw_streamed_output)
        # print("Successfully parsed the output as assistant's content JSON.")
        if 'word_info' not in inner_json_data:
            # print("Validation Error: Parsed JSON missing required 'word_info' key.")
            raise ValueError("Parsed JSON missing required 'word_info' key.")
        return inner_json_data
    except json.JSONDecodeError as e:
        print(f"Failed to parse direct output as JSON: {e}")
        print(f"Problematic string was:\n{raw_streamed_output}") 
        return None
    except ValueError:
        return None
    except Exception as e:
        print(f"Unexpected error during direct parsing: {e}")
        return None

def get_translation_from_model(client, model_path_str, original_word_to_query):
    text_prompt = f"de-en? {original_word_to_query}" # Your specific prompt format
    contents = [types.Content(role="user", parts=[types.Part.from_text(text=text_prompt)])]
    # Add system message if your setup requires it for the desired JSON output:
    # contents.insert(0, types.Content(role="system", parts=[types.Part.from_text(text="word info")]))

    safety_settings_list = [
        types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold=types.HarmBlockThreshold.BLOCK_NONE),
        types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold=types.HarmBlockThreshold.BLOCK_NONE),
        types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold=types.HarmBlockThreshold.BLOCK_NONE),
        types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold=types.HarmBlockThreshold.BLOCK_NONE)
    ]
    generate_content_config_obj = types.GenerateContentConfig(
        temperature=0.1, 
        top_p=0.95, 
        max_output_tokens=4096, 
        safety_settings=safety_settings_list
    )

    raw_model_output_chunks = []
    for chunk in client.models.generate_content_stream(
        model=model_path_str, 
        contents=contents, 
        config=generate_content_config_obj
    ):
        if hasattr(chunk, 'text'):
            raw_model_output_chunks.append(chunk.text)
    return "".join(raw_model_output_chunks)

def process_word_with_retries(client, model_path_str, original_word_to_query):
    full_raw_streamed_output_for_logging = "" 
    for attempt in range(1, MAX_RETRIES + 1):
        print(f"Processing '{original_word_to_query}', Attempt {attempt}/{MAX_RETRIES}...")
        try:
            full_raw_streamed_output = get_translation_from_model(client, model_path_str, original_word_to_query)
            full_raw_streamed_output_for_logging = full_raw_streamed_output 

            if not full_raw_streamed_output or not full_raw_streamed_output.strip():
                print(f"No content received from model for '{original_word_to_query}' on attempt {attempt}.")
                if attempt < MAX_RETRIES: 
                    print(f"Retrying in {RETRY_DELAY_SECONDS} seconds...")
                    time.sleep(RETRY_DELAY_SECONDS); continue
                else: 
                    log_error(original_word_to_query, "No content from model after max retries.", full_raw_streamed_output_for_logging)
                    return False

            assistant_content_json = parse_model_output_for_assistant_content(full_raw_streamed_output)

            if assistant_content_json:
                print(f"Successfully parsed model output for '{original_word_to_query}' on attempt {attempt}.")
                if extract_and_generate_sql_for_word(assistant_content_json, original_word_to_query):
                    try:
                        with open(SUCCESSFUL_JSON_LOG_FILE, 'a', encoding='utf-8') as f_json_log:
                            log_entry = {
                                "queried_word": original_word_to_query,
                                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                                "response_data": assistant_content_json
                            }
                            f_json_log.write(json.dumps(log_entry, ensure_ascii=False) + '\n')
                    except Exception as log_e:
                        print(f"Warning: Could not write to successful JSON log: {log_e}")
                    return True 
                else:
                    print(f"Failed to generate SQL for '{original_word_to_query}' (logged).")
                    # Error already logged by extract_and_generate_sql_for_word
                    return False 
            else:
                print(f"Failed to parse model output for '{original_word_to_query}' on attempt {attempt} (parser returned None).")
                if attempt < MAX_RETRIES:
                    print(f"Retrying API call and parsing in {RETRY_DELAY_SECONDS} seconds...")
                    time.sleep(RETRY_DELAY_SECONDS)
                else:
                    log_error(original_word_to_query, "Failed to parse model output after max retries (parser returned None).", full_raw_streamed_output_for_logging)
                    return False
        except Exception as e:
            print(f"Unexpected error processing '{original_word_to_query}' on attempt {attempt}: {e}")
            if attempt < MAX_RETRIES: 
                print(f"Retrying in {RETRY_DELAY_SECONDS} seconds...")
                time.sleep(RETRY_DELAY_SECONDS)
            else: 
                log_error(original_word_to_query, f"Unexpected error after max retries: {e}", full_raw_streamed_output_for_logging if full_raw_streamed_output_for_logging else "No raw output captured due to early exception.")
                return False
    return False

def log_error(word_query, reason, raw_output_data=""):
    error_message = f"Word: {word_query}\nReason: {reason}\n"
    if isinstance(raw_output_data, dict) or isinstance(raw_output_data, list): 
        error_message += f"Parsed Data (or part of it):\n{json.dumps(raw_output_data, indent=2, ensure_ascii=False)}\n"
    elif raw_output_data: 
        error_message += f"Raw Output:\n{raw_output_data}\n"
    error_message += "-" * 30 + "\n"
    
    with open(ERROR_LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(error_message)
    print(f"Logged error for '{word_query}' to {ERROR_LOG_FILE}")

# --- Main Execution ---
if __name__ == '__main__':
    # Add schema creation SQL
    sql_insert_statements.append(generate_schema_sql())
    
    # Clear/Initialize error log
    with open(ERROR_LOG_FILE, 'w', encoding='utf-8') as f:
        f.write(f"Error Log - Run started at {time.ctime()}\n" + "="*40 + "\n")

    # Initialize successful JSON log
    with open(SUCCESSFUL_JSON_LOG_FILE, 'w', encoding='utf-8') as f_json_log:
        f_json_log.write(f"# Log of successfully processed model JSON responses - Run started at {time.ctime()}\n")
        f_json_log.write(f"# Each subsequent line is a JSON object: {{'queried_word': ..., 'timestamp': ..., 'response_data': ...}}\n")

    all_words_from_text = read_and_extract_words_from_text_file(TEXT_FILE_PATH)

    if not all_words_from_text:
        print("No words extracted from text file. Exiting.")
    else:
        # Check against DB. For this to work best, DB_NAME should exist and have the 'words' table.
        # If DB_NAME is new, connect() will create it, but table won't exist, so get_new_words_not_in_db will fallback.
        words_to_process_query = get_new_words_not_in_db(all_words_from_text, DB_NAME)

        if not words_to_process_query:
            print("No new words to process. All extracted words might already be in the database (based on 'queried_word' check).")
        else:
            print(f"\nAttempting translation for {len(words_to_process_query)} new/unchecked words and generating SQL inserts:")
            try:
                # Ensure you are authenticated (e.g., via gcloud auth application-default login
                # in the terminal where this script is run)
                client = genai.Client(
                    vertexai=True, 
                    project="188935312243", # YOUR GCP PROJECT ID
                    location="europe-southwest1", # YOUR MODEL'S LOCATION
                )
                print("GenAI Client initialized successfully.")

                # YOUR SPECIFIC VERTEX AI ENDPOINT
                model_path_str = "projects/188935312243/locations/europe-southwest1/endpoints/2335389085675290624";
                # projects/188935312243/locations/europe-southwest1/models/7329546820894326784@1 
                successful_words = 0
                failed_words_count = 0

                for i, word_query in enumerate(words_to_process_query):
                    print(f"\n--- Processing word {i+1}/{len(words_to_process_query)}: '{word_query}' ---")
                    if process_word_with_retries(client, model_path_str, word_query):
                        successful_words +=1
                        print(f"Successfully processed and generated SQL for '{word_query}'.")
                    else:
                        failed_words_count +=1
                        print(f"Failed to process '{word_query}' after retries.")
                    
                    # Optional: Short delay to avoid hitting rate limits
                    if (i + 1) % 10 == 0 and len(words_to_process_query) > 10 : # After every 10 words if there are many
                       print(f"Pausing for {RETRY_DELAY_SECONDS}s to respect potential rate limits...")
                       time.sleep(RETRY_DELAY_SECONDS)


                print(f"\n--- Summary ---")
                print(f"Successfully processed and generated SQL for {successful_words} words.")
                if failed_words_count > 0:
                    print(f"Failed to process {failed_words_count} words. Check {ERROR_LOG_FILE}.")

            except Exception as e:
                print(f"\nCRITICAL SCRIPT ERROR (e.g., client init, unexpected issue): {e}")
                log_error("CRITICAL SCRIPT ERROR", str(e)) # Log the critical error itself
            
    # Write all accumulated SQL statements to the file
    with open(SQL_OUTPUT_FILE, 'w', encoding='utf-8') as f_sql:
        for stmt in sql_insert_statements:
            f_sql.write(stmt + "\n")
    print(f"\nAll SQL statements (schema + inserts) saved to {SQL_OUTPUT_FILE}")
    if not words_to_process_query and all_words_from_text:
         print(f"Note: No new words were processed. The SQL file '{SQL_OUTPUT_FILE}' might only contain the schema.")
    elif not sql_insert_statements[1:]: # Check if only schema is present
         print(f"Note: No successful word processing. The SQL file '{SQL_OUTPUT_FILE}' might only contain the schema.")

    print(f"Error log: {ERROR_LOG_FILE}")
    print(f"Successful JSON responses log: {SUCCESSFUL_JSON_LOG_FILE}")
    print("Script finished.")