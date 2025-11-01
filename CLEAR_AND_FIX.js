// CLEAR_AND_FIX.js
// Copy this entire script and paste it into the browser console
// Run it in BOTH instances (port 3000 AND port 3001)

console.log('🔧 Starting complete reset...');

// Step 1: Clear everything
localStorage.clear();
sessionStorage.clear();
console.log('✅ Cleared all storage');

// Step 2: Create users with proper UUIDs
const USER1_ID = '00000000-0000-0000-0000-000000000001';
const USER2_ID = '00000000-0000-0000-0000-000000000002';

const users = [
  {
    id: USER1_ID,
    username: 'matt',
    displayName: 'Matt Lyons',
    full_name: 'Matt Lyons',
    email: 'matt@optionsquared.com',
    profilePicture: null,
    preferences: {
      defaultView: 'portfolio',
      theme: 'light',
      dateFormat: 'MM/dd/yyyy',
      timezone: 'America/New_York'
    },
    createdAt: new Date().toISOString(),
    role: 'admin'
  },
  {
    id: USER2_ID,
    username: 'jason',
    displayName: 'Jason Hall',
    full_name: 'Jason Hall',
    email: 'sneaksoft@gmail.com',
    profilePicture: null,
    preferences: {
      defaultView: 'calendar',
      theme: 'light',
      dateFormat: 'MM/dd/yyyy',
      timezone: 'America/Los_Angeles'
    },
    createdAt: new Date().toISOString(),
    role: 'admin'
  }
];

localStorage.setItem('portfolio_users', JSON.stringify(users));
console.log('✅ Created users with UUIDs:', users.map(u => ({ id: u.id, name: u.username })));

// Step 3: Detect which instance this is based on port
const port = window.location.port;
console.log(`📍 Detected port: ${port}`);

if (port === '3000' || port === '') {
  // Instance 1 - Set as Matt
  console.log('🎯 Setting up as Instance 1 (Matt)');
  localStorage.setItem('current_user_id', USER1_ID);
  
  // Add Jason as friend
  const friendship = {
    userId: USER2_ID,
    createdAt: new Date().toISOString(),
    status: 'active',
    type: 'individual'
  };
  localStorage.setItem(`user_${USER1_ID}_relationships`, JSON.stringify([friendship]));
  console.log('✅ Set current user: Matt Lyons (User 1)');
  console.log('✅ Added Jason as friend');
} else if (port === '3001') {
  // Instance 2 - Set as Jason
  console.log('🎯 Setting up as Instance 2 (Jason)');
  localStorage.setItem('current_user_id', USER2_ID);
  
  // Add Matt as friend
  const friendship = {
    userId: USER1_ID,
    createdAt: new Date().toISOString(),
    status: 'active',
    type: 'individual'
  };
  localStorage.setItem(`user_${USER2_ID}_relationships`, JSON.stringify([friendship]));
  console.log('✅ Set current user: Jason Hall (User 2)');
  console.log('✅ Added Matt as friend');
}

// Step 4: Verify
const currentUserId = localStorage.getItem('current_user_id');
const relationships = localStorage.getItem(`user_${currentUserId}_relationships`);

console.log('📊 Final State:');
console.log('  Current User ID:', currentUserId);
console.log('  Friends:', JSON.parse(relationships || '[]'));

console.log('');
console.log('🎉 Setup complete! Reloading in 2 seconds...');
setTimeout(() => location.reload(), 2000);

