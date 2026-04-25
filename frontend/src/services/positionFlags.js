/**
 * Position flags API service
 */
import api from './api';

export const fetchPositionFlags = async () => {
  const response = await api.get('/position-flags');
  return response.data;
};

export const updatePositionFlag = async (positionSignature, patch) => {
  const response = await api.patch(
    `/position-flags/${encodeURIComponent(positionSignature)}`,
    patch
  );
  return response.data;
};
