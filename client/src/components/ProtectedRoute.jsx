import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

function ProtectedRoute({ children }) {
  const { token, isReady } = useAuthStore((state) => ({
    token: state.token,
    isReady: state.isReady
  }));
  const location = useLocation();

  if (!isReady) {
    return <div className="center-screen">Checking session...</div>;
  }

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

export default ProtectedRoute;