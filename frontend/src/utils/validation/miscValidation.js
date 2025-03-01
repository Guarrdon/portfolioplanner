import { validateBasePosition } from './baseValidation';

export const validateMiscPosition = (formData) => {
  // Run base validation first
  validateBasePosition(formData);

  // Position type validation
  const validPositionTypes = ['stock', 'etf', 'futures', 'forex', 'crypto', 'other'];
  if (formData.positionType && !validPositionTypes.includes(formData.positionType)) {
    throw new Error('Invalid position type');
  }

  // Quantity validation with more flexibility
  if (formData.quantity !== undefined) {
    const quantity = parseFloat(formData.quantity);
    const flexibleTypes = ['futures', 'forex', 'other'];
    
    if (flexibleTypes.includes(formData.positionType)) {
      // Allow negative or zero quantities for these types
      if (isNaN(quantity)) {
        throw new Error('Quantity must be a number');
      }
    } else {
      // For stocks, ETFs, crypto - require positive quantity
      if (isNaN(quantity) || quantity <= 0) {
        throw new Error('Quantity must be a positive number');
      }
    }
  }

  // Entry price validation (optional and more flexible)
  if (formData.entryPrice !== undefined) {
    const entryPrice = parseFloat(formData.entryPrice);
    if (isNaN(entryPrice)) {
      throw new Error('Entry price must be a number');
    }
  }

  // Target price validation (completely optional)
  if (formData.targetPrice !== undefined) {
    const targetPrice = parseFloat(formData.targetPrice);
    if (isNaN(targetPrice)) {
      throw new Error('Target price must be a number');
    }
  }

  // Stop loss validation (completely optional)
  if (formData.stopLoss !== undefined) {
    const stopLoss = parseFloat(formData.stopLoss);
    if (isNaN(stopLoss)) {
      throw new Error('Stop loss must be a number');
    }
  }

  // Risk level validation (optional with default)
  const validRiskLevels = ['low', 'medium', 'high'];
  if (formData.riskLevel && !validRiskLevels.includes(formData.riskLevel)) {
    throw new Error('Invalid risk level');
  }

  // All validations passed
  return true;
};