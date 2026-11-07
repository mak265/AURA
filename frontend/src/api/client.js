import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5000/api',
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('aura_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 (expired token)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if(error.response?.data?.moderation)window.dispatchEvent(new CustomEvent('aura:moderation',{detail:error.response.data}));
    if (error.response?.status === 401) {
      localStorage.removeItem('aura_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
