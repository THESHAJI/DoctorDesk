'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    // Get doctor 1 profile ID
    const [doctorProfiles] = await queryInterface.sequelize.query(
      `SELECT dp.id FROM doctor_profiles dp 
       JOIN users u ON u.id = dp.user_id 
       WHERE u.email = 'doctor@doctordesk.com';`
    );

    if (doctorProfiles.length > 0) {
      const doctorProfileId = doctorProfiles[0].id;

      // Create future dates for slots: tomorrow and day after tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      const dayAfter = new Date();
      dayAfter.setDate(dayAfter.getDate() + 2);
      const dayAfterStr = dayAfter.toISOString().split('T')[0];

      const slots = [
        // Tomorrow slots
        {
          doctor_profile_id: doctorProfileId,
          slot_date: tomorrowStr,
          start_time: '09:00:00',
          end_time: '09:30:00',
          status: 'available',
          created_at: now,
          updated_at: now,
        },
        {
          doctor_profile_id: doctorProfileId,
          slot_date: tomorrowStr,
          start_time: '09:30:00',
          end_time: '10:00:00',
          status: 'available',
          created_at: now,
          updated_at: now,
        },
        {
          doctor_profile_id: doctorProfileId,
          slot_date: tomorrowStr,
          start_time: '10:00:00',
          end_time: '10:30:00',
          status: 'available',
          created_at: now,
          updated_at: now,
        },
        {
          doctor_profile_id: doctorProfileId,
          slot_date: tomorrowStr,
          start_time: '10:30:00',
          end_time: '11:00:00',
          status: 'available',
          created_at: now,
          updated_at: now,
        },
        // Day after tomorrow slots
        {
          doctor_profile_id: doctorProfileId,
          slot_date: dayAfterStr,
          start_time: '14:00:00',
          end_time: '14:30:00',
          status: 'available',
          created_at: now,
          updated_at: now,
        },
        {
          doctor_profile_id: doctorProfileId,
          slot_date: dayAfterStr,
          start_time: '14:30:00',
          end_time: '15:00:00',
          status: 'available',
          created_at: now,
          updated_at: now,
        },
      ];

      await queryInterface.bulkInsert('availability_slots', slots);
    }
  },

  async down(queryInterface, Sequelize) {
    const [doctorProfiles] = await queryInterface.sequelize.query(
      `SELECT dp.id FROM doctor_profiles dp 
       JOIN users u ON u.id = dp.user_id 
       WHERE u.email = 'doctor@doctordesk.com';`
    );

    if (doctorProfiles.length > 0) {
      await queryInterface.bulkDelete('availability_slots', {
        doctor_profile_id: doctorProfiles[0].id,
      });
    }
  },
};
