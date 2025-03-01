import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../contexts/UserContext';
import { Camera, X } from 'lucide-react';

const ProfileSettings = () => {
  const { currentUser, logout, updateUser, updateProfilePicture, removeProfilePicture } = useUser();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    displayName: currentUser?.displayName || '',
    username: currentUser?.username || '',
    email: currentUser?.email || ''
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const success = await updateProfilePicture(currentUser.id, reader.result);
          if (!success) {
            setError('Failed to update profile picture');
          }
        };
        reader.readAsDataURL(file);
      } catch (err) {
        setError('Error processing image file');
      }
    }
  };

  const handleRemovePhoto = async () => {
    const success = await removeProfilePicture(currentUser.id);
    if (!success) {
      setError('Failed to remove profile picture');
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    try {
      const success = await updateUser(currentUser.id, formData);
      if (success) {
        setIsEditing(false);
      } else {
        setError('Failed to update profile');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Account Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your account information and preferences
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded relative">
            <p className="block sm:inline">{error}</p>
            <button
              onClick={() => setError(null)}
              className="absolute top-0 bottom-0 right-0 px-4 py-3"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        <div className="bg-white shadow rounded-lg">
          <div className="p-6 space-y-6">
            {/* Profile Picture Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">Profile Picture</h3>
              <div className="flex items-center gap-6">
                <div className="relative">
                  {currentUser?.profilePicture ? (
                    <div className="relative">
                      <img
                        src={currentUser.profilePicture}
                        alt="Profile"
                        className="h-24 w-24 rounded-full object-cover"
                      />
                      <button
                        onClick={handleRemovePhoto}
                        className="absolute -top-2 -right-2 p-1 bg-white rounded-full shadow-md hover:bg-gray-100"
                        title="Remove photo"
                      >
                        <X className="h-4 w-4 text-gray-500" />
                      </button>
                    </div>
                  ) : (
                    <div className="h-24 w-24 rounded-full bg-gray-200 flex items-center justify-center">
                      <Camera className="h-8 w-8 text-gray-400" />
                    </div>
                  )}
                </div>
                <div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Change Photo
                  </button>
                  <p className="mt-1 text-xs text-gray-500">
                    JPG or PNG. Max file size 1MB.
                  </p>
                </div>
              </div>
            </div>

            {/* User Information Section */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-gray-900">Account Information</h3>
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="text-sm text-blue-600 hover:text-blue-500"
                >
                  {isEditing ? 'Cancel' : 'Edit'}
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Display Name
                  </label>
                  <input
                    type="text"
                    name="displayName"
                    value={formData.displayName}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                    className={`mt-1 block w-full rounded-md shadow-sm 
                      ${isEditing 
                        ? 'border-gray-300 focus:border-blue-500 focus:ring-blue-500' 
                        : 'border-transparent bg-gray-50'
                      }`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Username
                  </label>
                  <input
                    type="text"
                    name="username"
                    value={formData.username}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                    className={`mt-1 block w-full rounded-md shadow-sm 
                      ${isEditing 
                        ? 'border-gray-300 focus:border-blue-500 focus:ring-blue-500' 
                        : 'border-transparent bg-gray-50'
                      }`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                    className={`mt-1 block w-full rounded-md shadow-sm 
                      ${isEditing 
                        ? 'border-gray-300 focus:border-blue-500 focus:ring-blue-500' 
                        : 'border-transparent bg-gray-50'
                      }`}
                  />
                </div>

                {isEditing && (
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Save Changes
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>

          {/* Actions Section */}
          <div className="px-6 py-4 bg-gray-50 rounded-b-lg">
            <div className="flex justify-between items-center">
              <button
                onClick={handleLogout}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Log Out
              </button>

              {/* Additional buttons can go here */}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileSettings;