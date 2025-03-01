import { 
  validateBasePosition, 
  validateOptionLeg, 
  validateMatchingExpirations 
} from './baseValidation';

export const validatePutSpreadPosition = (formData) => {
  // Run base validation first
  validateBasePosition(formData);

  // Find the leg components
  const shortPut = formData.legs.find(leg => leg.side === 'short' && leg.type === 'option');
  const longPut = formData.legs.find(leg => leg.side === 'long' && leg.type === 'option');

  // Validate short put (required)
  validateOptionLeg(shortPut, 'short put');

  // Validate long put if present (optional hedge)
  if (longPut) {
    validateOptionLeg(longPut, 'long put');

    // Optional strike price guidance (not a hard requirement)
    if (parseFloat(longPut.strike) >= parseFloat(shortPut.strike)) {
      console.warn('Long put strike is typically lower than short put strike');
    }

    // Optional expiration date matching
    try {
      validateMatchingExpirations([shortPut, longPut]);
    } catch (error) {
      console.warn('Option legs have different expiration dates');
    }
  }

  // All validations passed
  return true;
};