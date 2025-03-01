// src/utils/validation/bigOptionsValidation.js
import { validateBasePosition, validateOptionLeg } from './baseValidation';

export const validateBigOptionPosition = (formData) => {
  // Run base validation first
  validateBasePosition(formData);

  // Find the option leg
  const optionLeg = formData.legs?.find(leg => leg.type === 'option');
  if (!optionLeg) {
    throw new Error('Option leg is required');
  }

  // Validate the option leg
  validateOptionLeg(optionLeg, 'option');

  // All validations passed
  return true;
};