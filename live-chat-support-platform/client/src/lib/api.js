import axios from 'axios';

// Central API client keeps base URL and future interceptors in one place.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4200/api'
});

export default api;
