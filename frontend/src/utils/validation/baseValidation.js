// src/utils/validation/baseValidation.js

/**
* Validates common position attributes required for all strategies
 * @param {Object} formData - The form data to validate
 * @throws {Error} If validation fails
 */
export const validateBasePosition = (formData) => {
  // Required fields
  if (!formData.symbol?.trim()) {
    throw new Error('Please enter a symbol');
  }

  if (!formData.account?.trim()) {
    throw new Error('Please select an account');
  }

  if (!formData.strategy?.trim()) {
    throw new Error('Strategy type is required');
  }

  // New userId validation
  if (!formData.userId?.trim()) {
    throw new Error('User ID is required');
  }

  // Validate legs array exists
  if (!Array.isArray(formData.legs)) {
    throw new Error('Position legs array is required');
  }

  // All validations passed
  return true;
};
/**
 * Validates an option leg
 * @param {Object} leg - The option leg to validate
 * @param {string} legType - Description of the leg (e.g., "short put", "long call")
 * @throws {Error} If validation fails
 */
export const validateOptionLeg = (leg, legType) => {
  if (!leg) {
    throw new Error(`${legType} leg is required`);
  }

  // Type validation
  if (leg.type !== 'option') {
    throw new Error(`${legType} leg must be an option`);
  }

  // Required fields
  if (!leg.optionType || !['call', 'put'].includes(leg.optionType)) {
    throw new Error(`${legType} leg must specify valid option type (call/put)`);
  }

  if (!leg.side || !['long', 'short'].includes(leg.side)) {
    throw new Error(`${legType} leg must specify valid side (long/short)`);
  }

  // Numeric validations
  if (!leg.contracts || leg.contracts < 1) {
    throw new Error(`${legType} leg must have at least 1 contract`);
  }

  if (!leg.strike || isNaN(parseFloat(leg.strike)) || parseFloat(leg.strike) <= 0) {
    throw new Error(`${legType} leg must have a valid strike price`);
  }

  if (!leg.premium || isNaN(parseFloat(leg.premium)) || parseFloat(leg.premium) <= 0) {
    throw new Error(`${legType} leg must have a valid premium`);
  }

  // Date validation
  if (!leg.expiration) {
    throw new Error(`${legType} leg must have an expiration date`);
  }

  const expirationDate = new Date(leg.expiration);
  if (isNaN(expirationDate.getTime())) {
    throw new Error(`${legType} leg must have a valid expiration date`);
  }

  // Ensure expiration is in the future
  if (expirationDate < new Date()) {
    throw new Error(`${legType} leg expiration date must be in the future`);
  }

  // All validations passed
  return true;
};

/**
 * Validates a stock leg
 * @param {Object} leg - The stock leg to validate
 * @param {string} legType - Description of the leg (e.g., "long stock")
 * @throws {Error} If validation fails
 */
export const validateStockLeg = (leg, legType) => {
  if (!leg) {
    throw new Error(`${legType} leg is required`);
  }

  // Type validation
  if (leg.type !== 'stock') {
    throw new Error(`${legType} leg must be a stock position`);
  }

  // Required fields
  if (!leg.side || !['long', 'short'].includes(leg.side)) {
    throw new Error(`${legType} leg must specify valid side (long/short)`);
  }

  // Numeric validations
  if (!leg.shares || leg.shares < 1) {
    throw new Error(`${legType} leg must have at least 1 share`);
  }

  if (!leg.costBasis || isNaN(parseFloat(leg.costBasis)) || parseFloat(leg.costBasis) <= 0) {
    throw new Error(`${legType} leg must have a valid cost basis`);
  }

  // All validations passed
  return true;
};

/**
 * Validates that legs maintain proper ratios (e.g., 100 shares per contract)
 * @param {Object} stockLeg - The stock leg
 * @param {Object} optionLeg - The option leg
 * @throws {Error} If validation fails
 */
export const validatePositionRatios = (stockLeg, optionLeg) => {
  if (stockLeg && optionLeg) {
    const shareCount = stockLeg.shares;
    const contractCount = optionLeg.contracts;

    if (shareCount !== contractCount * 100) {
      throw new Error('Number of shares must equal number of contracts × 100');
    }
  }

  return true;
};

/**
 * Validates expiration dates match between legs
 * @param {Array} legs - Array of legs to validate
 * @throws {Error} If validation fails
 */
export const validateMatchingExpirations = (legs) => {
  const optionLegs = legs.filter(leg => leg.type === 'option');

  if (optionLegs.length > 1) {
    const firstExpiration = optionLegs[0].expiration;
    const mismatchedLeg = optionLegs.find(leg => leg.expiration !== firstExpiration);

    if (mismatchedLeg) {
      throw new Error('All option legs must have matching expiration dates');
    }
  }

  return true;
};