import { userStorage } from '../storage/storage';

export const initializeTestData = (userId) => {
  // Clear any existing data
  userStorage.clearAllData();
  
  // Initialize storage for the user
  userStorage.initializeUserStorage(userId);
  
  // Add some test positions if needed
  const testOwnedPositions = [
    {
      id: 'test_owned_1',
      userId,
      ownerId: userId,
      strategy: 'coveredCalls',
      symbol: 'AAPL',
      // ... other required fields
    }
  ];
  
  const testSharedPositions = [
    {
      id: 'test_shared_1',
      userId,
      ownerId: 'other_user',
      strategy: 'coveredCalls',
      symbol: 'MSFT',
      shared: true,
      // ... other required fields
    }
  ];
  
  userStorage.saveOwnedPositions(userId, testOwnedPositions);
  userStorage.saveSharedPositions(userId, testSharedPositions);
  
  return {
    ownedPositions: testOwnedPositions,
    sharedPositions: testSharedPositions
  };
};