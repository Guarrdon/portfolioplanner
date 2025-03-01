import { 
    validateBasePosition, 
    validateOptionLeg, 
    validateStockLeg
  } from './baseValidation';
  
  export const validateCoveredCallPosition = (formData) => {
    // Run base validation first
    validateBasePosition(formData);
  
    // Find the leg components
    const stockLeg = formData.legs.find(leg => leg.type === 'stock');
    const callLeg = formData.legs.find(leg => leg.type === 'option' && leg.optionType === 'call');
  
    // Validate stock leg
    validateStockLeg(stockLeg, 'stock');
  
    // Validate call leg
    validateOptionLeg(callLeg, 'call');
  
    // All validations passed
    return true;
  };