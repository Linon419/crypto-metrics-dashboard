// src/components/ProtectedRoute.jsx
import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { Spin } from 'antd';
import { verifyToken } from '../services/api';
import { loginSuccess, logout } from '../redux/slices/authSlice';

function ProtectedRoute({ children }) {
  const location = useLocation();
  const dispatch = useDispatch();
  const { isAuthenticated, loading } = useSelector(state => state.auth);
  const [verifying, setVerifying] = React.useState(true);
  
  useEffect(() => {
    const verifyAuth = async () => {
      try {
        // Only verify if there's a token
        if (localStorage.getItem('token')) {
          const data = await verifyToken();
          dispatch(loginSuccess({
            token: localStorage.getItem('token'),
            user: data.user
          }));
        }
      } catch (error) {
        console.error('Token verification failed:', error);
        dispatch(logout());
      } finally {
        setVerifying(false);
      }
    };
    
    verifyAuth();
  }, [dispatch]);
  
  // Show loading spinner while verifying token
  if (verifying || loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Spin size="large" />
      </div>
    );
  }
  
  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  return children;
}

export default ProtectedRoute;