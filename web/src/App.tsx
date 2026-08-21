import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { ToastProvider } from './ui';
import FormPage from './pages/FormPage';
import LoginPage from './pages/LoginPage';
import AdminLayout from './pages/AdminLayout';
import RequestsPage from './pages/RequestsPage';
import CalendarPage from './pages/CalendarPage';
import ReportsPage from './pages/ReportsPage';
import UsersPage from './pages/UsersPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<FormPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="/admin/solicitacoes" replace />} />
              <Route path="solicitacoes" element={<RequestsPage />} />
              <Route path="agenda" element={<CalendarPage />} />
              <Route path="relatorios" element={<ReportsPage />} />
              <Route path="usuarios" element={<UsersPage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
