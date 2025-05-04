import locales from './locales.js';

// Get user's browser language (e.g., 'en' from 'en-US')
const getUserLanguage = () => {
  const lang = navigator.language.split('-')[0]; // Extract base language
  return locales[lang] ? lang : 'en'; // Fallback to English
};

// Get translated text for a given key
const t = (key, lang = getUserLanguage()) => {
  const selectedLocale = locales[lang] || locales.en;
  return selectedLocale[key] || locales.en[key] || key; // Fallback to English or key
};

export { t, getUserLanguage };