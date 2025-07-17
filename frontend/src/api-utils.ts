/**
 * API utilities for the frontend
 */

/**
 * Get the base API URL, with fallback to the current domain if the environment variable is not set
 * This helps ensure the application works in both development and production environments
 */
export const getApiUrl = (): string => {
  // Use environment variable if available
  if (import.meta.env.VITE_API_URL) {
    console.log(`Using configured API URL: ${import.meta.env.VITE_API_URL}`);
    return import.meta.env.VITE_API_URL;
  }
  
  // Fallback to current domain (for production)
  console.log(`No API URL configured, falling back to: ${window.location.origin}`);
  return window.location.origin;
};