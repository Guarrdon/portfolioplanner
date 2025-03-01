import { validateBasePosition } from './baseValidation';

export const validateDividendPosition = (formData) => {
  // Run base validation first
  validateBasePosition(formData);

  // Validate shares (allow zero shares for potential future positions)
  if (formData.shares !== undefined && parseInt(formData.shares) < 0) {
    throw new Error('Number of shares cannot be negative');
  }

  // Validate cost basis (allow zero for potential future positions)
  const costBasis = parseFloat(formData.costBasis);
  if (costBasis !== undefined && (isNaN(costBasis) || costBasis < 0)) {
    throw new Error('Cost basis must be a non-negative number');
  }

  // Validate current dividend (allow zero)
  const currentDividend = parseFloat(formData.currentDividend);
  if (currentDividend !== undefined && (isNaN(currentDividend) || currentDividend < 0)) {
    throw new Error('Current dividend must be a non-negative number');
  }

  // Validate dividend frequency (optional, but if provided must be valid)
  if (formData.dividendFrequency) {
    const validFrequencies = ['monthly', 'quarterly', 'semi-annual', 'annual'];
    if (!validFrequencies.includes(formData.dividendFrequency)) {
      throw new Error('Invalid dividend frequency');
    }
  }

  // Optional date validations (if dates are provided)
  if (formData.nextExDate) {
    const exDate = new Date(formData.nextExDate);
    if (isNaN(exDate.getTime())) {
      throw new Error('Invalid ex-dividend date');
    }
  }

  if (formData.nextPayDate) {
    const payDate = new Date(formData.nextPayDate);
    if (isNaN(payDate.getTime())) {
      throw new Error('Invalid payment date');
    }
  }

  // All validations passed
  return true;
};