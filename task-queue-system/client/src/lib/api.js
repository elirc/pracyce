import axios from 'axios';

// Shared axios instance keeps every dashboard request on one configurable API base URL.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4100/api'
});

export default api;
