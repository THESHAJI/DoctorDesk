const { COMMISSION_TYPE } = require('../config/constants');

/**
 * Calculate commission and total fee.
 * 
 * @param {number} consultationFee - Doctor's consultation fee
 * @param {string} commissionType - 'percentage' or 'fixed'
 * @param {number} commissionValue - The rate (e.g., 10 for 10%) or fixed amount
 * @returns {{ commissionAmount: number, totalFee: number }}
 */
const calculateFee = (consultationFee, commissionType, commissionValue) => {
  let commissionAmount;

  if (commissionType === COMMISSION_TYPE.PERCENTAGE) {
    // e.g., consultationFee=500, commissionValue=10 → commission=50
    commissionAmount = parseFloat(((consultationFee * commissionValue) / 100).toFixed(2));
  } else if (commissionType === COMMISSION_TYPE.FIXED) {
    commissionAmount = parseFloat(parseFloat(commissionValue).toFixed(2));
  } else {
    throw new Error(`Invalid commission type: ${commissionType}`);
  }

  const totalFee = parseFloat((parseFloat(consultationFee) + commissionAmount).toFixed(2));

  return {
    commissionAmount,
    totalFee,
  };
};

module.exports = { calculateFee };
