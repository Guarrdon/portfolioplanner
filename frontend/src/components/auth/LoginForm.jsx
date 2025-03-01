import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../../contexts/UserContext';
import { UserCircle2 } from 'lucide-react';

const LoginForm = () => {
  const { users, login, currentUser, loading } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (currentUser) {
      // Redirect to intended page or home
      const from = location.state?.from?.pathname || "/";
      navigate(from, { replace: true });
    }
  }, [currentUser, navigate, location]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-100">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  const handleUserSelect = (userId) => {
    login(userId);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col justify-center">
      <div className="max-w-md w-full mx-auto">
        <div className="bg-white py-8 px-10 shadow rounded-lg">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Welcome to Portfolio Planner</h2>
            <p className="text-sm text-gray-600 mt-2">Select a user to continue</p>
          </div>

          <div className="space-y-4">
            {users.map((user) => (
              <button
                key={user.id}
                onClick={() => handleUserSelect(user.id)}
                className="w-full flex items-center p-4 border rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {user.profilePicture ? (
                  <img
                    src={user.profilePicture}
                    alt={user.displayName}
                    className="h-10 w-10 rounded-full object-cover object-center"
                  />
                ) : (
                  <UserCircle2 className="h-10 w-10 text-gray-400" />
                )}
                <div className="ml-4 text-left">
                  <div className="text-sm font-medium text-gray-900">{user.displayName}</div>
                  <div className="text-xs text-gray-500">{user.email}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6 text-center text-xs text-gray-500">
            Portfolio Planner ©2025 - All Rights Reserved
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;