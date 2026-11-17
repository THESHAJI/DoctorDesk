const express = require('express');
const router = express.Router();
const slotController = require('../controllers/slot.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { createSlotRules, createBulkSlotRules, slotParamRules } = require('../validators/doctor.validator');
const { validate } = require('../middleware/validate.middleware');
const { ROLES } = require('../config/constants');

// All doctor slot management routes require authentication and DOCTOR role
router.use(authenticate, authorize(ROLES.DOCTOR));

// Doctor: List own slots
router.get('/me', slotController.getMySlots);

// Doctor: Bulk generate availability slots
router.post('/bulk', createBulkSlotRules, validate, slotController.createBulkSlots);

// Doctor: Create a single availability slot
router.post('/', createSlotRules, validate, slotController.createSlot);

// Doctor: Block an available slot
router.patch('/:id/block', slotParamRules, validate, slotController.blockSlot);

// Doctor: Unblock a blocked slot
router.patch('/:id/unblock', slotParamRules, validate, slotController.unblockSlot);

// Doctor: Safe-delete an availability slot
router.delete('/:id', slotParamRules, validate, slotController.deleteSlot);

module.exports = router;
