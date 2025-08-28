// Language mapping constants
export const LANGUAGE_CODES = {
    'German': 'de',
    'English': 'en', 
    'Spanish': 'esp',
    'French': 'fr',
    'Italian': 'it',
    'Portuguese': 'pt',
    'Russian': 'rus',
    'Chinese': 'zh',
    'Japanese': 'ja',
    'Korean': 'ko'
};

// Utility function to get language code
export function getLanguageCode(languageName) {
    return LANGUAGE_CODES[languageName] || languageName.toLowerCase().substring(0, 2);
}