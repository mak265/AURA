import axios from 'axios';

const loginPath = `${import.meta.env.BASE_URL}login`;
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || `${import.meta.env.BASE_URL}api`,
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('aura_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.url?.startsWith('/admin/')) {
    const managementToken = sessionStorage.getItem('aura_management_token');
    if (managementToken) config.headers['X-Aura-Management'] = managementToken;
  }
  return config;
});

// Handle 401 (expired token)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const token = localStorage.getItem('aura_token');
    const usesCurrentToken = token && error.config?.headers?.Authorization === `Bearer ${token}`;
    if (error.response?.data?.code === 'MFA_REQUIRED') {
      sessionStorage.removeItem('aura_management_token');
      window.dispatchEvent(new Event('aura:management-mfa-required'));
    }
    if(error.response?.data?.moderation)window.dispatchEvent(new CustomEvent('aura:moderation',{detail:error.response.data}));
    if (usesCurrentToken && !error.config?.url?.startsWith('/auth/') &&
        (error.response?.status === 401 || error.response?.data?.code === 'ACCOUNT_BANNED')) {
      sessionStorage.removeItem('aura_management_token');
      localStorage.removeItem('aura_token');
      window.location.href = loginPath;
    }
    return Promise.reject(error);
  }
);

export default api;
